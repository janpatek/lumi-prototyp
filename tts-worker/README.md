# Hlas pohádek přes ElevenLabs (Cloudflare Worker)

Aplikace Ospalek je statický web, takže do ní nesmí přijít API klíč ElevenLabs. Kdokoli by ho tam našel a vyčerpal ti kredit. Klíč proto drží tenhle malý server (Cloudflare Worker):

```
aplikace (app/) ── POST /tts { text, voice } ──▶ Worker (klíč jako tajná hodnota) ──▶ ElevenLabs
                ◀──────────── MP3 ────────────── uloží si hotovou nahrávku, podruhé ji neplatíš
```

Co Worker hlídá:
- Přijme jen požadavky z webů v `ALLOWED_ORIGINS` (ospalek.cz, GitHub Pages, localhost).
- Pustí jen hlasy z `VOICES` a text nejvýš `MAX_CHARS` znaků (aplikace posílá po odstavcích).
- Stejný text a hlas vrací z mezipaměti, takže se neplatí znovu.

Skript mimo prohlížeč ale může hlavičku `Origin` podvrhnout. Hlavní pojistka proti zneužití je proto **limit kreditů nastavený přímo u klíče** v ElevenLabs.

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

Platí se jen za větu, která ještě nikdy nezazněla, a to u kterékoli rodiny. Model je `eleven_v4` se stabilitou 0.6, stejně jako u nahrávek v `audio/hlas`. Kdybys ho změnil, věty z Workeru nebudou znít stejně jako hotové věty a na spojích to bude slyšet.

Druhá rodina se stejným jménem dítěte dnes použije zhruba 83 % hotových nahrávek. Platí jen věty se svým městem, jídlem nebo jménem rodiče. Věty pro nejčastější jména jde namluvit předem: `node tools/hlas/plan.mjs jmena`, víc v `tools/hlas/README.md`.

Do ElevenLabs odchází text pohádky včetně jmen dětí a obce. Měl by to zmínit text o ochraně údajů.
