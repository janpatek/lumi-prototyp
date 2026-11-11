-- Pohádka dne bez smazaných pohádek, 11. 11. 2026.
-- Když tým v administraci smaže pohádku, nesmí ji dál nabízet pohádka dne ani večerní upozornění.
-- daily_pick přeskočí pohádky, které jsou mezi smazanými v poslední verzi katalogu (story_catalog).
-- Jen pro databázi, kde už pohádka dne běží (existuje tabulka push_settings). Spusť jednou v Supabase → SQL Editor,
-- po migraci 20261111_pohadky_v_databazi.sql. Kdo pohádku dne teprve zapojuje (celé supabase/schema.sql podle
-- push-worker/README.md), má opravu už ve schématu a tuhle migraci nepotřebuje.

begin;

-- Pohádka, kterou tým smazal v administraci (je mezi smazanými v poslední verzi katalogu pohádek)
create or replace function public.story_gone(story text) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select c.deleted ? story from story_catalog c order by c.version desc limit 1), false);
$$;

-- Pohádka dne pro datum: naplánovaná, jinak střídání (stejný vzorec jako v app/daily.js, start 5. 1. 2026).
-- Smazané pohádky se přeskakují: naplánovaná smazaná pohádka ustoupí střídání a ze střídání vypadne.
create or replace function public.daily_pick(d date) returns text language sql stable security definer set search_path = public as $$
  with r as (
    select array(select x from unnest(s.rotation) with ordinality u(x, o) where not story_gone(x) order by o) a
    from push_settings s where s.id = 1
  )
  select coalesce(
    (select story_id from daily_story where day = d and not story_gone(story_id)),
    (select r.a[1 + (((d - date '2026-01-05') % cardinality(r.a)) + cardinality(r.a)) % cardinality(r.a)]
       from r where cardinality(r.a) > 0));
$$;

revoke execute on function public.story_gone(text), public.daily_pick(date) from public, anon, authenticated;

commit;
