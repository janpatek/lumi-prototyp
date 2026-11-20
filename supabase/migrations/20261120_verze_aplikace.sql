-- Povinná aktualizace mobilní aplikace, 20. 11. 2026. Spusť jednou v Supabase → SQL Editor; jde spustit i opakovaně.
-- Kdo spouští celé supabase/schema.sql, má tohle už v něm.
--
-- app_release: nejnižší podporované číslo sestavení (Android versionCode, iPhone CFBundleVersion). 0 = nikoho nenutit.
-- Aplikace (app/update.js) si ho přečte i bez přihlášení přes app_release(). Starší aplikace pak místo všeho ukáže
-- výzvu k aktualizaci. Nastavuje jen vlastník v administraci → Upozornění (admin_release_save), změna jde do audit logu.

create table if not exists public.app_release (
  id smallint primary key default 1 check (id = 1),
  android_min int not null default 0 check (android_min between 0 and 1000000),
  ios_min int not null default 0 check (ios_min between 0 and 1000000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
insert into public.app_release (id) values (1) on conflict (id) do nothing;
alter table public.app_release enable row level security;
revoke all on public.app_release from anon, authenticated;

create or replace function public.app_release() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('android_min', r.android_min, 'ios_min', r.ios_min) from app_release r where r.id = 1;
$$;

create or replace function public.admin_release() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform require_staff();
  return (select jsonb_build_object('android_min', r.android_min, 'ios_min', r.ios_min, 'updated_at', r.updated_at, 'by', st.name)
            from app_release r left join staff st on st.user_id = r.updated_by where r.id = 1);
end $$;

create or replace function public.admin_release_save(a_min int, i_min int) returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_staff();
  if (select s.role from staff s where s.user_id = auth.uid()) <> 'owner' then raise exception 'forbidden: release' using errcode = '42501'; end if;
  if a_min is null or i_min is null or a_min not between 0 and 1000000 or i_min not between 0 and 1000000 then
    raise exception 'Číslo sestavení musí být 0 až 1 000 000.' using errcode = '22023';
  end if;
  update app_release set android_min = a_min, ios_min = i_min, updated_at = now(), updated_by = auth.uid() where id = 1;
  insert into audit_log (actor, action, target, detail) values (auth.uid(), 'app.release', 'Povinná aktualizace',
    'Nejnižší sestavení: Android ' || case when a_min = 0 then 'bez omezení' else a_min::text end
      || ', iPhone ' || case when i_min = 0 then 'bez omezení' else i_min::text end);
end $$;

revoke execute on function public.app_release(), public.admin_release(), public.admin_release_save(int, int) from public, anon, authenticated;
grant execute on function public.app_release() to anon, authenticated;
grant execute on function public.admin_release(), public.admin_release_save(int, int) to authenticated;
