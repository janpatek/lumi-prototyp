-- Kupóny, 11. 11. 2026. Už spuštěno v produkci. Části s RevenueCat a samostatné uplatnění (app_redeem_coupon)
-- odstraňuje 20261116_kupony_bez_revenuecat.sql, kupóny se teď uplatňují přes „Mám kód“ (app_redeem_code).
-- Kampaně z administrace (admin/kupony.js) se ukládají do databáze a rodina kód uplatní v aplikaci (Nastavení → Předplatné).
-- Spusť jednou v Supabase → SQL Editor. Nová databáze stačí s aktuálním schema.sql (obsahuje stejný blok).

begin;

-- ---------- Kupóny ----------
-- coupons: kampaň. Sdílený kód (mode shared, sloupec code, např. VECERNI) nebo sada jednorázových kódů (mode unique,
-- tabulka coupon_codes, např. ZNAMI-7KQ4-M2PX). id vytváří administrace (c + čas), ať může hned pracovat bez čekání.
-- gives: trial = dny zdarma, months = měsíce zdarma (obojí bez platby, přístup přidělí databáze a RevenueCat),
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
  until timestamptz,                -- do kdy má rodina přístup (trial, months)
  rc_granted_at timestamptz,        -- kdy přístup přidělil RevenueCat (edge funkce coupon-grant)
  rc_error text
);
create index if not exists coupon_red_coupon on public.coupon_redemptions (coupon_id);
create index if not exists coupon_red_family on public.coupon_redemptions (family_id);
-- neúspěšné pokusy: ochrana před hádáním jednorázových kódů (nejvýš 10 za hodinu na rodinu)
create table if not exists public.coupon_tries (
  family_id uuid not null references public.families(id) on delete cascade,
  at timestamptz not null default now()
);
create index if not exists coupon_tries_family on public.coupon_tries (family_id, at);
alter table public.families add column if not exists promo_until timestamptz;
alter table public.coupons enable row level security;
alter table public.coupon_codes enable row level security;
alter table public.coupon_redemptions enable row level security;
alter table public.coupon_tries enable row level security;

-- Uplatnění kódu rodinou. Vrací { ok, msg, until, gives, value }. Texty jsou rovnou pro rodinu (česky, vykání).
create or replace function public.app_redeem_coupon(code text) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  q text := upper(regexp_replace(coalesce(code, ''), '\s', '', 'g'));
  c coupons;
  cc coupon_codes;
  fam families;
  base timestamptz;
  u timestamptz;
  fail text;
begin
  if uid is null then return jsonb_build_object('ok', false, 'msg', 'Nejste přihlášení. Zkuste aplikaci zavřít a otevřít znovu.'); end if;
  insert into families (id) values (uid) on conflict (id) do nothing;
  delete from coupon_tries t where t.family_id = uid and t.at < now() - interval '1 day';
  if (select count(*) from coupon_tries t where t.family_id = uid and t.at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('ok', false, 'msg', 'Příliš mnoho pokusů. Zkuste to prosím za hodinu.');
  end if;

  select * into c from coupons k where k.code = q for update;
  if not found then
    select * into cc from coupon_codes k where k.code = q for update;
    if found then select * into c from coupons k where k.id = cc.coupon_id for update; end if;
  end if;
  select * into fam from families f where f.id = uid for update;

  fail := case
    when c.id is null then 'Tenhle kód neznáme. Zkontrolujte, jestli je opsaný přesně.'
    when cc.code is not null and cc.used_by is not null and cc.used_by <> uid then 'Tenhle kód už někdo použil. Každý jednorázový kód platí jen jednou.'
    when exists (select 1 from coupon_redemptions r where r.coupon_id = c.id and r.family_id = uid) then 'Tenhle kupón už máte uplatněný.'
    when c.paused or now() < c.valid_from then 'Tenhle kód teď neplatí.'
    when c.valid_to is not null and now() >= c.valid_to then 'Platnost kódu už skončila.'
    when c.max_uses is not null and (select count(*) from coupon_redemptions r where r.coupon_id = c.id) >= c.max_uses then 'Kód už je vyčerpaný.'
    when c.gives in ('percent', 'amount') then 'Tohle je slevový kód. Slevu uplatníte při nákupu předplatného v obchodě s aplikacemi.'
    when c.new_only and (fam.premium or exists (select 1 from coupon_redemptions r where r.family_id = uid)) then 'Tenhle kupón je jen pro nové rodiny.'
  end;
  if fail is not null then
    -- neznámý kód se počítá do limitu pokusů, ostatní důvody ne (kód je skutečný)
    if c.id is null then insert into coupon_tries (family_id) values (uid); end if;
    return jsonb_build_object('ok', false, 'msg', fail);
  end if;

  base := greatest(now(), coalesce(fam.promo_until, now()));
  u := case c.gives when 'trial' then base + make_interval(days => c.value) else base + make_interval(months => c.value) end;
  insert into coupon_redemptions (coupon_id, code, family_id, until) values (c.id, q, uid, u);
  if cc.code is not null then update coupon_codes set used_by = uid, used_at = now() where coupon_codes.code = cc.code; end if;
  update families set promo_until = u, updated_at = now() where id = uid;
  return jsonb_build_object('ok', true, 'gives', c.gives, 'value', c.value, 'until', u,
    'msg', 'Kód je uplatněný, všechny pohádky jsou odemčené do ' || to_char(u at time zone 'Europe/Prague', 'FMDD. FMMM. YYYY') || '. Pak se nic samo neplatí.');
end $$;

-- Do kdy má rodina přístup z kupónu (aplikace se ptá při spuštění, ať přístup platí i v jiném zařízení se stejným účtem)
create or replace function public.app_promo() returns timestamptz language sql stable security definer set search_path = public as $$
  select f.promo_until from families f where f.id = auth.uid() and f.promo_until > now();
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
    'redemptions', coalesce((select jsonb_agg(jsonb_build_object('coupon_id', r.coupon_id, 'code', r.code, 'fseq', f.seq, 'at', r.at, 'until', r.until, 'rc', r.rc_granted_at is not null) order by r.at)
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

-- RevenueCat: uplatnění, kterým ještě nebyl přidělen přístup v RevenueCat (edge funkce coupon-grant s tajným klíčem)
create or replace function public.coupon_rc_pending(fam uuid) returns table (id bigint, until timestamptz) language sql stable security definer set search_path = public as $$
  select r.id, r.until from coupon_redemptions r where r.family_id = fam and r.rc_granted_at is null and r.until > now() order by r.until;
$$;
create or replace function public.coupon_rc_mark(rid bigint, ok boolean, err text default null) returns void language sql security definer set search_path = public as $$
  update coupon_redemptions set rc_granted_at = case when ok then now() end, rc_error = case when ok then null else left(err, 300) end where id = rid;
$$;

revoke all on public.coupons, public.coupon_codes, public.coupon_redemptions, public.coupon_tries from anon, authenticated;
revoke execute on function public.app_redeem_coupon(text), public.app_promo(), public.require_coupons(), public.admin_coupons(),
  public.admin_coupon_save(jsonb, jsonb), public.admin_coupon_add_codes(text, jsonb), public.admin_coupon_pause(text, boolean),
  public.coupon_rc_pending(uuid), public.coupon_rc_mark(bigint, boolean, text) from public, anon, authenticated;
grant execute on function public.app_redeem_coupon(text), public.app_promo() to authenticated;
grant execute on function public.admin_coupons(), public.admin_coupon_save(jsonb, jsonb), public.admin_coupon_add_codes(text, jsonb),
  public.admin_coupon_pause(text, boolean) to authenticated;
grant execute on function public.coupon_rc_pending(uuid), public.coupon_rc_mark(bigint, boolean, text) to service_role;

commit;
