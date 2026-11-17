-- Zabezpečení před produkcí, 17. 11. 2026 (audit-pred-produkci.md). Spusť jednou v Supabase → SQL Editor;
-- jde spustit i opakovaně. Kdo spouští celé supabase/schema.sql, má tohle už v něm.
--
-- Co se mění:
--  1. Hlas (tts-worker): nová věta z ElevenLabs se namluví jen přihlášené rodině a v mezích limitů (tts_limits, app_tts_allow).
--     NEJDŘÍV spusť tuhle migraci, POTOM nasaď tts-worker – bez funkce app_tts_allow worker nové věty nenamluví.
--  2. app_sync_family: nastavení od klienta jen ze známých klíčů a typů (dřív libovolný JSON → cizí kód v administraci),
--     platforma a verze jen z bezpečných znaků, obec bez značek, nejvýš 6 dětí.
--  3. Pozvánky do týmu: roli dostane jen účet s potvrzeným e-mailem.
--  4. admin_families: jména dětí a celý e-mail jen rolím owner, support a finance (dřív to hlídal jen prohlížeč).
--  5. admin_log: jen akce ve tvaru „oblast.akce“.
--  6. Nákupy (store_record): starý doklad z telefonu nepřepíše vrácené peníze ani novější stav, původní rodině se po
--     převodu nákupu předplatné přepočítá, ID rodiny od obchodu nemusí být UUID; limit ověření na účet (store_touch).
--  7. Kód přístupu: zámek proti souběhu u max_uses. Sloučení účtů: přístup z kódu se přesune, nekopíruje.
--  8. Práva: app_merge_* a admin_story_ratings jen pro přihlášené.

-- ---------- 1. Hlas: limity a povolení nové věty ----------
create table if not exists public.tts_limits (
  id int primary key default 1 check (id = 1),
  family_day int not null default 70000,
  family_month int not null default 160000,
  global_day int not null default 600000
);
insert into public.tts_limits (id) values (1) on conflict (id) do nothing;
create index if not exists family_usage_day_idx on public.family_usage (day);   -- celkový denní strop se čte při každé nové větě
alter table public.tts_limits enable row level security;

create or replace function public.app_tts_allow(chars int) returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); l tts_limits; today date := (now() at time zone 'Europe/Prague')::date;
  n int := greatest(0, least(coalesce(chars, 0), 1000)); d bigint; m bigint; g bigint;
begin
  if uid is null then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  -- První pohádka se může připravovat dřív, než aplikace stihne rodinu uložit (app_sync_family jde s malým zpožděním).
  -- Účet proto dostane prázdný záznam rodiny hned, aby se mu věty počítaly do limitů; uložení rodiny ho pak jen doplní.
  -- (ne „insert … on conflict“: ten by při každé větě spotřeboval číslo rodiny)
  if not exists (select 1 from families where id = uid) then
    insert into families (id) values (uid) on conflict (id) do nothing;
  end if;
  select * into l from tts_limits where id = 1;
  if l.id is null then return jsonb_build_object('ok', true); end if;
  select coalesce(sum(u.tts_chars) filter (where u.day = today), 0), coalesce(sum(u.tts_chars), 0) into d, m
    from family_usage u where u.family_id = uid and u.day > today - 30;
  if d + n > l.family_day then return jsonb_build_object('ok', false, 'error', 'family'); end if;
  if m + n > l.family_month then return jsonb_build_object('ok', false, 'error', 'month'); end if;
  select coalesce(sum(u.tts_chars), 0) into g from family_usage u where u.day = today;
  if g + n > l.global_day then return jsonb_build_object('ok', false, 'error', 'global'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- 2. Rodina od klienta ----------
create or replace function public.clean_settings(j jsonb) returns jsonb language sql immutable set search_path = public as $$
  select case when j is null or jsonb_typeof(j) <> 'object' then null else jsonb_strip_nulls(jsonb_build_object(
    'theme', case when j->>'theme' in ('auto', 'light', 'dark') then j->>'theme' end,
    'notify', case when j->>'notify' in ('on', 'off', 'ask') then j->>'notify' end,
    'relatives', case when jsonb_typeof(j->'relatives') = 'number' then least(greatest(floor((j->>'relatives')::numeric), 0), 99)::int end,
    'places', case when jsonb_typeof(j->'places') = 'number' then least(greatest(floor((j->>'places')::numeric), 0), 99)::int end,
    'heroes', case when jsonb_typeof(j->'heroes') = 'number' then least(greatest(floor((j->>'heroes')::numeric), 0), 99)::int end,
    'favs', case when jsonb_typeof(j->'favs') = 'number' then least(greatest(floor((j->>'favs')::numeric), 0), 9999)::int end,
    'heard', case when jsonb_typeof(j->'heard') = 'number' then least(greatest(floor((j->>'heard')::numeric), 0), 99999)::int end,
    'changesMonth', case when jsonb_typeof(j->'changesMonth') = 'number' then least(greatest(floor((j->>'changesMonth')::numeric), 0), 999)::int end,
    'code', case when jsonb_typeof(j->'code') = 'boolean' then (j->>'code')::boolean end)) end;
$$;
create or replace function public.clean_tag(t text) returns text language sql immutable set search_path = public as $$
  select case when t ~ '^[A-Za-z0-9.?_ -]{1,20}$' then t end;
$$;

create or replace function public.app_sync_family(p jsonb) returns bigint language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); s bigint; consent boolean; was boolean; mail text; prov text; news boolean;
  old_town text; old_onb boolean; n_names int := 0; n_kids int := 0; n_town int := 0;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  -- vstup od klienta: nastavení jen známé klíče, technické údaje jen bezpečné znaky, obec bez značek, nejvýš 6 dětí
  p := p || jsonb_build_object('settings', clean_settings(p->'settings'), 'platform', clean_tag(p->>'platform'), 'app_version', clean_tag(p->>'app_version'),
    'town', left(btrim(regexp_replace(coalesce(p->>'town', ''), '[<>[:cntrl:]]', '', 'g')), 80),
    'source', left(regexp_replace(coalesce(p->>'source', ''), '[<>[:cntrl:]]', '', 'g'), 60));
  if p->>'source' = '' then p := p - 'source'; end if;
  if jsonb_typeof(p->'children') = 'array' and jsonb_array_length(p->'children') > 6 then
    p := jsonb_set(p, '{children}', (select jsonb_agg(x) from (select x from jsonb_array_elements(p->'children') with ordinality t(x, i) order by i limit 6) q));
  end if;
  consent := coalesce((p->>'analytics')::boolean, false);
  select f.analytics, f.town, f.onboarded into was, old_town, old_onb from families f where f.id = uid;
  -- e-mail jen z ověřeného účtu (přihlášení přes Google / Apple), ne z toho, co pošle aplikace
  select nullif(u.email, '') into mail from auth.users u where u.id = uid;
  prov := case when mail is null and p->>'provider' in ('google', 'apple', 'email') then 'device' else coalesce(p->>'provider', 'guest') end;
  news := mail is not null and coalesce((p->>'newsletter')::boolean, false);
  -- nejdřív úprava; založení jen poprvé (insert … on conflict by při každém uložení spotřeboval číslo rodiny)
  update families f set
    provider = prov, email = mail,
    newsletter = news, newsletter_at = case when news and not f.newsletter then now() when news then f.newsletter_at end, town = nullif(p->>'town', ''), country = nullif(p->>'country', ''),
    platform = p->>'platform', app_version = p->>'app_version', onboarded = coalesce((p->>'onboarded')::boolean, false),
    premium = coalesce((p->>'premium')::boolean, false), analytics = consent,
    analytics_at = case when consent and not f.analytics then now() when consent then f.analytics_at end,
    source = case when consent then coalesce(f.source, p->>'source') end, updated_at = now(), last_seen_at = now(),
    settings = case when jsonb_typeof(p->'settings') = 'object' then p->'settings' else f.settings end
  where f.id = uid returning f.seq into s;
  if s is null then
    insert into families (id, provider, email, newsletter, newsletter_at, town, country, platform, app_version, source, onboarded, premium, analytics, analytics_at, settings)
    values (uid, prov, mail, news, case when news then now() end, nullif(p->>'town', ''), nullif(p->>'country', ''),
            p->>'platform', p->>'app_version', case when consent then p->>'source' end, coalesce((p->>'onboarded')::boolean, false),
            coalesce((p->>'premium')::boolean, false), consent, case when consent then now() end,
            case when jsonb_typeof(p->'settings') = 'object' then p->'settings' end)
    returning seq into s;
  end if;
  -- odvolaný souhlas: poslechy rodiny se odpojí a čas se zaokrouhlí na hodinu (zůstanou jen v anonymních součtech)
  if was and not consent then
    update plays set family_id = null, started_at = date_trunc('hour', started_at) where family_id = uid;
    delete from family_day where family_id = uid;
  end if;
  -- změny po dokončené registraci (každá znamená nové věty k namluvení): jména dětí, přidané a odebrané dítě, obec
  if old_onb then
    n_town := case when nullif(p->>'town', '') is distinct from old_town then 1 else 0 end;
    if jsonb_typeof(p->'children') = 'array' then
      select count(*) filter (where c.id is not null and c.name <> left(x->>'name', 40)), count(*) filter (where c.id is null)
        into n_names, n_kids
        from jsonb_array_elements(p->'children') x left join children c on c.family_id = uid and c.id = x->>'id'
        where coalesce(x->>'name', '') <> '';
      n_kids := n_kids + (select count(*) from children c where c.family_id = uid
        and not exists (select 1 from jsonb_array_elements(p->'children') x where x->>'id' = c.id and coalesce(x->>'name', '') <> ''));
    end if;
    if n_names + n_kids + n_town > 0 then perform usage_add(uid, n_names, n_kids, n_town, 0, 0); end if;
  end if;
  if jsonb_typeof(p->'children') = 'array' then
    delete from children c where c.family_id = uid and not exists (select 1 from jsonb_array_elements(p->'children') x where x->>'id' = c.id);
    insert into children (family_id, id, name, gender, age)
    select uid, x->>'id', left(x->>'name', 40), case when x->>'gender' = 'f' then 'f' else 'm' end, nullif(x->>'age', '')::smallint
    from jsonb_array_elements(p->'children') x where coalesce(x->>'name', '') <> ''
    on conflict (family_id, id) do update set name = excluded.name, gender = excluded.gender, age = excluded.age;
  end if;
  return s;
end $$;

-- ---------- 3. Pozvánky do týmu ----------
create or replace function public.staff_invite_apply() returns trigger language plpgsql security definer set search_path = public as $$
declare i staff_invites;
begin
  if new.email is null then return new; end if;
  -- roli dostane jen účet s potvrzeným e-mailem: registrace s cizím (pozvaným) e-mailem bez potvrzení nic nezíská
  -- (migrations/20261117_zabezpeceni.sql). to_jsonb kvůli lokální simulaci, kde auth.users sloupec nemá.
  if to_jsonb(new) ? 'email_confirmed_at' and (to_jsonb(new)->>'email_confirmed_at') is null then return new; end if;
  delete from staff_invites where email = lower(new.email) returning * into i;
  if i.email is not null then
    insert into staff (user_id, name, role) values (new.id, i.name, i.role) on conflict (user_id) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists staff_invite_apply on auth.users;
create trigger staff_invite_apply after insert or update of email on auth.users for each row execute function public.staff_invite_apply();
-- potvrzení e-mailu přijde až po založení účtu: spoušť musí zabrat i na něj (sloupec v lokální simulaci chybí)
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'email_confirmed_at') then
    drop trigger if exists staff_invite_apply on auth.users;
    create trigger staff_invite_apply after insert or update of email, email_confirmed_at on auth.users for each row execute function public.staff_invite_apply();
  end if;
end $$;
-- ---------- 4. a 5. Administrace ----------
drop function if exists public.admin_families(); -- při změně sloupců nejde jen „replace“
create or replace function public.admin_families() returns table (
  id uuid, seq bigint, created_at timestamptz, last_seen_at timestamptz, provider text, email text, town text, country text,
  platform text, app_version text, source text, onboarded boolean, premium boolean, analytics boolean, kids jsonb,
  plays bigint, seconds bigint, completed bigint, days bigint, plays30 bigint, seconds30 bigint, days30 bigint, last_day date, fav_category text,
  newsletter boolean, newsletter_at timestamptz, analytics_at timestamptz, settings jsonb, push_devices bigint, usage jsonb
) language plpgsql stable security definer set search_path = public as $$
declare today date := (now() at time zone 'Europe/Prague')::date; pii boolean;
begin
  perform require_staff();
  -- jména dětí a celý e-mail jen rolím s oprávněním „Vidět jména a e-maily“ (admin/api.js: owner, support, finance);
  -- ostatním e-mail s tečkami a děti beze jména – dřív to hlídal jen prohlížeč (migrations/20261117_zabezpeceni.sql)
  pii := coalesce((select s.role in ('owner', 'support', 'finance') from staff s where s.user_id = auth.uid()), false);
  return query
  select f.id, f.seq, f.created_at, f.last_seen_at, f.provider,
    case when pii then f.email else regexp_replace(f.email, '^(.).*(@.*)$', '\1•••\2') end,
    f.town, f.country, f.platform, f.app_version, f.source, f.onboarded, f.premium, f.analytics,
    coalesce((select jsonb_agg(jsonb_build_object('name', case when pii then c.name else '' end, 'g', c.gender, 'age', c.age) order by c.id) from children c where c.family_id = f.id), '[]'::jsonb),
    coalesce(a.plays, 0), coalesce(a.seconds, 0), coalesce(a.completed, 0), coalesce(a.days, 0),
    coalesce(a.plays30, 0), coalesce(a.seconds30, 0), coalesce(a.days30, 0), a.last_day,
    (select p.category from plays p where p.family_id = f.id group by p.category order by count(*) desc limit 1),
    f.newsletter, f.newsletter_at, f.analytics_at, f.settings,
    (select count(*) from push_subs ps where ps.user_id = f.id),
    (select jsonb_build_object('names', sum(u.name_changes), 'kids', sum(u.kid_changes), 'towns', sum(u.town_changes),
       'clips', sum(u.tts_clips), 'chars', sum(u.tts_chars),
       'changes30', sum(u.name_changes + u.kid_changes + u.town_changes) filter (where u.day > today - 30),
       'clips30', sum(u.tts_clips) filter (where u.day > today - 30), 'chars30', sum(u.tts_chars) filter (where u.day > today - 30))
     from family_usage u where u.family_id = f.id)
  from families f
  left join lateral (
    select sum(d.plays)::bigint plays, sum(d.seconds)::bigint seconds, sum(d.completed)::bigint completed, count(*)::bigint days,
      sum(d.plays) filter (where d.day > today - 30)::bigint plays30, sum(d.seconds) filter (where d.day > today - 30)::bigint seconds30,
      count(*) filter (where d.day > today - 30)::bigint days30, max(d.day) last_day
    from family_day d where d.family_id = f.id and d.plays > 0
  ) a on true
  order by f.created_at desc;
end $$;

create or replace function public.admin_log(action text, target text, detail text) returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_staff();
  -- akce jen ve tvaru „oblast.akce“ (coupon.create, family.export…), ať do auditu nejde zapsat libovolný text místo akce
  if coalesce(action, '') !~ '^[a-z]{2,20}\.[a-z_]{2,30}$' then raise exception 'Neznámá akce.' using errcode = '22023'; end if;
  insert into audit_log (actor, action, target, detail) values (auth.uid(), left(action, 40), left(target, 120), left(detail, 500));
end $$;

-- ---------- 6. Nákupy ----------
create table if not exists public.store_tries (
  user_id uuid primary key references auth.users(id) on delete cascade,
  since timestamptz not null default now(),
  n int not null default 0
);
alter table public.store_tries enable row level security;
create or replace function public.store_touch(uid uuid) returns boolean language plpgsql security definer set search_path = public as $$
declare t store_tries;
begin
  insert into store_tries as x (user_id, n) values (uid, 1)
    on conflict (user_id) do update set
      n = case when x.since < now() - interval '1 hour' then 1 else x.n + 1 end,
      since = case when x.since < now() - interval '1 hour' then now() else x.since end
    returning * into t;
  return t.n <= 60;
end $$;

create or replace function public.store_record(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare s jsonb := p->'sub'; fam uuid; e jsonb; t text; prev text; r store_subs; old store_subs; stale boolean := false;
begin
  -- rodina od obchodu (obfuscatedAccountId / appAccountToken) nemusí být UUID: cokoli jiného se bere jako „nevíme“
  fam := case when p->>'family' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (p->>'family')::uuid end;
  if fam is not null and not exists (select 1 from families where id = fam) then fam := null; end if;
  select * into old from store_subs z where z.id = s->>'id' for update;
  -- Doklad z telefonu (source = app) může být starý: Apple ho podepsal kdysi a klient ho pošle znovu. Starší doklad
  -- nesmí přepsat novější stav z oznámení obchodu – hlavně vrácené peníze zpátky na „aktivní“.
  -- Platí jen pro doklady z telefonu na iOS (Android se vždy čte živě z Google Play); oznámení obchodu se zapíše vždy.
  if old.id is not null and p->>'source' = 'app' and old.platform = 'ios' and coalesce(s->>'status', '') <> 'refunded' and (
       (old.status = 'refunded' and coalesce((s->>'expires_at')::timestamptz, '-infinity') <= coalesce(old.expires_at, 'infinity'))
       or coalesce((s->>'expires_at')::timestamptz, '-infinity') < coalesce(old.expires_at, '-infinity')) then
    stale := true;
  end if;
  if stale then
    -- stav necháme, jak je; rodina se smí připojit jen tam, kde ještě žádná není
    update store_subs z set family_id = coalesce(z.family_id, fam) where z.id = old.id returning * into r;
    return jsonb_build_object('active', r.status in ('trial', 'active', 'grace') and coalesce(r.expires_at > now(), true), 'trial', r.trial,
      'expires', (extract(epoch from r.expires_at) * 1000)::bigint, 'willRenew', r.will_renew, 'status', r.status);
  end if;
  insert into store_subs as x (id, platform, family_id, product, status, trial, started_at, expires_at, will_renew, country, currency, price, env, token, updated_at)
  values (s->>'id', s->>'platform', fam, s->>'product', s->>'status', coalesce((s->>'trial')::boolean, false), (s->>'started_at')::timestamptz,
          (s->>'expires_at')::timestamptz, coalesce((s->>'will_renew')::boolean, true), s->>'country', s->>'currency', (s->>'price')::numeric,
          coalesce(s->>'env', 'Production'), s->>'token', now())
  on conflict (id) do update set
    family_id = coalesce(excluded.family_id, x.family_id), product = excluded.product, status = excluded.status, trial = excluded.trial,
    started_at = least(x.started_at, excluded.started_at), expires_at = excluded.expires_at, will_renew = excluded.will_renew,
    country = coalesce(excluded.country, x.country), currency = coalesce(excluded.currency, x.currency), price = coalesce(excluded.price, x.price),
    env = excluded.env, token = coalesce(excluded.token, x.token), updated_at = now()
  returning * into r;
  for e in select * from jsonb_array_elements(coalesce(p->'events', '[]'::jsonb)) loop
    t := e->>'type';
    -- první platba po zkušební době = konverze
    if t = 'renew' then
      select ev.type into prev from store_events ev where ev.sub_id = r.id and ev.type in ('trial', 'buy', 'convert', 'renew') and ev.at < (e->>'at')::timestamptz order by ev.at desc limit 1;
      if prev = 'trial' then t := 'convert'; end if;
    end if;
    insert into store_events (key, sub_id, family_id, platform, type, at, period_start, period_end, amount, currency, czk, country, env, detail)
    values (e->>'key', r.id, r.family_id, r.platform, t, (e->>'at')::timestamptz, (e->>'period_start')::timestamptz, (e->>'period_end')::timestamptz,
            coalesce((e->>'amount')::numeric, 0), e->>'currency', coalesce((e->>'czk')::numeric, 0), r.country, r.env, left(e->>'detail', 200))
    on conflict (key) do nothing;
  end loop;
  -- události bez rodiny (přišly dřív, než aplikace nákup ohlásila) se k rodině připojí
  if r.family_id is not null then update store_events set family_id = r.family_id where sub_id = r.id and family_id is null; end if;
  if r.family_id is not null then
    update families set premium = exists (select 1 from store_subs z where z.family_id = r.family_id and z.status in ('trial', 'active', 'grace') and coalesce(z.expires_at, now()) > now() - interval '1 day')
    where id = r.family_id;
  end if;
  -- nákup přešel na jinou rodinu (nový telefon): té původní se předplatné přepočítá, jeden nákup = jedna rodina
  if old.family_id is not null and old.family_id is distinct from r.family_id then
    update families set premium = exists (select 1 from store_subs z where z.family_id = old.family_id and z.status in ('trial', 'active', 'grace') and coalesce(z.expires_at, now()) > now() - interval '1 day')
      or coalesce(public.code_until(old.family_id) > now(), false)
    where id = old.family_id;
  end if;
  return jsonb_build_object('active', r.status in ('trial', 'active', 'grace') and coalesce(r.expires_at > now(), true), 'trial', r.trial,
    'expires', (extract(epoch from r.expires_at) * 1000)::bigint, 'willRenew', r.will_renew, 'status', r.status);
end $$;

-- ---------- 7. Kódy a sloučení účtů ----------
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
  select * into c from access_codes a where a.code_hash = h for update;   -- zámek: dva účty naráz nepřekročí max_uses
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
  -- přesun, ne kopie: starému účtu (zůstává, když má e-mail) kód nezůstane, jinak by šel jeden kód rozdávat dál
  delete from access_grants where user_id = src;
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

-- ---------- 8. Práva ----------
revoke all on public.tts_limits, public.store_tries from anon, authenticated;
revoke execute on function public.app_tts_allow(int), public.clean_settings(jsonb), public.clean_tag(text), public.store_touch(uuid),
  public.admin_families(), public.app_merge_ticket(), public.app_merge_from(uuid), public.admin_story_ratings() from public, anon, authenticated;
grant execute on function public.app_tts_allow(int), public.admin_families(), public.app_merge_ticket(), public.app_merge_from(uuid),
  public.admin_story_ratings() to authenticated;
grant execute on function public.store_touch(uuid) to service_role;
