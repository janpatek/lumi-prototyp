-- Zrušení funkce Propojené telefony (commit 40e0a8e), 10. 11. 2026.
-- Předplatné patří jednomu účtu a nesdílí se s další osobou. Párování telefonů kódem, sdílený profil rodiny
-- a společná historie „Co jsme už slyšeli“ na serveru proto končí. Historie zůstává jen v zařízení.
--
-- Spusť jednou v Supabase → SQL Editor (jen v databázi, kde už běželo schéma s propojenými telefony).
-- Nová databáze stačí s aktuálním schema.sql, tahle migrace tam nic nenajde a nic neudělá.
-- Smaže na serveru uložené profily propojených rodin a jejich historii poslechu. Statistiky (plays) zůstávají.
-- Telefon, který byl připojený k cizí rodině, si při další změně rodiny založí na serveru vlastní řádek v families.

begin;

-- funkce propojení
drop function if exists public.app_pull(bigint);
drop function if exists public.app_push_profile(jsonb);
drop function if exists public.app_listen(jsonb);
drop function if exists public.app_clear_listens();
drop function if exists public.app_invite(jsonb, jsonb);
drop function if exists public.app_join(text);
drop function if exists public.app_unlink();

-- app_sync_family, app_play a app_delete_family zase pracují jen s vlastní rodinou (auth.uid()), stejně jako v schema.sql
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

drop function if exists public.app_family_id();

-- tabulky a sloupce propojení
drop table if exists public.family_invites;
drop table if exists public.family_join_tries;
drop table if exists public.family_devices;
drop table if exists public.listens;
alter table public.families drop column if exists profile;
alter table public.families drop column if exists profile_rev;

commit;
