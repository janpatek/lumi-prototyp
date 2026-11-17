# Hlas pohádek přes ElevenLabs (Cloudflare Worker)

Aplikace Ospalek je statický web, takže do ní nesmí přijít API klíč ElevenLabs. Kdokoli by ho tam našel a vyčerpal ti kredit. Klíč proto drží tenhle malý server (Cloudflare Worker):

```
aplikace (app/) ── POST /tts { text, voice } ──▶ Worker (klíč jako tajná hodnota) ──▶ ElevenLabs
                ◀──────────── MP3 ────────────── uloží si hotovou nahrávku, podruhé ji neplatíš
```

Co Worker hlídá:
- Přijme jen požadavky z webů v `ALLOWED_ORIGINS` (ospalek.cz, GitHub Pages, localhost).
- Pustí jen hlasy z `VOICES` a text nejvýš `MAX_CHARS` znaků (400; aplikace posílá po větách, nejdelší má ~190 znaků).
- Jedna IP adresa smí nechat namluvit nejvýš 120 nových vět za minutu (`[[ratelimits]]` TTS_LIMIT ve `wrangler.toml`). Věty z mezipaměti se nepočítají.
- Stejný text a hlas vrací z mezipaměti, takže se neplatí znovu. Věty z mezipaměti dostane každý, i starší verze aplikace.
- **Novou větu (tu, co stojí kredity) namluví jen přihlášené rodině** (od 17. 11. 2026, `TTS_AUTH = "required"`). Aplikace
  posílá přihlášení rodiny (`Authorization: Bearer …`, anonymní účet Supabase) a worker se před voláním ElevenLabs zeptá
  databáze (`app_tts_allow`), která ověří podpis přihlášení a limity z tabulky `tts_limits`:
  - `family_day` (70 000 kreditů, zhruba znaků): jedna rodina za den, zhruba celá knihovna najednou,
  - `family_month` (160 000 znaků): jedna rodina za 30 dní,
  - `global_day` (600 000 znaků, asi 1 100 Kč): všechny rodiny dohromady za den – pojistka proti zakládání účtů ve velkém.
  Limity se mění v Supabase → SQL Editor (`update tts_limits set global_day = …`), worker se nasazovat nemusí.
  Když se databáze neozve, worker novou větu nenamluví (hotové hrají dál).
- Pořadí nasazení: nejdřív `supabase/migrations/20261117_zabezpeceni.sql`, potom `npx wrangler deploy`.
- **Nástroje týmu** (`tools/hlas/namluvit.mjs`, `predehrat.mjs`) rodinu nemají. Prokazují se tajným klíčem:
  jednou `npx wrangler secret put TOOLS_KEY` (dlouhý náhodný řetězec, např. `openssl rand -hex 32`) a při spuštění
  nástroje `OSPALEK_TOOLS_KEY=… node tools/hlas/namluvit.mjs nahrat …`. Klíč nepatří do repozitáře. Bez něj nástroje
  dostanou jen věty z mezipaměti. Limity rodin se na ně nevztahují, limit 120 nových vět za minutu ano.
- Limity se počítají v kreditech ElevenLabs tak, jak je worker zapisuje k účtu (u běžného modelu 1 znak = 1 kredit).
- Verze aplikace starší než Android 1.19 přihlášení neposílají: hrají jim hotové věty (společné a ty už jednou
  namluvené), nová věta se jménem dítěte ne. Aplikace pak nabídne „Raději ji přečtu já“.

Hlavička `Origin` jde mimo prohlížeč podvrhnout, proto o nových větách rozhoduje přihlášení a limity, ne Origin.
Poslední pojistka je **limit kreditů nastavený přímo u klíče** v ElevenLabs – nech ho nastavený.

## 1. Klíč a hlas v ElevenLabs

1. Vyber si tarif s komerčními právy (nejlevnější je Starter). Ceny ověř na [elevenlabs.io/pricing](https://elevenlabs.io/pricing).
2. V ElevenLabs otevři **Settings → API Keys → Create API Key**:
   - povol jen **Text to Speech**,
   - nastav **credit limit**, třeba měsíční kredit tvého tarifu,
   - klíč si zkopíruj. Ukáže se jen jednou. Nikam ho nevkládej, potřebuješ ho až v kroku 3.
3. Najdi hlas Jany (Voice Library). Přidej si ho do **My Voices** a u hlasu zkopíruj **Voice ID**.
4. Voice ID vlož do `wrangler.toml` místo `SEM_VLOZ_VOICE_ID_JANY`. Voice ID není tajné, klidně může být v gitu.

## 2. Účet Cloudflare

Založ si zdarma účet na [dash.cloudflare.com](https://dash.cloudflare.com). Pro tenhle objem stačí bezplatný tarif Workers.

## 3. Nasazení (v terminálu ve složce `tts-worker`)

```bash
cd tts-worker
```

```bash
npx wrangler login
```

Otevře prohlížeč, přihlásíš se do Cloudflaru a povolíš přístup.

```bash
npx wrangler secret put ELEVENLABS_API_KEY
```

Vlož klíč z kroku 1. Uloží se šifrovaně v Cloudflaru, ne v kódu.

```bash
npx wrangler deploy
```

Na konci vypíše adresu, např. `https://ospalek-tts.<tvuj-ucet>.workers.dev`.

Kontrola: otevři tu adresu v prohlížeči. Má ukázat `{"ok":true,"voices":["jana"],…,"key":true}`.

## 4. Zapnutí v aplikaci

V `app/app.js` nahoře doplň adresu Workeru:

```js
const TTS_URL_DEFAULT = 'https://ospalek-tts.<tvuj-ucet>.workers.dev';
```

Pak zvyš číslo verze u `app.js?v=…` v `app/index.html` a nahraj web. Přehrávač pak čte Janou po větách: hotové věty z `audio/hlas/jana/`, chybějící věty přes Worker. Když Worker selže, aplikace dočte pohádku hlasem prohlížeče.

## Trvalé ukládání nahrávek (R2) – pro sdílení jmen nutné

Přehrávač čte pohádku po větách. Hotové společné věty bere z `audio/hlas/jana/`, Worker generuje jen věty s údaji rodiny. Mezipaměť je společná pro všechny rodiny. Když si druhá rodina s Toníkem pustí stejnou pohádku, věty jen s jeho jménem („Toník dostal nápad.“, „Dobrou noc, Toníku.“) už jsou uložené a nic se neplatí.

Mezipaměť Cloudflaru ale může nahrávku po čase zahodit, takže sdílení spolehlivě funguje jen s úložištěm R2:

```bash
npx wrangler r2 bucket create ospalek-audio
```

Pak ve `wrangler.toml` odkomentuj blok `[[r2_buckets]]` a znovu spusť `npx wrangler deploy`.

V Cloudflare dashboardu pak u bucketu nastav pravidlo životního cyklu (R2 → ospalek-audio → Settings → Object lifecycle rules): mazat objekty 365 dní po nahrání. Slibují to zásady ochrany osobních údajů (článek 7): věty se jmény a místy se nemažou s účtem, protože nejsou spojené s žádnou rodinou, ale po 12 měsících zmizí. Kdo je pak potřebuje, Worker je namluví znovu.

## Zkouška bez účtu a bez kreditů

```bash
node tts-worker/dev-mock.mjs
```

Spustí Worker na `http://localhost:8787`. Místo ElevenLabs vrací kus ukázkové nahrávky. Aplikaci pak otevři s parametrem `?tts=http://localhost:8787`, třeba `http://localhost:5174/app/?tts=http://localhost:8787`. Parametr funguje jen pro localhost.

## Co stojí kredity

Platí se jen za větu, která ještě nikdy nezazněla, a to u kterékoli rodiny. Model je `eleven_v4` se stabilitou 0.75 a hotové věty v `audio/hlas` vznikly přes tenhle Worker se stejným nastavením. Když hlas, model nebo stabilitu změníš, namluv hotové věty znovu (`tools/hlas/namluvit.mjs`), jinak bude na spojích slyšet rozdíl.

Druhá rodina se stejným jménem dítěte dnes použije zhruba 83 % hotových nahrávek. Platí jen věty se svým městem, jídlem nebo jménem rodiče. Věty pro nejčastější jména jde namluvit předem: `node tools/hlas/plan.mjs jmena`, víc v `tools/hlas/README.md`.

Do ElevenLabs odchází text pohádky včetně jmen dětí a obce. Měl by to zmínit text o ochraně údajů.

## Náklady po uživatelích (POST /tts s přihlášením)

Aplikace posílá s požadavkem na větu i přihlášení uživatele (`Authorization: Bearer …`, anonymní účet Supabase).
Když věta nebyla v mezipaměti a opravdu ji namluvil ElevenLabs, worker ji přes `app_tts_usage` zapíše k uživateli
(kredity podle hlavičky `character-cost`, jinak počet znaků). Text věty se nikam neukládá. Administrace → Uživatelé
z toho počítá variabilní náklady. Potřebuje migraci `supabase/migrations/20261115_uzivatele_naklady.sql`.

## Náklady v administraci (GET /naklady)

Stránka **Hlas a náklady** v administraci ukazuje skutečnou spotřebu kreditů: celkem od začátku, tento měsíc, dnes, průměr na den a graf po dnech. Worker se na ni ptá ElevenLabs svým klíčem (endpointy `user/subscription` a `usage/character-stats`) a kurz bere z ČNB. Výsledek drží 10 minut v mezipaměti.

- Pustí jen člena týmu přihlášeného do administrace i kódem z Google Authenticatoru. Worker to ověří u Supabase funkcí `admin_role` (`SUPABASE_URL`, `SUPABASE_KEY` ve `wrangler.toml`; publishable klíč je veřejný).
- Klíč ElevenLabs k tomu potřebuje navíc oprávnění **User: Read** (tarif a zbývající kredity) a **Usage** / **Workspace analytics: Read** (spotřeba po dnech). Bez nich administrace ukáže, co chybí, a hlas funguje dál.
- Kredity jsou za celý účet ElevenLabs. Kč jsou odhad: cena tarifu ÷ kredity v tarifu × kurz ČNB, bez DPH.
- Lokálně: `node tts-worker/dev-mock.mjs` (vymyšlená spotřeba, ověření přes `supabase/dev-server.mjs`), administrace s `?db=http://localhost:54321&tts=http://localhost:8787`.
