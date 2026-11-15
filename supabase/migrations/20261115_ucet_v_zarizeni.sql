-- Aplikace od zrušení přihlašování zakládá rodinu s typem účtu 'device' (app.js: start → S.user.provider = 'device').
-- Databáze povolovala jen 'guest', 'google', 'apple', 'email', takže app_sync_family od 11. 11. 2026 končilo chybou 23514
-- (families_provider_check) a nové rodiny se do administrace nedostaly. Rodiny čekají ve frontě v telefonu
-- (sync.js) a po této opravě se odešlou samy při dalším spuštění aplikace.
-- Spustit jednou v SQL Editoru (schema.sql obsahuje totéž pro novou databázi).

alter table public.families drop constraint if exists families_provider_check;
alter table public.families add constraint families_provider_check check (provider in ('device', 'guest', 'google', 'apple', 'email'));
