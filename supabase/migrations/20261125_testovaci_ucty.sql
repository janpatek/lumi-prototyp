-- Testovací účty a testovací nákupy mimo metriky administrace, 25. 11. 2026.
-- Spusť jednou v Supabase → SQL Editor. Kdo spouští celé supabase/schema.sql, má tohle už v něm.
--  * families.test: true/false ručně z administrace (detail uživatele), null = automaticky (fam_is_test)
--  * automaticky testovací: člen týmu, kód pro recenzenty (access_codes.test), testeři Google Play, dítě jménem „Test“
--  * souhrny pro administraci (admin_daily, admin_cohorts, admin_wau, admin_heat, admin_stories, admin_story_ratings) testovací účty vynechají
--  * admin_families a admin_store vrací příznak test; administrace testovací účty i nákupy (sandbox, licenční testeři) ukazuje zvlášť

begin;

alter table public.families add column if not exists test boolean;
alter table public.access_codes add column if not exists test boolean not null default false;
update public.access_codes set test = true where label = 'Recenzenti obchodů';

create or replace function public.fam_is_test(fid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select f.test from families f where f.id = fid),
    exists (select 1 from staff st where st.user_id = fid)
    or exists (select 1 from access_grants g join access_codes c on c.id = g.code_id where g.user_id = fid and c.test)
    or exists (select 1 from families f where f.id = fid and f.email ~* '(concentrix|wave[0-9]+batch|cloudtestlabaccounts|@google\.com$)')
    or exists (select 1 from children c where c.family_id = fid and lower(trim(c.name)) in ('test', 'tester', 'testík')));
$$;


create or replace function public.admin_set_test(fseq bigint, val boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_staff();
  if (select role from staff where user_id = auth.uid()) not in ('owner', 'support') then raise exception 'forbidden' using errcode = '42501'; end if;
  update families set test = val where seq = fseq;
  insert into audit_log (actor, action, target, detail) values (auth.uid(), 'family.test', 'f' || lpad(fseq::text, 5, '0'),
    case when val is null then 'Testovací účet: automaticky' when val then 'Označen jako testovací účet' else 'Označen jako skutečný uživatel' end);
end $$;


drop function if exists public.admin_families(); -- při změně sloupců nejde jen „replace“
-- Souhrn rodin (sloupce jako v administraci). Za 30 dní = posledních 30 dní včetně dneška.
create or replace function public.admin_families() returns table (
  id uuid, seq bigint, created_at timestamptz, last_seen_at timestamptz, provider text, email text, town text, country text,
  platform text, app_version text, source text, onboarded boolean, premium boolean, analytics boolean, kids jsonb,
  plays bigint, seconds bigint, completed bigint, days bigint, plays30 bigint, seconds30 bigint, days30 bigint, last_day date, fav_category text,
  newsletter boolean, newsletter_at timestamptz, analytics_at timestamptz, settings jsonb, push_devices bigint, usage jsonb,
  test boolean, test_manual boolean, code_until timestamptz, code_test boolean, store_prod bigint, store_test bigint
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
     from family_usage u where u.family_id = f.id),
    fam_is_test(f.id), f.test,
    (select max(g.until) from access_grants g where g.user_id = f.id),
    coalesce((select bool_or(c.test) from access_grants g join access_codes c on c.id = g.code_id where g.user_id = f.id), false),
    (select count(*) from store_subs s where s.family_id = f.id and s.env = 'Production'),
    (select count(*) from store_subs s where s.family_id = f.id and s.env <> 'Production')
  from families f
  left join lateral (
    select sum(d.plays)::bigint plays, sum(d.seconds)::bigint seconds, sum(d.completed)::bigint completed, count(*)::bigint days,
      sum(d.plays) filter (where d.day > today - 30)::bigint plays30, sum(d.seconds) filter (where d.day > today - 30)::bigint seconds30,
      count(*) filter (where d.day > today - 30)::bigint days30, max(d.day) last_day
    from family_day d where d.family_id = f.id and d.plays > 0
  ) a on true
  order by f.created_at desc;
end $$;

create or replace function public.admin_daily(n int default 180) returns table (
  day date, plays bigint, seconds bigint, completed bigint, dau bigint, registrations bigint, premium bigint, cats jsonb
) language plpgsql stable security definer set search_path = public as $$
declare today date := (now() at time zone 'Europe/Prague')::date;
begin
  perform require_staff();
  return query
  select g.day::date,
    coalesce(fd.plays, 0) + coalesce(an.plays, 0), coalesce(fd.seconds, 0) + coalesce(an.seconds, 0), coalesce(fd.completed, 0) + coalesce(an.completed, 0), coalesce(fd.dau, 0),
    (select count(*) from families f where (f.created_at at time zone 'Europe/Prague')::date = g.day::date and not fam_is_test(f.id)),
    (select count(*) from families f where f.premium and (f.created_at at time zone 'Europe/Prague')::date <= g.day::date and not fam_is_test(f.id)),
    -- kategorie: denní souhrn bez poslechů testovacích účtů (anonymní poslechy bez souhlasu odečíst nejde, ty zůstávají)
    coalesce((select jsonb_object_agg(dc.category, greatest(0, dc.plays - coalesce(t.n, 0))) from daily_cat dc
      left join (select p.category, count(*) n from plays p where p.family_id is not null and fam_is_test(p.family_id)
        and (p.started_at at time zone 'Europe/Prague')::date = g.day::date group by 1) t on t.category = dc.category
      where dc.day = g.day::date), '{}'::jsonb)
  from generate_series(today - (n - 1), today, interval '1 day') g(day)
  left join lateral (
    select sum(d.plays)::bigint plays, sum(d.seconds)::bigint seconds, sum(d.completed)::bigint completed, count(*) filter (where d.plays > 0)::bigint dau
    from family_day d where d.day = g.day::date and not fam_is_test(d.family_id)
  ) fd on true
  left join daily_anon an on an.day = g.day::date
  order by 1;
end $$;


create or replace function public.admin_cohorts(weeks int default 26) returns table (cohort date, week_offset int, families bigint) language plpgsql stable security definer set search_path = public as $$
begin
  perform require_staff();
  return query
  with f as (
    select id, date_trunc('week', created_at at time zone 'Europe/Prague')::date cw from families
    where created_at > now() - make_interval(weeks => weeks) and not fam_is_test(id)
  ), act as (
    select distinct d.family_id, date_trunc('week', d.day)::date aw from family_day d where d.plays > 0
  )
  select f.cw, 0, count(*) from f group by f.cw
  union all
  select f.cw, ((a.aw - f.cw) / 7)::int, count(distinct f.id) from f join act a on a.family_id = f.id and a.aw > f.cw group by f.cw, ((a.aw - f.cw) / 7)::int
  order by 1, 2;
end $$;


create or replace function public.admin_wau(weeks int default 26) returns table (week date, families bigint) language plpgsql stable security definer set search_path = public as $$
begin
  perform require_staff();
  return query
  select date_trunc('week', d.day)::date, count(distinct d.family_id) from family_day d
  where d.plays > 0 and d.day > (now() at time zone 'Europe/Prague')::date - weeks * 7 and not fam_is_test(d.family_id)
  group by 1 order by 1;
end $$;


create or replace function public.admin_heat(n int default 180) returns table (dow int, hour int, plays bigint) language plpgsql stable security definer set search_path = public as $$
begin
  perform require_staff();
  return query
  select ((extract(isodow from p.started_at at time zone 'Europe/Prague'))::int - 1), extract(hour from p.started_at at time zone 'Europe/Prague')::int, count(*)
  from plays p where p.started_at > now() - make_interval(days => n) and (p.family_id is null or not fam_is_test(p.family_id)) group by 1, 2;
end $$;


create or replace function public.admin_stories() returns table (story_id text, plays bigint, completed bigint, seconds bigint, families bigint) language plpgsql stable security definer set search_path = public as $$
begin
  perform require_staff();
  return query select p.story_id, count(*), count(*) filter (where p.completed), sum(p.listened_sec)::bigint, count(distinct p.family_id) from plays p where p.family_id is null or not fam_is_test(p.family_id) group by 1;
end $$;


create or replace function public.admin_story_ratings() returns table (story_id text, ratings bigint, avg_rating numeric, loved bigint, liked bigint, meh bigint) language plpgsql stable security definer set search_path = public as $$
begin
  perform require_staff();
  return query select p.story_id, count(*), round(avg(p.rating)::numeric, 2),
    count(*) filter (where p.rating = 3), count(*) filter (where p.rating = 2), count(*) filter (where p.rating = 1)
  from plays p where p.rating is not null and (p.family_id is null or not fam_is_test(p.family_id)) group by 1;
end $$;


create or replace function public.admin_store(sandbox boolean default false) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform require_staff();
  return jsonb_build_object(
    'subs', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'platform', s.platform, 'fam', f.seq, 'product', s.product, 'status', s.status, 'trial', s.trial,
      'started', s.started_at, 'expires', s.expires_at, 'renew', s.will_renew, 'country', s.country, 'currency', s.currency, 'price', s.price, 'env', s.env,
      'test', s.env <> 'Production' or (s.family_id is not null and fam_is_test(s.family_id))) order by s.started_at)
      from store_subs s left join families f on f.id = s.family_id where sandbox or s.env = 'Production'), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'sub', e.sub_id, 'fam', f.seq, 'platform', e.platform, 'type', e.type, 'at', e.at,
      'start', e.period_start, 'end', e.period_end, 'amount', e.amount, 'currency', e.currency, 'czk', e.czk, 'country', e.country, 'env', e.env, 'detail', e.detail,
      'test', e.env <> 'Production' or (e.family_id is not null and fam_is_test(e.family_id))) order by e.at)
      from store_events e left join families f on f.id = e.family_id where sandbox or e.env = 'Production'), '[]'::jsonb));
end $$;


-- zjevně testovací účty z vývoje: náhodná písmena místo obce, naše rodina (Ponětovice) – v administraci jde označení zrušit
update public.families set test = true where seq in (2, 4, 8, 10, 585, 597, 609, 610, 614) and test is null;

revoke execute on function public.fam_is_test(uuid) from public, anon, authenticated;
revoke execute on function public.admin_set_test(bigint, boolean), public.admin_families() from public, anon;
grant execute on function public.admin_set_test(bigint, boolean), public.admin_families() to authenticated;

commit;
