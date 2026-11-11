-- Předplatné z App Store a Google Play bez RevenueCat, 11. 11. 2026.
-- Spusť jednou v Supabase → SQL Editor. Kdo spouští celé supabase/schema.sql, má tohle už v něm.

begin;

-- ---------- Předplatné z App Store a Google Play (bez RevenueCat) ----------
-- Události posílá Edge Function „store“ (supabase/functions/store): ověří je u obchodu a zapíše přes store_record.
-- Rodina se páruje podle ID účtu, které aplikace předá obchodu při nákupu (Apple appAccountToken, Google obfuscatedAccountId).
-- Po smazání rodiny se předplatné i události ponechají bez vazby na rodinu (účetní evidence tržeb, žádné osobní údaje).
create table if not exists public.store_subs (
  id text primary key,                                        -- ios:<originalTransactionId> | android:<první purchase token>
  platform text not null check (platform in ('ios', 'android')),
  family_id uuid references public.families(id) on delete set null,
  product text not null,
  status text not null check (status in ('trial', 'active', 'grace', 'retry', 'paused', 'expired', 'refunded')),
  trial boolean not null default false,                       -- běžící období je zkušební
  started_at timestamptz not null,
  expires_at timestamptz,
  will_renew boolean not null default true,
  country text,
  currency text,
  price numeric(10, 2),                                       -- cena období včetně DPH v měně obchodu
  env text not null default 'Production' check (env in ('Production', 'Sandbox')),
  token text,                                                 -- Android: poslední purchase token (mění se při obnovení po vypršení)
  updated_at timestamptz not null default now()
);
create index if not exists store_subs_family_idx on public.store_subs (family_id);
create index if not exists store_subs_token_idx on public.store_subs (token);

create table if not exists public.store_events (
  id bigint generated always as identity primary key,
  key text not null unique,                                   -- stejná událost z webhooku i z aplikace se zapíše jen jednou
  sub_id text not null references public.store_subs(id) on delete cascade,
  family_id uuid references public.families(id) on delete set null,
  platform text not null,
  type text not null check (type in ('trial', 'buy', 'convert', 'renew', 'cancel', 'uncancel', 'issue', 'expire', 'refund', 'pause')),
  at timestamptz not null,
  period_start timestamptz,                                   -- zaplacené nebo zkušební období (trial, buy, convert, renew)
  period_end timestamptz,
  amount numeric(10, 2) not null default 0,                   -- včetně DPH v měně obchodu, vrácení záporně
  currency text,
  czk numeric(10, 2) not null default 0,                      -- přepočet kurzem ČNB ke dni události
  country text,
  env text not null default 'Production',
  detail text
);
create index if not exists store_events_at_idx on public.store_events (at);
create index if not exists store_events_sub_idx on public.store_events (sub_id, at);
alter table public.store_subs enable row level security;
alter table public.store_events enable row level security;

-- Zápis ověřeného stavu předplatného (jen Edge Function s tajným klíčem, role service_role).
-- p = { sub: {...}, events: [{ key, type, at, period_start, period_end, amount, currency, czk, detail }], family: uuid|null }
-- Vrací stav pro aplikaci: { active, trial, expires, willRenew }.
create or replace function public.store_record(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare s jsonb := p->'sub'; fam uuid; e jsonb; t text; prev text; r store_subs;
begin
  fam := nullif(p->>'family', '')::uuid;
  if fam is not null and not exists (select 1 from families where id = fam) then fam := null; end if;
  insert into store_subs as x (id, platform, family_id, product, status, trial, started_at, expires_at, will_renew, country, currency, price, env, token, updated_at)
  values (s->>'id', s->>'platform', fam, s->>'product', s->>'status', coalesce((s->>'trial')::boolean, false), (s->>'started_at')::timestamptz,
          (s->>'expires_at')::timestamptz, coalesce((s->>'will_renew')::boolean, true), s->>'country', s->>'currency', (s->>'price')::numeric,
          coalesce(s->>'env', 'Production'), s->>'token', now())
  on conflict (id) do update set
    family_id = coalesce(excluded.family_id, x.family_id), product = excluded.product, status = excluded.status, trial = excluded.trial,
    started_at = least(x.started_at, excluded.started_at), expires_at = excluded.expires_at, will_renew = excluded.will_renew,
    country = coalesce(excluded.country, x.country), currency = coalesce(excluded.currency, x.currency), price = coalesce(excluded.price, x.price),
    env = excluded.env, token = coalesce(excluded.token, x.token), updated_at = now()
  returning * into r;
  for e in select * from jsonb_array_elements(coalesce(p->'events', '[]'::jsonb)) loop
    t := e->>'type';
    -- první platba po zkušební době = konverze
    if t = 'renew' then
      select ev.type into prev from store_events ev where ev.sub_id = r.id and ev.type in ('trial', 'buy', 'convert', 'renew') and ev.at < (e->>'at')::timestamptz order by ev.at desc limit 1;
      if prev = 'trial' then t := 'convert'; end if;
    end if;
    insert into store_events (key, sub_id, family_id, platform, type, at, period_start, period_end, amount, currency, czk, country, env, detail)
    values (e->>'key', r.id, r.family_id, r.platform, t, (e->>'at')::timestamptz, (e->>'period_start')::timestamptz, (e->>'period_end')::timestamptz,
            coalesce((e->>'amount')::numeric, 0), e->>'currency', coalesce((e->>'czk')::numeric, 0), r.country, r.env, left(e->>'detail', 200))
    on conflict (key) do nothing;
  end loop;
  -- události bez rodiny (přišly dřív, než aplikace nákup ohlásila) se k rodině připojí
  if r.family_id is not null then update store_events set family_id = r.family_id where sub_id = r.id and family_id is null; end if;
  if r.family_id is not null then
    update families set premium = exists (select 1 from store_subs z where z.family_id = r.family_id and z.status in ('trial', 'active', 'grace') and coalesce(z.expires_at, now()) > now() - interval '1 day')
    where id = r.family_id;
  end if;
  return jsonb_build_object('active', r.status in ('trial', 'active', 'grace') and coalesce(r.expires_at > now(), true), 'trial', r.trial,
    'expires', (extract(epoch from r.expires_at) * 1000)::bigint, 'willRenew', r.will_renew, 'status', r.status);
end $$;

-- Android: předplatné podle purchase tokenu (i předchozího, linkedPurchaseToken)
create or replace function public.store_sub_by_token(tokens text[]) returns text language sql stable security definer set search_path = public as $$
  select id from store_subs where token = any(tokens) or id = any(array(select 'android:' || x from unnest(tokens) x)) order by updated_at desc limit 1;
$$;

-- Předplatné a události pro administraci (dashboard Předplatné). sandbox = včetně testovacích nákupů.
create or replace function public.admin_store(sandbox boolean default false) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform require_staff();
  return jsonb_build_object(
    'subs', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'platform', s.platform, 'fam', f.seq, 'product', s.product, 'status', s.status, 'trial', s.trial,
      'started', s.started_at, 'expires', s.expires_at, 'renew', s.will_renew, 'country', s.country, 'currency', s.currency, 'price', s.price, 'env', s.env) order by s.started_at)
      from store_subs s left join families f on f.id = s.family_id where sandbox or s.env = 'Production'), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'sub', e.sub_id, 'fam', f.seq, 'platform', e.platform, 'type', e.type, 'at', e.at,
      'start', e.period_start, 'end', e.period_end, 'amount', e.amount, 'currency', e.currency, 'czk', e.czk, 'country', e.country, 'env', e.env, 'detail', e.detail) order by e.at)
      from store_events e left join families f on f.id = e.family_id where sandbox or e.env = 'Production'), '[]'::jsonb));
end $$;

revoke execute on function public.store_record(jsonb), public.store_sub_by_token(text[]), public.admin_store(boolean) from public, anon, authenticated;
grant execute on function public.admin_store(boolean) to authenticated;
grant execute on function public.store_record(jsonb), public.store_sub_by_token(text[]) to service_role;
revoke all on public.store_subs, public.store_events from anon, authenticated;

commit;
