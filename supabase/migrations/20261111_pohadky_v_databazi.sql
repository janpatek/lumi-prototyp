-- Pohádky v databázi, 11. 11. 2026.
-- Administrace zveřejňuje katalog pohádek do Supabase a aplikace si ho stahuje, takže úpravy platí hned.
-- Spusť jednou v Supabase → SQL Editor. Nová databáze stačí s aktuálním schema.sql.

begin;

-- ---------- Pohádky (katalog z administrace) ----------
-- Administrace po každé úpravě uloží celý seznam pohádek jako novou verzi. Aplikace si při spuštění stáhne poslední
-- verzi, takže přejmenování, smazání nebo nová pohádka platí hned na webu i v mobilní aplikaci bez nové verze v obchodě.
-- stories: pole pohádek ve tvaru z administrace (id, free, cats, ages, mood, cover, titleSrc, textSrc).
-- deleted: id pohádek, které tým smazal. Pohádky, které jsou v aplikaci zabalené a v katalogu ani mezi smazanými
-- nejsou (přibyly v nové verzi aplikace), aplikace přidá na konec.
-- Starší verze zůstávají kvůli dohledání a návratu. Žádné osobní údaje, proto katalog smí číst i nepřihlášená aplikace.
create table if not exists public.story_catalog (
  version bigint generated always as identity primary key,
  stories jsonb not null check (jsonb_typeof(stories) = 'array'),
  deleted jsonb not null default '[]' check (jsonb_typeof(deleted) = 'array'),
  published_at timestamptz not null default now(),
  published_by uuid references auth.users(id) on delete set null
);
alter table public.story_catalog enable row level security;

-- Aplikace: poslední verze katalogu. Když už ji má (since = poslední verze), vrátí jen číslo a čas verze.
-- Podle času aplikace pozná i databázi založenou znovu od nuly (čísla verzí pak začínají znovu).
create or replace function public.app_catalog(since bigint default 0) returns jsonb language sql stable security definer set search_path = public as $$
  select case when c.version > coalesce(since, 0)
    then jsonb_build_object('version', c.version, 'at', c.published_at, 'stories', c.stories, 'deleted', c.deleted)
    else jsonb_build_object('version', c.version, 'at', c.published_at) end
  from story_catalog c order by c.version desc limit 1;
$$;

-- Administrace: poslední verze i s tím, kdo a kdy ji zveřejnil.
create or replace function public.admin_story_catalog() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform require_staff();
  return (select jsonb_build_object('version', c.version, 'stories', c.stories, 'deleted', c.deleted, 'published_at', c.published_at, 'published_by', s.name)
    from story_catalog c left join staff s on s.user_id = c.published_by order by c.version desc limit 1);
end $$;

-- Zveřejnění nové verze. Smí jen vlastník a role Obsah. base = verze, ze které administrace vycházela:
-- když mezitím zveřejnil někdo jiný, změna se odmítne, ať si navzájem nepřepíšou práci.
create or replace function public.admin_publish_stories(stories jsonb, deleted jsonb, base bigint, note text default null) returns bigint language plpgsql security definer set search_path = public as $$
declare cur bigint; v bigint;
begin
  perform require_staff();
  if (select role from staff where user_id = auth.uid()) not in ('owner', 'content') then raise exception 'forbidden: content role required' using errcode = '42501'; end if;
  if jsonb_typeof(stories) <> 'array' or jsonb_array_length(stories) = 0 then raise exception 'Seznam pohádek je prázdný.'; end if;
  if jsonb_typeof(deleted) <> 'array' then raise exception 'Seznam smazaných pohádek má špatný tvar.'; end if;
  if exists (select 1 from jsonb_array_elements(stories) e where jsonb_typeof(e) <> 'object' or coalesce(e->>'id', '') = ''
      or coalesce(jsonb_typeof(e->'titleSrc'), '') <> 'string' or coalesce(jsonb_typeof(e->'textSrc'), '') <> 'string') then
    raise exception 'Některá pohádka nemá id, název nebo text.';
  end if;
  lock table story_catalog in exclusive mode;
  select max(version) into cur from story_catalog;
  if coalesce(cur, 0) <> coalesce(base, 0) then raise exception 'conflict: Pohádky mezitím upravil někdo jiný. Načti stránku znovu a změnu zopakuj.'; end if;
  insert into story_catalog (stories, deleted, published_by) values (stories, deleted, auth.uid()) returning version into v;
  insert into audit_log (actor, action, target, detail) values (auth.uid(), 'content.publish', 'Pohádky v' || v, coalesce(note, jsonb_array_length(stories) || ' pohádek'));
  return v;
end $$;

grant execute on function public.admin_story_catalog(), public.admin_publish_stories(jsonb, jsonb, bigint, text) to authenticated;
grant execute on function public.app_catalog(bigint) to anon, authenticated;

commit;
