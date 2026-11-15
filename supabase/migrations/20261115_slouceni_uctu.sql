-- Sloučení účtů (app/sync.js merge): uživatel se v aplikaci přihlásí Google / Apple účtem, který už u nás
-- má jiný účet (z jiného telefonu, nebo stejný e-mail). Ten existující účet se stane hlavním a data
-- anonymního účtu z telefonu se do něj přesunou: poslechy a hodnocení, denní souhrny, předplatné z obchodu,
-- uplatněné kódy a odběr upozornění. Anonymní účet se pak smaže.
--
-- Bezpečnost: přesun jde jen s jednorázovým lístkem, který si telefon vystaví ještě POD STARÝM účtem
-- (app_merge_ticket) a platí 15 minut. Nový účet tedy nemůže převzít data cizího účtu.
-- Spustit jednou v SQL Editoru (schema.sql obsahuje totéž pro novou databázi).

create table if not exists public.merge_tickets (
  id uuid primary key default gen_random_uuid(),
  from_uid uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.merge_tickets enable row level security;   -- jen přes funkce níže

-- Lístek pro sloučení: volá telefon se starým (anonymním) účtem, těsně před přihlášením do hlavního účtu.
create or replace function public.app_merge_ticket() returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); t uuid;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  delete from merge_tickets where from_uid = uid or created_at < now() - interval '1 day';
  insert into merge_tickets (from_uid) values (uid) returning id into t;
  return t;
end $$;

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
    onboarded = t.onboarded or s.onboarded
    from families s where t.id = uid and s.id = src;

  delete from families where id = src;
  -- prázdný anonymní účet pryč (účet s e-mailem nikdy nemažeme)
  delete from auth.users where id = src and is_anonymous;
end $$;
