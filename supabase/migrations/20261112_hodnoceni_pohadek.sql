-- Hodnocení pohádky po dohrání („Jak se vám pohádka líbila?“): 3 = skvělá, 2 = líbila, 1 = nic moc.
-- Ukládá se k záznamu poslechu (plays), takže platí stejná pravidla jako pro statistiky poslechu:
-- bez souhlasu anonymně, se souhlasem u rodiny, se smazáním rodiny zmizí.
-- Spustit jednou v SQL Editoru (schema.sql obsahuje totéž pro novou databázi).

alter table public.plays add column if not exists rating smallint check (rating between 1 and 3);
create index if not exists plays_rating_idx on public.plays (story_id) where rating is not null;

create or replace function public.app_play(p jsonb) returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); consent boolean; fid uuid; at timestamptz; r smallint;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select f.analytics into consent from families f where f.id = uid;
  if consent is null then return; end if;
  fid := case when consent then uid end;
  at := least(coalesce((p->>'started_at')::timestamptz, now()), now());
  if not consent then at := date_trunc('hour', at); end if;
  r := case when (p->>'rating') ~ '^[1-3]$' then (p->>'rating')::smallint end;
  insert into plays (id, family_id, story_id, category, started_at, listened_sec, progress, completed, heroes, voice, rating)
  values ((p->>'id')::uuid, fid, p->>'story', p->>'category', at,
          least(greatest(coalesce((p->>'sec')::int, 0), 0), 7200), least(greatest(coalesce((p->>'progress')::real, 0), 0), 1),
          coalesce((p->>'completed')::boolean, false), least(greatest(coalesce((p->>'heroes')::int, 1), 1), 10), p->>'voice', r)
  on conflict (id) do update set
    listened_sec = greatest(plays.listened_sec, excluded.listened_sec),
    progress = greatest(plays.progress, excluded.progress),
    completed = plays.completed or excluded.completed,
    rating = coalesce(excluded.rating, plays.rating)
  where plays.family_id is not distinct from fid;
  update families set last_seen_at = now() where id = uid;
end $$;

-- Hodnocení po pohádkách pro administraci (průměr 1–3 a počty jednotlivých odpovědí).
create or replace function public.admin_story_ratings() returns table (story_id text, ratings bigint, avg_rating numeric, loved bigint, liked bigint, meh bigint) language plpgsql stable security definer set search_path = public as $$
begin
  perform require_staff();
  return query select p.story_id, count(*), round(avg(p.rating)::numeric, 2),
    count(*) filter (where p.rating = 3), count(*) filter (where p.rating = 2), count(*) filter (where p.rating = 1)
  from plays p where p.rating is not null group by 1;
end $$;
