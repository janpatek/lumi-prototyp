-- Zásobník pohádek, 12. 11. 2026.
-- Koncepty z generátoru pohádek v administraci čekají tady, než je tým zveřejní v aplikaci.
-- Spusť jednou v Supabase → SQL Editor. Nová databáze stačí s aktuálním schema.sql.

begin;

-- ---------- Zásobník pohádek (koncepty z generátoru) ----------
-- story: pohádka ve stejném tvaru jako v katalogu (id, free, cats, ages, mood, cover, titleSrc, textSrc).
-- brief: zadání a údaje z generátoru (kategorie, o čem, délka v minutách, poznámka, poučení, model, spotřeba).
-- status: koncept → vyroba (obálka, hlas a zvuk se chystají) → zverejneno (je v katalogu) | vyrazeno.
-- steps: stav výroby po krocích { obalka, hlas, zvuk, zverejneni }: { stav: 'ceka' | 'hotovo' | 'vynechano', pozn, at }.
-- Žádné osobní údaje rodin: jména v náhledu generátoru se nikam neukládají.
create table if not exists public.story_drafts (
  id uuid primary key default gen_random_uuid(),
  story jsonb not null check (jsonb_typeof(story) = 'object'),
  brief jsonb not null default '{}' check (jsonb_typeof(brief) = 'object'),
  status text not null default 'koncept' check (status in ('koncept', 'vyroba', 'zverejneno', 'vyrazeno')),
  steps jsonb not null default '{}' check (jsonb_typeof(steps) = 'object'),
  catalog_version bigint,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.story_drafts enable row level security;

-- Seznam konceptů (číst smí celý tým, nejnovější nahoře).
create or replace function public.admin_story_drafts() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform require_staff();
  return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'story', d.story, 'brief', d.brief, 'status', d.status, 'steps', d.steps,
      'catalog_version', d.catalog_version, 'created_at', d.created_at, 'updated_at', d.updated_at, 'created_by', c.name, 'updated_by', u.name)
      order by d.updated_at desc)
    from story_drafts d left join staff c on c.user_id = d.created_by left join staff u on u.user_id = d.updated_by), '[]'::jsonb);
end $$;

-- Uložení konceptu: bez id založí nový, s id přepíše. Smí jen vlastník a role Obsah.
-- base = updated_at, ze kterého administrace vycházela: když koncept mezitím uložil někdo jiný, změna se odmítne.
create or replace function public.admin_story_draft_save(d jsonb, base timestamptz default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare s jsonb := d->'story'; st text := coalesce(d->>'status', 'koncept'); r story_drafts; cur timestamptz; prev text;
begin
  perform require_staff();
  if (select role from staff where user_id = auth.uid()) not in ('owner', 'content') then raise exception 'forbidden: content role required' using errcode = '42501'; end if;
  if jsonb_typeof(s) <> 'object' or coalesce(s->>'id', '') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception 'Pohádka potřebuje id z malých písmen, číslic a pomlček.'; end if;
  if coalesce(jsonb_typeof(s->'titleSrc'), '') <> 'string' or coalesce(jsonb_typeof(s->'textSrc'), '') <> 'string' then raise exception 'Pohádka nemá název nebo text.'; end if;
  if length(s->>'textSrc') > 200000 or length(s->>'titleSrc') > 2000 then raise exception 'Text pohádky je moc dlouhý.'; end if;
  if st not in ('koncept', 'vyroba', 'zverejneno', 'vyrazeno') then raise exception 'Neznámý stav konceptu.'; end if;
  if d->>'id' is null then
    insert into story_drafts (story, brief, status, steps, created_by, updated_by)
      values (s, coalesce(d->'brief', '{}'), st, coalesce(d->'steps', '{}'), auth.uid(), auth.uid()) returning * into r;
    insert into audit_log (actor, action, target, detail) values (auth.uid(), 'content.draft', s->>'id', 'Nový koncept v zásobníku');
  else
    select updated_at, status into cur, prev from story_drafts where id = (d->>'id')::uuid for update;
    if not found then raise exception 'Koncept už neexistuje.'; end if;
    if base is not null and cur <> base then raise exception 'conflict: Koncept mezitím upravil někdo jiný. Načti zásobník znovu.'; end if;
    update story_drafts set story = s, brief = coalesce(d->'brief', brief), status = st, steps = coalesce(d->'steps', steps),
        catalog_version = coalesce((d->>'catalog_version')::bigint, catalog_version), updated_by = auth.uid(), updated_at = now()
      where id = (d->>'id')::uuid returning * into r;
    if st is distinct from prev and st in ('vyroba', 'zverejneno', 'vyrazeno') then
      insert into audit_log (actor, action, target, detail) values (auth.uid(), 'content.draft', s->>'id',
        case st when 'vyroba' then 'Publikace spuštěna' when 'zverejneno' then 'Zveřejněno v aplikaci' else 'Vyřazeno ze zásobníku' end);
    end if;
  end if;
  return jsonb_build_object('id', r.id, 'status', r.status, 'updated_at', r.updated_at, 'catalog_version', r.catalog_version);
end $$;

-- Smazání konceptu (zveřejněné pohádky zůstávají v katalogu, maže se jen záznam v zásobníku).
create or replace function public.admin_story_draft_delete(draft uuid) returns void language plpgsql security definer set search_path = public as $$
declare sid text;
begin
  perform require_staff();
  if (select role from staff where user_id = auth.uid()) not in ('owner', 'content') then raise exception 'forbidden: content role required' using errcode = '42501'; end if;
  delete from story_drafts where id = draft returning story->>'id' into sid;
  if sid is not null then insert into audit_log (actor, action, target, detail) values (auth.uid(), 'content.draft', sid, 'Koncept smazaný ze zásobníku'); end if;
end $$;

revoke execute on function public.admin_story_drafts(), public.admin_story_draft_save(jsonb, timestamptz), public.admin_story_draft_delete(uuid) from public, anon, authenticated;
grant execute on function public.admin_story_drafts(), public.admin_story_draft_save(jsonb, timestamptz), public.admin_story_draft_delete(uuid) to authenticated;

commit;
