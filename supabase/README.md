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
| `story_catalog` | katalog pohádek (šablony názvu a textu, kategorie, věk, obálka, smazané) ve verzích | administrace přes `admin_publish_stories` (role Vlastník a Obsah) |
| `push_subs` | odběr večerního upozornění: adresa u push služby prohlížeče a klíče k zašifrování, platforma, kdy naposledy doručeno; jen rodiny, které připomínku zapnuly | aplikace přes `app_push_subscribe`, mazání `app_push_unsubscribe` a push-worker |
| `push_settings`, `daily_story`, `push_log` | nastavení upozornění (hodina, texty, střídání), ručně vybrané pohádky dne, historie rozesílání | administrace (`admin_push_save`, `admin_daily_set`), push-worker |

Účet rodiny (CRM) se ukládá vždy, kvůli podpoře. Statistiky poslechu a zdroj návštěvy se k rodině přiřadí jen se souhlasem
(`families.analytics`, přepínač v aplikaci); bez souhlasu se poslech uloží anonymně (bez rodiny, čas na hodinu, souhrn `daily_anon`)
a odvolání souhlasu dosavadní poslechy rodiny anonymizuje. Jídlo, zvíře, rodiče a místa v okolí zůstávají jen v prohlížeči. Přímý přístup do tabulek je zakázaný (RLS bez politik).
Aplikace smí volat jen funkce `app_*`, které vždy pracují s vlastní rodinou (`auth.uid()`).
Administrace volá `admin_*`, které nejdřív ověří, že volající je v tabulce `staff`.
Večerní upozornění rozesílá `push-worker` (Cloudflare) s tajným klíčem Supabase, který smí volat jen `push_start`, `push_batch` a `push_report`.
Zapojení: `push-worker/README.md`.

### Pohádky z administrace

Každá uložená změna pohádky v administraci (název, text, kategorie, smazání, nová pohádka) se hned uloží jako nová verze
do `story_catalog`. Aplikace (`app/catalog.js`) si při spuštění a při návratu do aplikace stáhne poslední verzi přes `app_catalog`.
To jde i bez přihlášení, katalog neobsahuje osobní údaje. Poslední verzi si pamatuje v zařízení, takže funguje i bez internetu.
Pohádky ze `app/stories.cs.js` jsou záloha: platí, dokud se nic nezveřejní. Pohádky, které přibudou v repozitáři a v katalogu ani
mezi smazanými nejsou, aplikace přidá na konec. Když se v repozitáři upraví text pohádky, která už je v katalogu, platí verze
z katalogu, dokud ji administrace nevrátí tlačítkem *Vrátit na app/stories.cs.js*. Obálky a hudba nových pohádek musí být v repozitáři.
Do existující databáze přidá tabulku a funkce `migrations/20261111_pohadky_v_databazi.sql`.

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

## Předplatné z App Store a Google Play (bez RevenueCat)

Nákupy ověřujeme sami a evidujeme v tabulkách `store_subs` a `store_events`, nic neplatíme žádné další službě.
Dashboard Předplatné v administraci z nich počítá MRR, aktivní předplatná, zkušební doby, konverze, odchody, kohorty a LTV.

- Aplikace (`app/billing.js`) nakupuje vlastním nativním pluginem OspalekStore (Google Play Billing 8, StoreKit 2).
  Obchodu předá ID rodiny (Google `obfuscatedAccountId`, Apple `appAccountToken`) a po nákupu pošle potvrzení na `/functions/v1/store/app`.
- Obchody samy posílají oznámení o obnovení, zrušení, selhání karty a vrácení peněz:
  - Apple: `/functions/v1/store/apple` (App Store Server Notifications V2, podpis ověřený až ke kořenovému certifikátu Applu),
  - Google: `/functions/v1/store/google?secret=…` (Pub/Sub). Stav se pak dočte z Google Play Developer API.

Zapojení (jednou):

1. **Databáze:** SQL Editor → spustit `migrations/20261111_predplatne_z_obchodu.sql`.
2. **Edge Function:** Edge Functions → Deploy a new function → Via editor.
   - Název `store`, obsah `functions/store/index.ts`.
   - V nastavení funkce **vypnout „Verify JWT“**, protože Apple ani Google token Supabase neposílají. `/app` si přihlášení rodiny ověřuje sama.
3. **Google Play:**
   - Google Cloud → zapnout *Google Play Android Developer API*.
   - Založit servisní účet a JSON klíč. V Play Console → Uživatelé a oprávnění ho pozvat s právy *Zobrazit finanční údaje* a *Spravovat objednávky a předplatná*.
   - Klíč vložit do Edge Functions → Secrets jako `GOOGLE_SERVICE_ACCOUNT` (celý JSON). Propsání práv trvá až 36 hodin.
   - Pub/Sub:
     - Založit téma (např. `ospalek-play`) a dát roli *Pub/Sub Publisher* účtu `google-play-developer-notifications@system.gserviceaccount.com`.
     - Vytvořit odběr typu Push na `https://imiujppjewddeldjifkl.supabase.co/functions/v1/store/google?secret=<náhodný řetězec>`.
     - Stejný řetězec uložit do Secrets jako `PUBSUB_SECRET`.
   - Play Console → Zpeněžení → Nastavení zpeněžení → Oznámení v reálném čase: vybrat téma a poslat testovací zprávu.
   - Produkt v Play Console:
     - předplatné `ospalek_plus` se základním plánem `mesicne` (měsíčně, automatické obnovení, 129 Kč / 4,99 €),
     - nabídka `zkusebni-3-dny` (zkušební doba 3 dny zdarma, jen pro nové zákazníky).
4. **App Store:**
   - App Store Connect → Aplikace → Informace o aplikaci → App Store Server Notifications, verze 2, adresa pro produkci i sandbox `https://imiujppjewddeldjifkl.supabase.co/functions/v1/store/apple`.
   - Produkt: automaticky obnovované předplatné `ospalek_plus_mesicne` ve skupině „Ospalek Plus“ s úvodní nabídkou 3 dny zdarma.
5. **Ověření:** po testovacím nákupu (licenční tester, sandbox) zaškrtnout v administraci Předplatné „testovací nákupy“.

Částky jsou v měně obchodu včetně DPH, přepočet na Kč kurzem ČNB ke dni platby. „Do kapsy“ v administraci = bez DPH (CZ 21 %, SK 23 %) a bez provize obchodu 15 % (Small Business Program; zapnout v App Store Connect i v Play Console).

Test ověřování podpisu a převodu událostí (bez Deno, v Node 24; testovací řetěz certifikátů s OID Applu):

```bash
d=$(mktemp -d) && cd $d && printf '[mid]\nbasicConstraints=critical,CA:true\n1.2.840.113635.100.6.2.1=ASN1:NULL\n[leaf]\nbasicConstraints=CA:false\n1.2.840.113635.100.6.11.1=ASN1:NULL\n' > ext.cnf \
  && openssl ecparam -name secp384r1 -genkey -noout -out root.key && openssl req -x509 -new -key root.key -subj /CN=Root -days 30 -out root.pem \
  && openssl ecparam -name secp384r1 -genkey -noout -out mid.key && openssl req -new -key mid.key -subj /CN=Mid -out mid.csr \
  && openssl x509 -req -in mid.csr -CA root.pem -CAkey root.key -CAcreateserial -days 30 -sha384 -extfile ext.cnf -extensions mid -out mid.pem \
  && openssl ecparam -name prime256v1 -genkey -noout -out leaf.key && openssl req -new -key leaf.key -subj /CN=Leaf -out leaf.csr \
  && openssl x509 -req -in leaf.csr -CA mid.pem -CAkey mid.key -CAcreateserial -days 30 -sha384 -extfile ext.cnf -extensions leaf -out leaf.pem \
  && cd - && node supabase/functions/store/test.mjs $d
```

## Lokální vyzkoušení bez účtu

```bash
cd supabase && npm install && node dev-server.mjs --seed 60
```

Pod napodobeninou Supabase běží skutečné `schema.sql` v PGlite (Postgres ve WebAssembly), data jsou jen v paměti.
- Aplikace: http://localhost:5174/app/?db=http://localhost:54321
- Administrace: http://localhost:5174/admin/?db=http://localhost:54321 (admin@example.cz / ospalek-test; klíč pro Authenticator a odkaz z obnovy hesla vypíše server do konzole)

## Co zatím chybí

- Skutečné přihlášení rodičů (Google, Apple, e-mail) místo simulovaného; anonymní účet se pak k němu připojí.
- Pravidelné srovnání s obchody (noční kontrola stavu předplatných přes API, kdyby se nějaké oznámení ztratilo).
- Helpdesk (příjem e-mailů do tabulky `tickets`), návštěvy webu (Plausible), uplatnění kuponů v aplikaci.
- Úklid opuštěných anonymních účtů bez rodiny (pg_cron, např. jednou týdně).
- Při desítkách tisíc rodin stránkovat `admin_families` na serveru místo načtení celého souhrnu najednou.
