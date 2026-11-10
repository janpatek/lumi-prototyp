# Ostrá data: Supabase

Aplikace posílá rodinu a poslechy do databáze Supabase a administrace z ní čte souhrny.
Dokud je `config.js` v kořeni webu prázdný, nic se neodesílá a administrace ukazuje ukázková data.

## Co se ukládá

| Tabulka | Co | Kdo zapisuje |
|---|---|---|
| `families` | anonymní účet rodiny, obec, zařízení, zdroj návštěvy, předplatné (zatím simulované), e-mail jen při skutečném přihlášení | aplikace přes `app_sync_family` |
| `children` | křestní jméno, pohlaví, věk | aplikace přes `app_sync_family` |
| `plays` | pohádka, kategorie, začátek, délka poslechu, dohráno; `family_id` jen se souhlasem | aplikace přes `app_play` |
| `family_day`, `daily_cat` | denní souhrny, plní je trigger při zápisu poslechu | databáze |
| `staff`, `audit_log` | tým administrace a záznam jeho akcí | ručně / administrace |

Účet rodiny (CRM) se ukládá vždy, kvůli podpoře. Statistiky poslechu a zdroj návštěvy se k rodině přiřadí jen se souhlasem
(`families.analytics`, přepínač v aplikaci); bez souhlasu se poslech uloží anonymně (bez rodiny, čas na hodinu, souhrn `daily_anon`)
a odvolání souhlasu dosavadní poslechy rodiny anonymizuje. Jídlo, zvíře, rodiče a místa v okolí zůstávají jen v prohlížeči. Přímý přístup do tabulek je zakázaný (RLS bez politik).
Aplikace smí volat jen funkce `app_*`, které vždy pracují s vlastní rodinou (`auth.uid()`).
Administrace volá `admin_*`, které nejdřív ověří, že volající je v tabulce `staff`.

## Zapojení (jednou, asi 15 minut)

1. Na [supabase.com](https://supabase.com) založ projekt. **Region: EU (náš projekt běží v West EU – Irsko, eu-west-1; Frankfurt by šel také).** Tarif Free na začátek stačí.
2. **SQL Editor** → vlož celý `supabase/schema.sql` → Run. Dá se spustit i znovu po úpravách.
   Když se ze schématu něco odebírá, leží úklid v `supabase/migrations/` a spouští se jednou ručně, také v SQL Editoru.
   `20261110_zruseni_propojenych_telefonu.sql` ruší párování telefonů kódem (tabulky `family_devices`, `family_invites`,
   `family_join_tries`, `listens`, sloupce `families.profile` a `profile_rev` a funkce `app_pull`, `app_push_profile`, `app_listen`,
   `app_clear_listens`, `app_invite`, `app_join`, `app_unlink`, `app_family_id`). Předplatné patří jednomu účtu a přehled
   „Co jsme už slyšeli“ zůstává jen v zařízení. Potřeba jen v databázi, kde běželo schéma z 10. 11. 2026 s propojenými telefony.
3. **Authentication → Sign In / Providers → Anonymous sign-ins: zapnout.** Rodiny díky tomu nemusí zadávat e-mail.
   Doporučení: v Authentication → Rate Limits nech limit anonymních přihlášení nízký (výchozích 30 za hodinu z jedné IP), později přidat captchu (Turnstile).
4. Pozvi se do týmu (SQL Editor), pak v **Authentication → Users → Add user** založ účet se stejným e-mailem a heslem (Auto Confirm).
   Trigger tě při založení účtu sám přidá do tabulky `staff`:
   ```sql
   insert into staff_invites (email, name, role) values ('tvuj@email.cz', 'Jan', 'owner');
   ```
   Další členy týmu stejně, role: `owner`, `support`, `content`, `analyst`, `finance`. U už existujícího účtu stačí rovnou
   `insert into staff (user_id, name, role) select id, 'Jméno', 'support' from auth.users where email = '…';`
5. **Project Settings → API**: zkopíruj *Project URL* a *Publishable key* (`sb_publishable_…`, starší *anon key* funguje také) do `config.js` v kořeni webu:
   ```js
   window.OSPALEK_CONFIG = { supabaseUrl: 'https://xxxx.supabase.co', supabaseAnonKey: 'eyJ…' };
   ```
   Publishable klíč je veřejný z principu, sám nic nesmí. **Secret klíč (`sb_secret_…`, dříve `service_role`) do webu nikdy nedávej.**
5b. **Authentication → URL Configuration**: Site URL `https://ospalek.cz`, Redirect URLs `https://ospalek.cz/admin/` (sem vede odkaz z e-mailu „Zapomenuté heslo“).
   **Authentication → Multi-Factor**: TOTP (App Authenticator) musí být *Enabled*.
6. Nasadit (push na `main`). Administrace pak chce přihlášení e-mailem z kroku 4, heslem a kódem z Google Authenticatoru a ukazuje ostrá data.
   Přepnout zpět na ukázková data jde v sekci Napojení dat.

## Přihlášení týmu: heslo + Google Authenticator

Funkce `admin_*` (kromě `admin_me`) vydají data jen přihlášení s úrovní **aal2**, tedy heslem i šestimístným kódem z aplikace
Google Authenticator (nebo jiné TOTP aplikace). Při prvním přihlášení administrace ukáže QR kód k naskenování, potom chce kód pokaždé.
- **Zapomenuté heslo:** odkaz na přihlašovací stránce. Supabase pošle e-mail s odkazem zpět do administrace, kde se nastaví nové heslo.
  Bez vlastního SMTP posílá Supabase jen pár e-mailů za hodinu a jen na adresy členů organizace v Supabase.
- **Správa týmu** (stránka Tým, jen vlastník): přidat člena s heslem, změnit roli, nastavit heslo, zrušit kód, odebrat.
  Účty a hesla zakládá Edge Function `supabase/functions/staff-admin` (tajný klíč zůstává na serveru Supabase),
  role a zrušení kódu databáze (`admin_set_role`, `admin_reset_mfa`). Po úpravě funkce ji nasaď znovu v Supabase → Edge Functions.
- **Ztracený telefon:** vlastník dá na stránce Tým „Zrušit kód“ (nebo smaže v Supabase Authentication → Users → uživatel → MFA factors) a člověk si
  při dalším přihlášení naskenuje nový QR kód. Jde to i SQL: `delete from auth.mfa_factors where user_id = (select id from auth.users where email = '…');`

## Lokální vyzkoušení bez účtu

```bash
cd supabase && npm install && node dev-server.mjs --seed 60
```

Pod napodobeninou Supabase běží skutečné `schema.sql` v PGlite (Postgres ve WebAssembly), data jsou jen v paměti.
- Aplikace: http://localhost:5174/app/?db=http://localhost:54321
- Administrace: http://localhost:5174/admin/?db=http://localhost:54321 (admin@example.cz / ospalek-test; klíč pro Authenticator a odkaz z obnovy hesla vypíše server do konzole)

## Co zatím chybí

- Skutečné přihlášení rodičů (Google, Apple, e-mail) místo simulovaného; anonymní účet se pak k němu připojí.
- Předplatné z RevenueCat a Stripe (webhooky do tabulky `subscriptions`), dnes je v aplikaci jen simulované.
- Helpdesk (příjem e-mailů do tabulky `tickets`), návštěvy webu (Plausible), uplatnění kuponů v aplikaci.
- Úklid opuštěných anonymních účtů bez rodiny (pg_cron, např. jednou týdně).
- Při desítkách tisíc rodin stránkovat `admin_families` na serveru místo načtení celého souhrnu najednou.
