-- Kalendář sociálních sítí (administrace → Sociální sítě → Kalendář), 14. 11. 2026.
-- Tým plánuje materiály z katalogu (úložiště marketing) na den a čas a zaškrtne sítě. V zadaný čas je zveřejní
-- Edge Function „instagram“ (adresa /instagram/cron): Instagram a facebooková stránka automaticky, TikTok nemá
-- veřejné API pro zveřejňování, u něj kalendář jen připomene ruční nahrání.
-- Spouštění: pg_cron každou minutu zavolá funkci přes pg_net, ale jen když je něco na řadě.
-- Neobsahuje osobní údaje rodin. Předpoklad: migrace 20261112_marketing_uloziste.sql (funkce can_marketing)
-- a 20261113_instagram.sql. Spusť jednou v Supabase → SQL Editor. Není v schema.sql (lokální PGlite nemá pg_cron ani can_marketing).

begin;

create table if not exists public.socialni_plan (
  id bigserial primary key,
  polozka text not null,                       -- id materiálu v katalog.json
  kdy timestamptz not null,
  site text[] not null check (site <> '{}' and site <@ array['instagram', 'facebook', 'tiktok']),
  popisek text not null default '' check (length(popisek) <= 2200),
  stav text not null default 'naplanovano' check (stav in ('naplanovano', 'zpracovava', 'hotovo', 'chyba')),
  vysledky jsonb not null default '{}',        -- po sítích: { instagram: { stav, odkaz, chyba, kontejner }, … }
  zamek timestamptz,                           -- funkce si řádek zamkne, aby se nezveřejnil dvakrát
  autor text not null default '',
  vytvoril uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists socialni_plan_kdy on public.socialni_plan (kdy) where stav in ('naplanovano', 'zpracovava');

-- instagram_ucet: facebooková stránka, přes kterou je Instagram propojený (na ni se zveřejňuje na Facebook)
alter table public.instagram_ucet add column if not exists fb_page_id text;
alter table public.instagram_ucet add column if not exists fb_page_name text;
alter table public.instagram_ucet add column if not exists fb_muze boolean not null default false;

alter table public.socialni_plan enable row level security;
revoke all on public.socialni_plan from anon;
grant select, insert, update, delete on public.socialni_plan to authenticated;
grant usage on sequence public.socialni_plan_id_seq to authenticated;

-- vlastník a role Obsah s kódem; právě zveřejňovaný příspěvek měnit ani mazat nejde
drop policy if exists "plan: cteni" on public.socialni_plan;
create policy "plan: cteni" on public.socialni_plan for select to authenticated using (public.can_marketing());
drop policy if exists "plan: pridani" on public.socialni_plan;
create policy "plan: pridani" on public.socialni_plan for insert to authenticated
  with check (public.can_marketing() and stav = 'naplanovano' and vysledky = '{}'::jsonb);
drop policy if exists "plan: uprava" on public.socialni_plan;
create policy "plan: uprava" on public.socialni_plan for update to authenticated
  using (public.can_marketing() and stav <> 'zpracovava') with check (public.can_marketing() and stav <> 'zpracovava');
drop policy if exists "plan: smazani" on public.socialni_plan;
create policy "plan: smazani" on public.socialni_plan for delete to authenticated using (public.can_marketing() and stav <> 'zpracovava');

commit;

-- plánovač (mimo transakci: rozšíření a cron)
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule('ospalek-socialni-plan', '* * * * *', $cron$
  select net.http_post(
    url := 'https://imiujppjewddeldjifkl.supabase.co/functions/v1/instagram/cron',
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 60000
  )
  where exists (select 1 from public.socialni_plan where stav in ('naplanovano', 'zpracovava') and kdy <= now());
$cron$);
