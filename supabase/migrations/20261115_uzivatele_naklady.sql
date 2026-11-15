-- Uživatelé v administraci: nastavení aplikace, souhlasy a variabilní náklady (změny jmen, namluvené věty), 15. 11. 2026.
-- Spusť jednou v Supabase → SQL Editor. Kdo spouští celé supabase/schema.sql, má tohle už v něm.
-- Potom nasaď tts-worker (zapisuje namluvené věty přes app_tts_usage) a web aplikace (posílá nastavení a přihlášení do tts-workeru).

begin;

alter table public.families add column if not exists settings jsonb;   -- nastavení aplikace bez osobních údajů (vzhled, připomínka, počty), posílá app/sync.js

-- Variabilní náklady a změny po uživatelích a dnech (administrace → Uživatelé).
-- name/kid/town_changes počítá app_sync_family z rozdílu proti uloženému stavu,
-- tts_clips/tts_chars zapisuje tts-worker přes app_tts_usage za každou větu, kterou opravdu namluvil ElevenLabs (ne z mezipaměti).
create table if not exists public.family_usage (
  family_id uuid not null references public.families(id) on delete cascade,
  day date not null,
  name_changes int not null default 0,
  kid_changes int not null default 0,
  town_changes int not null default 0,
  tts_clips int not null default 0,
  tts_chars int not null default 0,
  primary key (family_id, day)
);
alter table public.family_usage enable row level security;   -- jen přes funkce

create or replace function public.usage_add(fid uuid, names int, kids int, towns int, clips int, chars int) returns void language sql security definer set search_path = public as $$
  insert into family_usage (family_id, day, name_changes, kid_changes, town_changes, tts_clips, tts_chars)
  values (fid, (now() at time zone 'Europe/Prague')::date, names, kids, towns, clips, chars)
  on conflict (family_id, day) do update set name_changes = family_usage.name_changes + excluded.name_changes,
    kid_changes = family_usage.kid_changes + excluded.kid_changes, town_changes = family_usage.town_changes + excluded.town_changes,
    tts_clips = family_usage.tts_clips + excluded.tts_clips, tts_chars = family_usage.tts_chars + excluded.tts_chars;
$$;

create or replace function public.app_tts_usage(chars int) returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null or not exists (select 1 from families where id = uid) then return; end if;
  perform usage_add(uid, 0, 0, 0, 1, greatest(0, least(coalesce(chars, 0), 1000)));
end $$;

create or replace function public.app_sync_family(p jsonb) returns bigint language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); s bigint; consent boolean; was boolean; mail text; prov text; news boolean;
  old_town text; old_onb boolean; n_names int := 0; n_kids int := 0; n_town int := 0;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
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

drop function if exists public.admin_families(); -- při změně sloupců nejde jen „replace“
-- Souhrn rodin (sloupce jako v administraci). Za 30 dní = posledních 30 dní včetně dneška.
create or replace function public.admin_families() returns table (
  id uuid, seq bigint, created_at timestamptz, last_seen_at timestamptz, provider text, email text, town text, country text,
  platform text, app_version text, source text, onboarded boolean, premium boolean, analytics boolean, kids jsonb,
  plays bigint, seconds bigint, completed bigint, days bigint, plays30 bigint, seconds30 bigint, days30 bigint, last_day date, fav_category text,
  newsletter boolean, newsletter_at timestamptz, analytics_at timestamptz, settings jsonb, push_devices bigint, usage jsonb
) language plpgsql stable security definer set search_path = public as $$
declare today date := (now() at time zone 'Europe/Prague')::date;
begin
  perform require_staff();
  return query
  select f.id, f.seq, f.created_at, f.last_seen_at, f.provider, f.email, f.town, f.country, f.platform, f.app_version, f.source, f.onboarded, f.premium, f.analytics,
    coalesce((select jsonb_agg(jsonb_build_object('name', c.name, 'g', c.gender, 'age', c.age) order by c.id) from children c where c.family_id = f.id), '[]'::jsonb),
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

create or replace function public.admin_family_usage(fseq bigint) returns table (day date, name_changes int, kid_changes int, town_changes int, tts_clips int, tts_chars int) language plpgsql stable security definer set search_path = public as $$
begin
  perform require_staff();
  return query select u.day, u.name_changes, u.kid_changes, u.town_changes, u.tts_clips, u.tts_chars from family_usage u join families f on f.id = u.family_id
    where f.seq = fseq order by u.day;
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

revoke execute on function public.usage_add(uuid, int, int, int, int, int) from public, anon, authenticated;
revoke execute on function public.app_tts_usage(int), public.admin_families(), public.admin_family_usage(bigint) from public, anon;
grant execute on function public.app_tts_usage(int), public.admin_families(), public.admin_family_usage(bigint) to authenticated;

commit;
