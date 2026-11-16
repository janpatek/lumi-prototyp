-- Smazání účtu v aplikaci ani smazání uživatele z administrace už nesmaže přihlášení člena týmu, 16. 11. 2026.
-- Proč: člen týmu se do mobilní aplikace přihlásí Googlem se stejným e-mailem, jaký má v administraci, a Supabase
-- oba spojí do jednoho účtu. „Smazat účet a všechna data“ v aplikaci pak smazal i účet do administrace (a s ním roli v týmu).
-- Teď se smažou jen data aplikace (families a vše, co na ni navazuje), přihlášení i role v týmu zůstanou.
-- Spusť jednou v Supabase → SQL Editor. Kdo spouští celé supabase/schema.sql, má tohle už v něm.

create or replace function public.app_delete_family() returns void language plpgsql security definer set search_path = public, auth as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return; end if;
  delete from public.families where id = uid;
  -- člen týmu se do aplikace může přihlásit stejným Google účtem: smažou se jen data aplikace, přihlášení do administrace zůstane
  delete from auth.users where id = uid and not exists (select 1 from staff where user_id = uid);
end $$;

create or replace function public.admin_delete_family(fseq bigint) returns void language plpgsql security definer set search_path = public, auth as $$
declare uid uuid;
begin
  perform require_staff();
  if (select role from staff where user_id = auth.uid()) <> 'owner' then raise exception 'forbidden' using errcode = '42501'; end if;
  select id into uid from families where seq = fseq;
  if uid is null then return; end if;
  delete from public.families where id = uid;
  delete from auth.users where id = uid and not exists (select 1 from staff where user_id = uid);  -- účet člena týmu zůstane
  insert into audit_log (actor, action, target, detail) values (auth.uid(), 'family.delete', 'f' || lpad(fseq::text, 5, '0'), 'Smazání rodiny (GDPR)');
end $$;
