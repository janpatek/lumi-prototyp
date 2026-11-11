-- Kódy, které odemknou Ospalek Plus na pár dní bez nákupu (recenzenti Google Play a App Store, později i dárky), 11. 11. 2026.
-- Spusť jednou v Supabase → SQL Editor. Kdo spouští celé supabase/schema.sql, má tohle už v něm.
--
-- Samotný kód v databázi ani v repu není, jen jeho otisk (SHA-256 z kódu velkými písmeny bez mezer).
-- Nový kód přidáš v SQL Editoru (kód si drž v Klíčence, sem ho nepiš):
--   insert into public.access_codes (code_hash, label, days)
--   values (encode(sha256(convert_to('KÓD-SEM', 'UTF8')), 'hex'), 'Recenzenti Google Play', 30);
-- Zrušení kódu: update public.access_codes set valid_until = now() where label = '…';

begin;

create table if not exists public.access_codes (
  id bigint generated always as identity primary key,
  code_hash text not null unique,                             -- sha256(upper(kód bez mezer)) hex
  label text not null check (char_length(label) between 1 and 60),
  days int not null check (days between 1 and 365),           -- na kolik dní kód odemkne Plus
  max_uses int check (max_uses is null or max_uses > 0),      -- null = kolikrát chce (recenzenti zkoušejí na víc zařízeních)
  uses int not null default 0,
  valid_until timestamptz,                                    -- po tomhle datu kód přestane platit
  created_at timestamptz not null default now()
);
-- komu kód Plus odemkl (anonymní účet, smaže se s ním)
create table if not exists public.access_grants (
  user_id uuid not null references auth.users(id) on delete cascade,
  code_id bigint not null references public.access_codes(id) on delete cascade,
  until timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (user_id, code_id)
);
-- špatné pokusy: nejvýš 10 za hodinu na účet, aby se kód nedal hádat
create table if not exists public.access_tries (
  user_id uuid primary key references auth.users(id) on delete cascade,
  n int not null default 0,
  since timestamptz not null default now()
);
alter table public.access_codes enable row level security;
alter table public.access_grants enable row level security;
alter table public.access_tries enable row level security;

-- Aplikace: uplatnit kód. Vrací { ok: true, until: ms } nebo { ok: false, error: 'invalid' | 'tries' }.
-- Stejný kód na stejném účtu podruhé platnost neprodlouží.
create or replace function public.app_redeem_code(code text) returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); h text; c access_codes; t access_tries; u timestamptz;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  insert into access_tries as x (user_id) values (uid)
    on conflict (user_id) do update set
      n = case when x.since < now() - interval '1 hour' then 0 else x.n end,
      since = case when x.since < now() - interval '1 hour' then now() else x.since end
    returning * into t;
  if t.n >= 10 then return jsonb_build_object('ok', false, 'error', 'tries'); end if;
  h := encode(sha256(convert_to(upper(regexp_replace(coalesce(code, ''), '\s', '', 'g')), 'UTF8')), 'hex');
  select * into c from access_codes a where a.code_hash = h;
  if not found or (c.valid_until is not null and c.valid_until < now())
     or (c.max_uses is not null and c.uses >= c.max_uses and not exists (select 1 from access_grants g where g.user_id = uid and g.code_id = c.id)) then
    update access_tries set n = n + 1 where user_id = uid;
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  insert into access_grants (user_id, code_id, until) values (uid, c.id, now() + make_interval(days => c.days))
    on conflict (user_id, code_id) do nothing;
  if found then update access_codes set uses = uses + 1 where id = c.id; end if;
  select max(g.until) into u from access_grants g where g.user_id = uid;
  update families set premium = true where id = uid and u > now();
  return jsonb_build_object('ok', u > now(), 'until', (extract(epoch from u) * 1000)::bigint, 'error', case when u > now() then null else 'invalid' end);
end $$;

revoke all on public.access_codes, public.access_grants, public.access_tries from anon, authenticated;
revoke execute on function public.app_redeem_code(text) from public, anon;
grant execute on function public.app_redeem_code(text) to authenticated;

commit;
