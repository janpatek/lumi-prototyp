-- Materiály pro sociální sítě v úložišti Supabase, 12. 11. 2026.
-- Reels, příspěvky na Instagram, profilové obrázky a podklady pro Google Play (marketing/) se do veřejného repa
-- nedávají. Leží v soukromém bucketu „marketing“ a administrace (sekce Sociální sítě) je čte přes podepsané odkazy.
-- Číst i nahrávat smí jen vlastník a role Obsah přihlášení s kódem z Google Authenticatoru. Nahrává se z místní
-- administrace (localhost, tlačítko Nahrát do úložiště) nebo skriptem marketing/nahrat.mjs s klíčem service_role.
-- Neobsahuje osobní údaje: videa se jmény skutečných dětí z komentářů (marketing/reels/odpovedi/) se nenahrávají.
-- Spusť jednou v Supabase → SQL Editor. Není v schema.sql, protože lokální dev-server (PGlite) úložiště nemá.

begin;

insert into storage.buckets (id, name, public, file_size_limit)
values ('marketing', 'marketing', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- Člen týmu s rolí Vlastník nebo Obsah, přihlášený i kódem (aal2). Stejná pravidla jako pohádky a upozornění.
create or replace function public.can_marketing() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt()->>'aal', '') = 'aal2'
     and exists (select 1 from staff s where s.user_id = auth.uid() and s.role in ('owner', 'content'));
$$;
revoke execute on function public.can_marketing() from public, anon;
grant execute on function public.can_marketing() to authenticated;

drop policy if exists "marketing: cteni pro obsah" on storage.objects;
create policy "marketing: cteni pro obsah" on storage.objects for select to authenticated
  using (bucket_id = 'marketing' and public.can_marketing());

-- nahrávání (i přepsání stejného souboru) z administrace; mazat se dá jen v Supabase
drop policy if exists "marketing: nahravani pro obsah" on storage.objects;
create policy "marketing: nahravani pro obsah" on storage.objects for insert to authenticated
  with check (bucket_id = 'marketing' and public.can_marketing());
drop policy if exists "marketing: prepis pro obsah" on storage.objects;
create policy "marketing: prepis pro obsah" on storage.objects for update to authenticated
  using (bucket_id = 'marketing' and public.can_marketing()) with check (bucket_id = 'marketing' and public.can_marketing());

commit;
