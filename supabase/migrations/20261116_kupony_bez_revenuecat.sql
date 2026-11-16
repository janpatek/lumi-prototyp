-- Kupóny bez RevenueCat, 16. 11. 2026.
-- Kupóny z administrace (Kupony a partneři) se uplatní ve stejném okně „Mám kód“ jako kód pro recenzenty.
-- Přístup drží jen naše databáze (families.promo_until), RevenueCat ani edge funkce coupon-grant už nejsou potřeba.
-- Spusť jednou v Supabase → SQL Editor, až po 20261111_kupony.sql a 20261115_slouceni_uctu.sql.
-- Nová databáze stačí s aktuálním schema.sql (obsahuje stejné bloky).
-- Potom smaž edge funkci coupon-grant (Edge Functions → coupon-grant → Delete) a secret REVENUECAT_SECRET_KEY, pokud tam je.

begin;

-- pryč s tím, co patřilo k RevenueCat a k původnímu samostatnému uplatnění kupónu
drop function if exists public.coupon_rc_pending(uuid);
drop function if exists public.coupon_rc_mark(bigint, boolean, text);
drop function if exists public.app_redeem_coupon(text);
drop function if exists public.app_promo();
alter table if exists public.coupon_redemptions drop column if exists rc_granted_at, drop column if exists rc_error;
drop table if exists public.coupon_tries;   -- pokusy hlídá access_tries (10 špatných kódů za hodinu)

-- ---------- Kupóny (Kupony a partneři v administraci) ----------
-- Kampaně z administrace (admin/kupony.js). Rodina kód napíše do stejného okna „Mám kód“ jako kód pro recenzenty:
-- app_redeem_code nejdřív zkusí kódy přístupu (access_codes), pak kupóny. Přístup drží jen naše databáze
-- (families.promo_until), žádná další služba. iPhone okno „Mám kód“ nemá (App Store 3.1.1).
-- coupons: kampaň. Sdílený kód (mode shared, sloupec code, např. VECERNI) nebo sada jednorázových kódů (mode unique,
-- tabulka coupon_codes, např. ZNAMI-7KQ4-M2PX). id vytváří administrace (c + čas), ať může hned pracovat bez čekání.
-- gives: trial = dny zdarma, months = měsíce zdarma (obojí bez platby),
-- percent / amount = sleva z ceny, tu v aplikaci uplatnit nejde (platí se jen v obchodě), vrací vysvětlení.
create table if not exists public.coupons (
  id text primary key check (id ~ '^c[0-9a-z]{1,30}$'),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  name text not null check (char_length(name) between 1 and 120),
  purpose text not null check (purpose in ('znami', 'partner', 'marketing', 'b2b', 'podpora')),
  gives text not null check (gives in ('trial', 'months', 'percent', 'amount')),
  value int not null check (value > 0 and value <= 3650),
  dur text check (dur in ('first', 'year', 'months')),
  months int check (months between 1 and 36),
  mode text not null check (mode in ('shared', 'unique')),
  code text unique check (code ~ '^[A-Z0-9-]{4,20}$'),
  prefix text check (prefix ~ '^[A-Z0-9]{2,10}$'),
  new_only boolean not null default true,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  max_uses int check (max_uses > 0),
  partner text check (char_length(partner) <= 40),
  comm jsonb,
  paused boolean not null default false,
  check ((mode = 'shared') = (code is not null))
);
create table if not exists public.coupon_codes (
  code text primary key check (code ~ '^[A-Z0-9-]{4,30}$'),
  coupon_id text not null references public.coupons(id) on delete cascade,
  note text check (char_length(note) <= 80),
  used_by uuid references public.families(id) on delete set null,
  used_at timestamptz
);
create index if not exists coupon_codes_coupon on public.coupon_codes (coupon_id);
-- Uplatnění. Po smazání rodiny zůstane záznam bez vazby na ni (family_id null) kvůli vyúčtování s partnery.
create table if not exists public.coupon_redemptions (
  id bigint generated always as identity primary key,
  coupon_id text not null references public.coupons(id) on delete cascade,
  code text not null,
  family_id uuid references public.families(id) on delete set null,
  at timestamptz not null default now(),
  until timestamptz                 -- do kdy má rodina přístup (trial, months)
);
create index if not exists coupon_red_coupon on public.coupon_redemptions (coupon_id);
create index if not exists coupon_red_family on public.coupon_redemptions (family_id);
alter table public.families add column if not exists promo_until timestamptz;   -- do kdy má rodina Plus z kupónu
alter table public.coupons enable row level security;
alter table public.coupon_codes enable row level security;
alter table public.coupon_redemptions enable row level security;

-- Uplatnění kupónu (volá jen app_redeem_code, ten hlídá i počet pokusů). Vrací { ok, msg, error, until }.
-- error: unknown = kód neznáme (počítá se do pokusů), rule = kód existuje, ale teď ho uplatnit nejde (msg říká proč).
create or replace function public.coupon_redeem(uid uuid, code text) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  q text := upper(regexp_replace(coalesce(code, ''), '\s', '', 'g'));
  c coupons;
  cc coupon_codes;
  fam families;
  base timestamptz;
  u timestamptz;
  fail text;
begin
  select * into c from coupons k where k.code = q for update;
  if not found then
    select * into cc from coupon_codes k where k.code = q for update;
    if found then select * into c from coupons k where k.id = cc.coupon_id for update; end if;
  end if;
  if c.id is null then return jsonb_build_object('ok', false, 'error', 'unknown'); end if;
  insert into families (id) values (uid) on conflict (id) do nothing;
  select * into fam from families f where f.id = uid for update;

  fail := case
    when cc.code is not null and cc.used_by is not null and cc.used_by <> uid then 'Tenhle kód už někdo použil. Každý jednorázový kód platí jen jednou.'
    when exists (select 1 from coupon_redemptions r where r.coupon_id = c.id and r.family_id = uid) then 'Tenhle kupón už máte uplatněný.'
    when c.paused or now() < c.valid_from then 'Tenhle kód teď neplatí.'
    when c.valid_to is not null and now() >= c.valid_to then 'Platnost kódu už skončila.'
    when c.max_uses is not null and (select count(*) from coupon_redemptions r where r.coupon_id = c.id) >= c.max_uses then 'Kód už je vyčerpaný.'
    when c.gives in ('percent', 'amount') then 'Tohle je slevový kód. Slevu uplatníte při nákupu předplatného v obchodě s aplikacemi.'
    when c.new_only and (fam.premium or exists (select 1 from coupon_redemptions r where r.family_id = uid)) then 'Tenhle kupón je jen pro nové rodiny.'
  end;
  if fail is not null then return jsonb_build_object('ok', false, 'error', 'rule', 'msg', fail); end if;

  base := greatest(now(), coalesce(fam.promo_until, now()));
  u := case c.gives when 'trial' then base + make_interval(days => c.value) else base + make_interval(months => c.value) end;
  insert into coupon_redemptions (coupon_id, code, family_id, until) values (c.id, q, uid, u);
  if cc.code is not null then update coupon_codes set used_by = uid, used_at = now() where coupon_codes.code = cc.code; end if;
  update families set promo_until = u, premium = true, updated_at = now() where id = uid;
  return jsonb_build_object('ok', true, 'until', u,
    'msg', 'Kód je uplatněný, všechny pohádky jsou odemčené do ' || to_char(u at time zone 'Europe/Prague', 'FMDD. FMMM. YYYY') || '. Pak se nic samo neplatí.');
end $$;

-- Do kdy má účet Plus z kódu přístupu nebo kupónu (null = nemá)
create or replace function public.code_until(uid uuid) returns timestamptz language sql stable security definer set search_path = public as $$
  select nullif(greatest(coalesce((select max(g.until) from access_grants g where g.user_id = uid), '-infinity'),
    coalesce((select f.promo_until from families f where f.id = uid), '-infinity')), '-infinity');
$$;

-- Aplikace: uplatnit kód. Vrací { ok: true, until: ms, msg? } nebo { ok: false, error: 'invalid' | 'tries' | 'rule', msg? }.
-- Nejdřív kódy přístupu (recenzenti, otisk SHA-256), pak kupóny z administrace. Stejný kód podruhé platnost neprodlouží.
create or replace function public.app_redeem_code(code text) returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); h text; c access_codes; t access_tries; u timestamptz; r jsonb;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  insert into access_tries as x (user_id) values (uid)
    on conflict (user_id) do update set
      n = case when x.since < now() - interval '1 hour' then 0 else x.n end,
      since = case when x.since < now() - interval '1 hour' then now() else x.since end
    returning * into t;
  if t.n >= 10 then return jsonb_build_object('ok', false, 'error', 'tries'); end if;
  h := encode(sha256(convert_to(upper(regexp_replace(coalesce(code, ''), '\s', '', 'g')), 'UTF8')), 'hex');
  select * into c from access_codes a where a.code_hash = h;
  if not found then
    r := coupon_redeem(uid, code);
    if r->>'error' = 'unknown' then
      update access_tries set n = n + 1 where user_id = uid;
      return jsonb_build_object('ok', false, 'error', 'invalid');
    end if;
    if not (r->>'ok')::boolean then return r; end if;
    u := code_until(uid);
    return jsonb_build_object('ok', true, 'until', (extract(epoch from u) * 1000)::bigint, 'msg', r->>'msg');
  end if;
  if (c.valid_until is not null and c.valid_until < now())
     or (c.max_uses is not null and c.uses >= c.max_uses and not exists (select 1 from access_grants g where g.user_id = uid and g.code_id = c.id)) then
    update access_tries set n = n + 1 where user_id = uid;
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  insert into access_grants (user_id, code_id, until) values (uid, c.id, now() + make_interval(days => c.days))
    on conflict (user_id, code_id) do nothing;
  if found then update access_codes set uses = uses + 1 where id = c.id; end if;
  u := code_until(uid);
  update families set premium = true where id = uid and u > now();
  return jsonb_build_object('ok', u > now(), 'until', (extract(epoch from u) * 1000)::bigint, 'error', case when u > now() then null else 'invalid' end);
end $$;

-- Aplikace při spuštění: do kdy platí odemčení kódem (ms), ať ho účet má i na jiném telefonu po přihlášení
create or replace function public.app_code_until() returns bigint language sql stable security definer set search_path = public as $$
  select (extract(epoch from u) * 1000)::bigint from (select public.code_until(auth.uid()) u) x where x.u > now();
$$;

-- Kupóny v administraci: vlastník, podpora a účetní (stejně jako coupons.manage v admin/api.js)
create or replace function public.require_coupons() returns void language plpgsql stable security definer set search_path = public as $$
begin
  perform require_staff();
  if (select s.role from staff s where s.user_id = auth.uid()) not in ('owner', 'support', 'finance') then raise exception 'forbidden: coupons' using errcode = '42501'; end if;
end $$;

-- Všechno najednou: kampaně, jednorázové kódy a uplatnění (rodina jako krátké číslo seq, smazaná = null)
create or replace function public.admin_coupons() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform require_coupons();
  return jsonb_build_object(
    'campaigns', coalesce((select jsonb_agg(to_jsonb(k) - 'created_by' order by k.created_at desc) from coupons k), '[]'),
    'codes', coalesce((select jsonb_agg(jsonb_build_object('code', x.code, 'coupon_id', x.coupon_id, 'note', x.note, 'used', f.seq, 'used_at', x.used_at) order by x.code)
      from coupon_codes x left join families f on f.id = x.used_by), '[]'),
    'redemptions', coalesce((select jsonb_agg(jsonb_build_object('coupon_id', r.coupon_id, 'code', r.code, 'fseq', f.seq, 'at', r.at, 'until', r.until) order by r.at)
      from coupon_redemptions r left join families f on f.id = r.family_id), '[]'));
end $$;

-- Nová kampaň (p: tvar z administrace) a případně její jednorázové kódy (codes: [{ c, note }])
create or replace function public.admin_coupon_save(p jsonb, codes jsonb default '[]') returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_coupons();
  if p->>'code' is not null and exists (select 1 from coupon_codes x where x.code = p->>'code') then raise exception 'Takový kód už existuje.'; end if;
  insert into coupons (id, created_by, name, purpose, gives, value, dur, months, mode, code, prefix, new_only, valid_from, valid_to, max_uses, partner, comm)
  values (p->>'id', auth.uid(), p->>'name', p->>'purpose', p->>'gives', (p->>'value')::int, p->>'dur', (p->>'months')::int, p->>'mode',
    nullif(upper(p->>'code'), ''), nullif(upper(p->>'prefix'), ''), coalesce((p->>'newOnly')::boolean, true),
    coalesce((p->>'from')::timestamptz, now()), (p->>'to')::timestamptz, (p->>'limit')::int, p->>'partner', p->'comm');
  perform admin_coupon_add_codes(p->>'id', codes);
  insert into audit_log (actor, action, target, detail) values (auth.uid(), 'coupon.create', coalesce(p->>'code', p->>'prefix'), left(p->>'name', 200));
end $$;

create or replace function public.admin_coupon_add_codes(cid text, codes jsonb) returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_coupons();
  if jsonb_array_length(coalesce(codes, '[]')) > 5000 then raise exception 'Nejvýš 5 000 kódů najednou.'; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(codes, '[]')) x join coupons k on k.code = upper(x->>'c')) then raise exception 'Kód koliduje se sdíleným kódem.'; end if;
  insert into coupon_codes (code, coupon_id, note)
  select upper(x->>'c'), cid, nullif(left(x->>'note', 80), '') from jsonb_array_elements(coalesce(codes, '[]')) x;
end $$;

create or replace function public.admin_coupon_pause(cid text, pause boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_coupons();
  update coupons set paused = pause where id = cid;
  insert into audit_log (actor, action, target, detail) values (auth.uid(), 'coupon.pause', cid, case when pause then 'Pozastaveno' else 'Obnoveno' end);
end $$;

revoke all on public.coupons, public.coupon_codes, public.coupon_redemptions from anon, authenticated;
revoke execute on function public.coupon_redeem(uuid, text), public.code_until(uuid), public.app_redeem_code(text), public.app_code_until(),
  public.require_coupons(), public.admin_coupons(), public.admin_coupon_save(jsonb, jsonb), public.admin_coupon_add_codes(text, jsonb),
  public.admin_coupon_pause(text, boolean) from public, anon, authenticated;
grant execute on function public.app_redeem_code(text), public.app_code_until(), public.admin_coupons(), public.admin_coupon_save(jsonb, jsonb),
  public.admin_coupon_add_codes(text, jsonb), public.admin_coupon_pause(text, boolean) to authenticated;

-- Sloučení: volá telefon už přihlášený do hlavního účtu, s lístkem ze starého účtu.
create or replace function public.app_merge_from(ticket uuid) returns void language plpgsql security definer set search_path = public, auth as $$
declare uid uuid := auth.uid(); src uuid;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  delete from merge_tickets where id = ticket and created_at > now() - interval '15 minutes' returning from_uid into src;
  if src is null then raise exception 'merge ticket invalid or expired' using errcode = '22023'; end if;
  if src = uid then return; end if;

  -- hlavní účet ještě nemá záznam uživatele (třeba účet založený e-mailem): převezme ho z telefonu i s dětmi
  if not exists (select 1 from families where id = uid) then
    insert into families (id, created_at, last_seen_at, provider, email, town, country, platform, app_version, source, onboarded, premium, analytics, analytics_at)
      select uid, s.created_at, now(), s.provider, (select nullif(u.email, '') from auth.users u where u.id = uid), s.town, s.country,
        s.platform, s.app_version, s.source, s.onboarded, s.premium, s.analytics, s.analytics_at
      from families s where s.id = src;
    if not found then
      insert into families (id, provider, email) values (uid, 'device', (select nullif(u.email, '') from auth.users u where u.id = uid));
    end if;
  end if;
  -- děti z telefonu, jen když je hlavní účet ještě nemá (prázdný profil nikdy nic nepřepíše)
  if not exists (select 1 from children where family_id = uid) then
    update children set family_id = uid where family_id = src;
  end if;

  update plays set family_id = uid where family_id = src;
  insert into family_day (family_id, day, plays, seconds, completed)
    select uid, day, plays, seconds, completed from family_day where family_id = src
    on conflict (family_id, day) do update set plays = family_day.plays + excluded.plays,
      seconds = family_day.seconds + excluded.seconds, completed = family_day.completed + excluded.completed;
  delete from family_day where family_id = src;
  insert into family_usage (family_id, day, name_changes, kid_changes, town_changes, tts_clips, tts_chars)
    select uid, day, name_changes, kid_changes, town_changes, tts_clips, tts_chars from family_usage where family_id = src
    on conflict (family_id, day) do update set name_changes = family_usage.name_changes + excluded.name_changes,
      kid_changes = family_usage.kid_changes + excluded.kid_changes, town_changes = family_usage.town_changes + excluded.town_changes,
      tts_clips = family_usage.tts_clips + excluded.tts_clips, tts_chars = family_usage.tts_chars + excluded.tts_chars;
  delete from family_usage where family_id = src;
  update store_subs set family_id = uid where family_id = src;
  update store_events set family_id = uid where family_id = src;
  insert into access_grants (user_id, code_id, until, created_at)
    select uid, code_id, until, created_at from access_grants where user_id = src
    on conflict (user_id, code_id) do update set until = greatest(access_grants.until, excluded.until);
  -- kupóny: uplatnění a přístup přejdou na hlavní účet (dřív, než se starý účet smaže a vazba by se ztratila)
  update coupon_redemptions set family_id = uid where family_id = src;
  update coupon_codes set used_by = uid where used_by = src;
  update families t set promo_until = greatest(t.promo_until, s.promo_until) from families s where t.id = uid and s.id = src;
  update push_subs set user_id = uid where user_id = src;
  -- hlavní účet převezme souhlas se statistikami, obec a předplatné, pokud je měl jen starý účet
  update families t set analytics = t.analytics or s.analytics, analytics_at = coalesce(t.analytics_at, s.analytics_at),
    source = coalesce(t.source, s.source), created_at = least(t.created_at, s.created_at),
    town = coalesce(t.town, s.town), country = coalesce(t.country, s.country), premium = t.premium or s.premium,
    onboarded = t.onboarded or s.onboarded, settings = coalesce(t.settings, s.settings)
    from families s where t.id = uid and s.id = src;

  delete from families where id = src;
  -- prázdný anonymní účet pryč (účet s e-mailem nikdy nemažeme)
  delete from auth.users where id = src and is_anonymous;
end $$;

commit;
