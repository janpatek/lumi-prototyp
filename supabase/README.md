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

1. Na [supabase.com](https://supabase.com) založ projekt. **Region: Central EU (Frankfurt).** Tarif Free na začátek stačí.
2. **SQL Editor** → vlož celý `supabase/schema.sql` → Run. Dá se spustit i znovu po úpravách.
3. **Authentication → Sign In / Providers → Anonymous sign-ins: zapnout.** Rodiny díky tomu nemusí zadávat e-mail.
   Doporučení: v Authentication → Rate Limits nech limit anonymních přihlášení nízký (výchozích 30 za hodinu z jedné IP), později přidat captchu (Turnstile).
4. **Authentication → Users → Add user**: svůj e-mail a heslo (Auto Confirm). Pak v SQL Editoru:
   ```sql
   insert into staff (user_id, name, role)
   select id, 'Jan', 'owner' from auth.users where email = 'tvuj@email.cz';
   ```
   Další členy týmu stejně, role: `owner`, `support`, `content`, `analyst`, `finance`.
5. **Project Settings → API**: zkopíruj *Project URL* a *anon public key* do `config.js` v kořeni webu:
   ```js
   window.OSPALEK_CONFIG = { supabaseUrl: 'https://xxxx.supabase.co', supabaseAnonKey: 'eyJ…' };
   ```
   Anon klíč je veřejný z principu, sám nic nesmí. **Klíč `service_role` do webu nikdy nedávej.**
6. Nasadit (push na `main`). Administrace pak po hesle chce přihlášení e-mailem z kroku 4 a ukazuje ostrá data.
   Přepnout zpět na ukázková data jde v sekci Napojení dat.

## Lokální vyzkoušení bez účtu

```bash
cd supabase && npm install && node dev-server.mjs --seed 60
```

Pod napodobeninou Supabase běží skutečné `schema.sql` v PGlite (Postgres ve WebAssembly), data jsou jen v paměti.
- Aplikace: http://localhost:5174/app/?db=http://localhost:54321
- Administrace: http://localhost:5174/admin/?db=http://localhost:54321 (admin@example.cz / ospalek-test)

## Co zatím chybí

- Skutečné přihlášení rodičů (Google, Apple, e-mail) místo simulovaného; anonymní účet se pak k němu připojí.
- Předplatné z RevenueCat a Stripe (webhooky do tabulky `subscriptions`), dnes je v aplikaci jen simulované.
- Helpdesk (příjem e-mailů do tabulky `tickets`), návštěvy webu (Plausible), uplatnění kuponů v aplikaci.
- Úklid opuštěných anonymních účtů bez rodiny (pg_cron, např. jednou týdně).
- Při desítkách tisíc rodin stránkovat `admin_families` na serveru místo načtení celého souhrnu najednou.
