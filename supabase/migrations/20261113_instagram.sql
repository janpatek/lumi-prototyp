-- Zveřejňování na Instagram z administrace (sekce Sociální sítě), 13. 11. 2026.
-- Propojený účet a jeho přístupový token drží jen Edge Function „instagram“ (supabase/functions/instagram/index.ts),
-- která k tabulkám přistupuje tajným klíčem. Prohlížeč ani role authenticated k nim přístup nemají (RLS bez pravidel).
-- Neobsahuje osobní údaje rodin: jen firemní účet Ospalek.cz a seznam zveřejněných marketingových příspěvků.
-- Spusť jednou v Supabase → SQL Editor. Totéž je na konci schema.sql.

begin;

-- propojený firemní účet na Instagramu (jen jeden řádek)
create table if not exists public.instagram_ucet (
  id int primary key default 1 check (id = 1),
  ig_user_id text not null,
  username text,
  token text not null,
  expires_at timestamptz not null,
  token_at timestamptz not null default now(),
  propojil uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
-- jednorázové kódy přihlášení (state) mezi administrací a Instagramem, platí 15 minut
create table if not exists public.instagram_oauth (
  state text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  navrat text not null,
  created_at timestamptz not null default now()
);
-- co a kdy se z administrace zveřejnilo
create table if not exists public.instagram_prispevky (
  id bigserial primary key,
  polozka text not null,
  typ text not null,
  media_id text,
  permalink text,
  popisek text,
  zverejnil uuid references auth.users(id) on delete set null,
  at timestamptz not null default now()
);

alter table public.instagram_ucet enable row level security;
alter table public.instagram_oauth enable row level security;
alter table public.instagram_prispevky enable row level security;
revoke all on public.instagram_ucet, public.instagram_oauth, public.instagram_prispevky from anon, authenticated;

commit;
