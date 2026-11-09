-- Ospalek – databáze pro ostrá data (Supabase, region EU – Irsko, eu-west-1).
-- Spuštění: Supabase → SQL Editor → vložit celý soubor → Run. Dá se spustit opakovaně.
-- Návod k zapojení: supabase/README.md.
--
-- Zásady:
--  * Klienti nesmí do tabulek přímo (RLS zapnuté, žádné politiky). Aplikace zapisuje jen přes funkce app_*,
--    které vždy pracují s rodinou přihlášeného uživatele (auth.uid()); administrace čte přes admin_*,
--    které nejdřív ověří, že volající je v tabulce staff.
--  * Rodina = anonymní účet Supabase (anonymous sign-in), e-mail jen při skutečném přihlášení. Rodina (účet, děti, obec,
--    zařízení) je v databázi vždy – je to evidence zákazníků pro podporu (CRM).
--  * Statistiky poslechu a zdroj návštěvy jsou analytika: k rodině se přiřadí jen se souhlasem (families.analytics).
--    Bez souhlasu se poslech uloží anonymně (bez rodiny, čas zaokrouhlený na hodinu). Odvolání souhlasu
--    dosavadní poslechy rodiny anonymizuje.
--  * Statistiky se nečtou ze surových poslechů: trigger průběžně plní denní souhrny family_day a daily_cat.
--  * Dny se počítají v časovém pásmu Europe/Prague.

-- ---------- Tabulky ----------
create table if not exists public.families (
  id uuid primary key references auth.users(id) on delete cascade,
  seq bigint generated always as identity unique,            -- krátké číslo do administrace (f00042)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  provider text not null default 'guest' check (provider in ('guest', 'google', 'apple', 'email')),
  email text check (email is null or char_length(email) <= 254),
  town text check (char_length(town) <= 80),
  country text check (country in ('CZ', 'SK')),
  platform text check (char_length(platform) <= 20),
  app_version text check (char_length(app_version) <= 20),
  source text check (char_length(source) <= 60),
  onboarded boolean not null default false,
  premium boolean not null default false,
  analytics boolean not null default false,                  -- souhlas se statistikami poslechu
  analytics_at timestamptz
);
alter table public.families add column if not exists analytics boolean not null default false;
alter table public.families add column if not exists analytics_at timestamptz;

create table if not exists public.children (
  family_id uuid not null references public.families(id) on delete cascade,
  id text not null check (char_length(id) <= 20),
  name text not null check (char_length(name) between 1 and 40),
  gender text not null check (gender in ('m', 'f')),
  age smallint check (age between 0 and 15),
  primary key (family_id, id)
);

create table if not exists public.plays (
  id uuid primary key,                                        -- vytváří aplikace, opakované odeslání nic nezdvojí
  family_id uuid references public.families(id) on delete cascade,  -- null = anonymní poslech (bez souhlasu)
  story_id text not null check (char_length(story_id) <= 40),
  category text check (char_length(category) <= 20),
  started_at timestamptz not null default now(),
  listened_sec integer not null default 0 check (listened_sec between 0 and 7200),
  progress real not null default 0 check (progress between 0 and 1),
  completed boolean not null default false,
  heroes smallint not null default 1 check (heroes between 1 and 10),
  voice text check (char_length(voice) <= 20)
);
alter table public.plays alter column family_id drop not null;
create index if not exists plays_family_idx on public.plays (family_id, started_at desc);
create index if not exists plays_started_idx on public.plays (started_at);

-- denní souhrn po rodinách (plní trigger)
create table if not exists public.family_day (
  family_id uuid not null references public.families(id) on delete cascade,
  day date not null,
  plays integer not null default 0,
  seconds integer not null default 0,
  completed integer not null default 0,
  primary key (family_id, day)
);
create index if not exists family_day_day_idx on public.family_day (day);

-- denní souhrn anonymních poslechů (plní trigger)
create table if not exists public.daily_anon (
  day date primary key,
  plays integer not null default 0,
  seconds integer not null default 0,
  completed integer not null default 0
);

-- denní souhrn po kategoriích (plní trigger)
create table if not exists public.daily_cat (
  day date not null,
  category text not null,
  plays integer not null default 0,
  primary key (day, category)
);

create table if not exists public.staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role text not null default 'support' check (role in ('owner', 'support', 'content', 'analyst', 'finance')),
  created_at timestamptz not null default now()
);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid references auth.users(id) on delete set null,
  action text not null,
  target text,
  detail text
);

alter table public.families enable row level security;
alter table public.children enable row level security;
alter table public.plays enable row level security;
alter table public.family_day enable row level security;
alter table public.daily_cat enable row level security;
alter table public.daily_anon enable row level security;
alter table public.staff enable row level security;
alter table public.audit_log enable row level security;

-- ---------- Průběžné souhrny ----------
-- Přičte (sgn = 1) nebo odečte (sgn = -1) jeden poslech v souhrnech. Odečítá se jen update, aby smazání
-- rodiny (kaskáda) nezkoušelo vkládat řádky k rodině, která už neexistuje.
create or replace function public.plays_apply(r public.plays, sgn int) returns void language plpgsql security definer set search_path = public as $$
declare d date := (r.started_at at time zone 'Europe/Prague')::date;
begin
  if sgn > 0 then
    insert into daily_cat (day, category, plays) values (d, coalesce(r.category, '?'), 1)
      on conflict (day, category) do update set plays = daily_cat.plays + 1;
    if r.family_id is null then
      insert into daily_anon (day, plays, seconds, completed) values (d, 1, r.listened_sec, r.completed::int)
        on conflict (day) do update set plays = daily_anon.plays + 1, seconds = daily_anon.seconds + excluded.seconds, completed = daily_anon.completed + excluded.completed;
    else
      insert into family_day (family_id, day, plays, seconds, completed) values (r.family_id, d, 1, r.listened_sec, r.completed::int)
        on conflict (family_id, day) do update set plays = family_day.plays + 1, seconds = family_day.seconds + excluded.seconds, completed = family_day.completed + excluded.completed;
    end if;
  else
    update daily_cat set plays = plays - 1 where day = d and category = coalesce(r.category, '?');
    if r.family_id is null then
      update daily_anon set plays = plays - 1, seconds = seconds - r.listened_sec, completed = completed - r.completed::int where day = d;
    else
      update family_day set plays = plays - 1, seconds = seconds - r.listened_sec, completed = completed - r.completed::int where family_id = r.family_id and day = d;
    end if;
  end if;
end $$;

create or replace function public.plays_rollup() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.listened_sec = new.listened_sec and old.completed = new.completed
     and old.family_id is not distinct from new.family_id and old.started_at = new.started_at then return new; end if;
  if tg_op in ('UPDATE', 'DELETE') then perform plays_apply(old, -1); end if;
  if tg_op in ('INSERT', 'UPDATE') then perform plays_apply(new, 1); return new; end if;
  return old;
end $$;
drop trigger if exists plays_rollup on public.plays;
create trigger plays_rollup after insert or update or delete on public.plays for each row execute function public.plays_rollup();

-- ---------- Funkce pro aplikaci ----------
-- Uloží rodinu přihlášeného (anonymního) uživatele a nahradí seznam dětí.
create or replace function public.app_sync_family(p jsonb) returns bigint language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); s bigint; consent boolean; was boolean;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  consent := coalesce((p->>'analytics')::boolean, false);
  select f.analytics into was from families f where f.id = uid;
  -- nejdřív úprava; založení jen poprvé (insert … on conflict by při každém uložení spotřeboval číslo rodiny)
  update families f set
    provider = coalesce(p->>'provider', 'guest'), email = nullif(p->>'email', ''), town = nullif(p->>'town', ''), country = nullif(p->>'country', ''),
    platform = p->>'platform', app_version = p->>'app_version', onboarded = coalesce((p->>'onboarded')::boolean, false),
    premium = coalesce((p->>'premium')::boolean, false), analytics = consent,
    analytics_at = case when consent and not f.analytics then now() when consent then f.analytics_at end,
    source = case when consent then coalesce(f.source, p->>'source') end, updated_at = now(), last_seen_at = now()
  where f.id = uid returning f.seq into s;
  if s is null then
    insert into families (id, provider, email, town, country, platform, app_version, source, onboarded, premium, analytics, analytics_at)
    values (uid, coalesce(p->>'provider', 'guest'), nullif(p->>'email', ''), nullif(p->>'town', ''), nullif(p->>'country', ''),
            p->>'platform', p->>'app_version', case when consent then p->>'source' end, coalesce((p->>'onboarded')::boolean, false),
            coalesce((p->>'premium')::boolean, false), consent, case when consent then now() end)
    returning seq into s;
  end if;
  -- odvolaný souhlas: poslechy rodiny se odpojí a čas se zaokrouhlí na hodinu (zůstanou jen v anonymních součtech)
  if was and not consent then
    update plays set family_id = null, started_at = date_trunc('hour', started_at) where family_id = uid;
    delete from family_day where family_id = uid;
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

-- Zapíše nebo doplní jeden poslech (začátek i konec posílá aplikace pod stejným id).
-- O tom, jestli se poslech přiřadí k rodině, rozhoduje souhlas uložený v databázi, ne aplikace.
create or replace function public.app_play(p jsonb) returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); consent boolean; fid uuid; at timestamptz;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select f.analytics into consent from families f where f.id = uid;
  if consent is null then return; end if;
  fid := case when consent then uid end;
  at := least(coalesce((p->>'started_at')::timestamptz, now()), now());
  if not consent then at := date_trunc('hour', at); end if;
  insert into plays (id, family_id, story_id, category, started_at, listened_sec, progress, completed, heroes, voice)
  values ((p->>'id')::uuid, fid, p->>'story', p->>'category', at,
          least(greatest(coalesce((p->>'sec')::int, 0), 0), 7200), least(greatest(coalesce((p->>'progress')::real, 0), 0), 1),
          coalesce((p->>'completed')::boolean, false), least(greatest(coalesce((p->>'heroes')::int, 1), 1), 10), p->>'voice')
  on conflict (id) do update set
    listened_sec = greatest(plays.listened_sec, excluded.listened_sec),
    progress = greatest(plays.progress, excluded.progress),
    completed = plays.completed or excluded.completed
  where plays.family_id is not distinct from fid;
  update families set last_seen_at = now() where id = uid;
end $$;

-- Smaže rodinu i anonymní účet (tlačítko „Smazat všechna data“ v aplikaci).
create or replace function public.app_delete_family() returns void language plpgsql security definer set search_path = public, auth as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return; end if;
  delete from public.families where id = uid;
  delete from auth.users where id = uid;
end $$;

-- ---------- Funkce pro administraci ----------
create or replace function public.is_staff() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where user_id = auth.uid());
$$;
create or replace function public.require_staff() returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
end $$;

create or replace function public.admin_me() returns table (name text, role text) language sql stable security definer set search_path = public as $$
  select s.name, s.role from staff s where s.user_id = auth.uid();
$$;

drop function if exists public.admin_families(); -- při změně sloupců nejde jen „replace“
-- Souhrn rodin (sloupce jako v administraci). Za 30 dní = posledních 30 dní včetně dneška.
create or replace function public.admin_families() returns table (
  id uuid, seq bigint, created_at timestamptz, last_seen_at timestamptz, provider text, email text, town text, country text,
  platform text, app_version text, source text, onboarded boolean, premium boolean, analytics boolean, kids jsonb,
  plays bigint, seconds bigint, completed bigint, days bigint, plays30 bigint, seconds30 bigint, days30 bigint, last_day date, fav_category text
) language plpgsql stable security definer set search_path = public as $$
declare today date := (now() at time zone 'Europe/Prague')::date;
begin
  perform require_staff();
  return query
  select f.id, f.seq, f.created_at, f.last_seen_at, f.provider, f.email, f.town, f.country, f.platform, f.app_version, f.source, f.onboarded, f.premium, f.analytics,
    coalesce((select jsonb_agg(jsonb_build_object('name', c.name, 'g', c.gender, 'age', c.age) order by c.id) from children c where c.family_id = f.id), '[]'::jsonb),
    coalesce(a.plays, 0), coalesce(a.seconds, 0), coalesce(a.completed, 0), coalesce(a.days, 0),
    coalesce(a.plays30, 0), coalesce(a.seconds30, 0), coalesce(a.days30, 0), a.last_day,
    (select p.category from plays p where p.family_id = f.id group by p.category order by count(*) desc limit 1)
  from families f
  left join lateral (
    select sum(d.plays)::bigint plays, sum(d.seconds)::bigint seconds, sum(d.completed)::bigint completed, count(*)::bigint days,
      sum(d.plays) filter (where d.day > today - 30)::bigint plays30, sum(d.seconds) filter (where d.day > today - 30)::bigint seconds30,
      count(*) filter (where d.day > today - 30)::bigint days30, max(d.day) last_day
    from family_day d where d.family_id = f.id and d.plays > 0
  ) a on true
  order by f.created_at desc;
end $$;

-- Denní řada za posledních n dní (včetně dnů bez aktivity). Přehrání a minuty zahrnují i anonymní poslechy,
-- aktivní rodiny (dau) jen rodiny se souhlasem.
create or replace function public.admin_daily(n int default 180) returns table (
  day date, plays bigint, seconds bigint, completed bigint, dau bigint, registrations bigint, premium bigint, cats jsonb
) language plpgsql stable security definer set search_path = public as $$
declare today date := (now() at time zone 'Europe/Prague')::date;
begin
  perform require_staff();
  return query
  select g.day::date,
    coalesce(fd.plays, 0) + coalesce(an.plays, 0), coalesce(fd.seconds, 0) + coalesce(an.seconds, 0), coalesce(fd.completed, 0) + coalesce(an.completed, 0), coalesce(fd.dau, 0),
    (select count(*) from families f where (f.created_at at time zone 'Europe/Prague')::date = g.day::date),
    (select count(*) from families f where f.premium and (f.created_at at time zone 'Europe/Prague')::date <= g.day::date),
    coalesce((select jsonb_object_agg(dc.category, dc.plays) from daily_cat dc where dc.day = g.day::date), '{}'::jsonb)
  from generate_series(today - (n - 1), today, interval '1 day') g(day)
  left join lateral (
    select sum(d.plays)::bigint plays, sum(d.seconds)::bigint seconds, sum(d.completed)::bigint completed, count(*) filter (where d.plays > 0)::bigint dau
    from family_day d where d.day = g.day::date
  ) fd on true
  left join daily_anon an on an.day = g.day::date
  order by 1;
end $$;

-- Kohorty po týdnech: týden registrace × kolikátý týden poté × počet aktivních rodin. Týden začíná pondělím.
create or replace function public.admin_cohorts(weeks int default 26) returns table (cohort date, week_offset int, families bigint) language plpgsql stable security definer set search_path = public as $$
begin
  perform require_staff();
  return query
  with f as (
    select id, date_trunc('week', created_at at time zone 'Europe/Prague')::date cw from families
    where created_at > now() - make_interval(weeks => weeks)
  ), act as (
    select distinct d.family_id, date_trunc('week', d.day)::date aw from family_day d where d.plays > 0
  )
  select f.cw, 0, count(*) from f group by f.cw
  union all
  select f.cw, ((a.aw - f.cw) / 7)::int, count(distinct f.id) from f join act a on a.family_id = f.id and a.aw > f.cw group by f.cw, ((a.aw - f.cw) / 7)::int
  order by 1, 2;
end $$;

-- Týdně aktivní rodiny.
create or replace function public.admin_wau(weeks int default 26) returns table (week date, families bigint) language plpgsql stable security definer set search_path = public as $$
begin
  perform require_staff();
  return query
  select date_trunc('week', d.day)::date, count(distinct d.family_id) from family_day d
  where d.plays > 0 and d.day > (now() at time zone 'Europe/Prague')::date - weeks * 7
  group by 1 order by 1;
end $$;

-- Den v týdnu (0 = pondělí) × hodina, za posledních n dní.
create or replace function public.admin_heat(n int default 180) returns table (dow int, hour int, plays bigint) language plpgsql stable security definer set search_path = public as $$
begin
  perform require_staff();
  return query
  select ((extract(isodow from p.started_at at time zone 'Europe/Prague'))::int - 1), extract(hour from p.started_at at time zone 'Europe/Prague')::int, count(*)
  from plays p where p.started_at > now() - make_interval(days => n) group by 1, 2;
end $$;

create or replace function public.admin_stories() returns table (story_id text, plays bigint, completed bigint, seconds bigint, families bigint) language plpgsql stable security definer set search_path = public as $$
begin
  perform require_staff();
  return query select p.story_id, count(*), count(*) filter (where p.completed), sum(p.listened_sec)::bigint, count(distinct p.family_id) from plays p group by 1;
end $$;

-- Poslechy jedné rodiny (detail v administraci).
create or replace function public.admin_family_plays(fseq bigint, n int default 180) returns table (started_at timestamptz, story_id text, category text, listened_sec int, completed boolean, heroes smallint) language plpgsql stable security definer set search_path = public as $$
begin
  perform require_staff();
  return query select p.started_at, p.story_id, p.category, p.listened_sec, p.completed, p.heroes from plays p join families f on f.id = p.family_id
    where f.seq = fseq and p.started_at > now() - make_interval(days => n) order by p.started_at;
end $$;

create or replace function public.admin_staff() returns table (user_id uuid, name text, role text, email text, last_sign_in_at timestamptz) language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform require_staff();
  return query select s.user_id, s.name, s.role, u.email::text, u.last_sign_in_at from staff s join auth.users u on u.id = s.user_id order by s.created_at;
end $$;

create or replace function public.admin_log(action text, target text, detail text) returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_staff();
  insert into audit_log (actor, action, target, detail) values (auth.uid(), left(action, 40), left(target, 120), left(detail, 500));
end $$;

create or replace function public.admin_audit(n int default 1000) returns table (at timestamptz, actor_name text, action text, target text, detail text) language plpgsql stable security definer set search_path = public as $$
begin
  perform require_staff();
  return query select a.at, s.name, a.action, a.target, a.detail from audit_log a left join staff s on s.user_id = a.actor order by a.at desc limit n;
end $$;

-- Smazání rodiny z administrace (žádost o výmaz podle GDPR).
create or replace function public.admin_delete_family(fseq bigint) returns void language plpgsql security definer set search_path = public, auth as $$
declare uid uuid;
begin
  perform require_staff();
  if (select role from staff where user_id = auth.uid()) <> 'owner' then raise exception 'forbidden' using errcode = '42501'; end if;
  select id into uid from families where seq = fseq;
  if uid is null then return; end if;
  delete from public.families where id = uid;
  delete from auth.users where id = uid;
  insert into audit_log (actor, action, target, detail) values (auth.uid(), 'family.delete', 'f' || lpad(fseq::text, 5, '0'), 'Smazání rodiny (GDPR)');
end $$;

-- ---------- Práva ----------
-- Funkce smí volat jen přihlášení (rodiny jsou přihlášené anonymně); anonymní klíč bez přihlášení nic nezmůže.
revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.app_sync_family(jsonb), public.app_play(jsonb), public.app_delete_family() to authenticated;
grant execute on function public.admin_me(), public.admin_families(), public.admin_daily(int), public.admin_cohorts(int), public.admin_wau(int),
  public.admin_heat(int), public.admin_stories(), public.admin_family_plays(bigint, int), public.admin_staff(),
  public.admin_log(text, text, text), public.admin_audit(int), public.admin_delete_family(bigint) to authenticated;
