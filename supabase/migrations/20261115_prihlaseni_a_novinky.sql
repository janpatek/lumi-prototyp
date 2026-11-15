-- Volitelné přihlášení přes Google / Apple (app/auth.js) a souhlas s novinkami e-mailem.
-- E-mail uživatele bere app_sync_family z ověřeného účtu v auth.users (propojený Google / Apple),
-- ne z dat aplikace. Souhlas s novinkami (newsletter) platí jen s e-mailem; newsletter_at = kdy ho dal.
-- Spustit jednou v SQL Editoru (schema.sql obsahuje totéž pro novou databázi).

alter table public.families add column if not exists newsletter boolean not null default false;
alter table public.families add column if not exists newsletter_at timestamptz;

create or replace function public.app_sync_family(p jsonb) returns bigint language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); s bigint; consent boolean; was boolean; mail text; prov text; news boolean;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  consent := coalesce((p->>'analytics')::boolean, false);
  select f.analytics into was from families f where f.id = uid;
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
    source = case when consent then coalesce(f.source, p->>'source') end, updated_at = now(), last_seen_at = now()
  where f.id = uid returning f.seq into s;
  if s is null then
    insert into families (id, provider, email, newsletter, newsletter_at, town, country, platform, app_version, source, onboarded, premium, analytics, analytics_at)
    values (uid, prov, mail, news, case when news then now() end, nullif(p->>'town', ''), nullif(p->>'country', ''),
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
