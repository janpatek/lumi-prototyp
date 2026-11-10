# Skládaný hlas pohádek

Pohádka se nečte jako jedna nahrávka, ale po větách. Každá věta je samostatné MP3 v `audio/hlas/jana/` a přehrávač ([app/voice-player.js](../../app/voice-player.js)) je pouští za sebou s přesnými mezerami. Hudba a zvukové efekty hrají ve vlastních stopách ([app/audio.js](../../app/audio.js)), do hlasu se nemíchají.

- **Společné věty** neobsahují jméno, místo ani jídlo. Jsou to jen tvary podle rodu a čísla (vzal / vzala / vzali / vzaly) a role rodiče (maminka / tatínek / babička / dědeček). Namluví se jednou pro všechny rodiny.
- **Osobní věty** obsahují údaje rodiny a namluví se pro ni zvlášť. Klíč nahrávky je otisk textu věty ([app/voice-lines.js](../../app/voice-lines.js)), takže stejnou větu, třeba „Dobrou noc, Aničko.“, sdílí všechny rodiny se stejným jménem.
- Věta se nikdy nedělí uprostřed přímé řeči, aby postava neměnila hlas v půlce repliky.

## Jak vznikají nahrávky

Všechno se generuje přes ElevenLabs, a to **po jedné větě přes `tts-worker`**, stejně jako aplikace dotahuje věty se jmény. Společné i osobní věty tak mají stejný hlas, model, stabilitu i značku nálady a na spojích není slyšet, že jde o dva zdroje. Magnific se nepoužívá.

- hlas Jana (ElevenLabs `bF7C2fCv7Zf30iT84wZ1`), model `eleven_v4`, stabilita 0.75 – nastavení je jen ve `tts-worker/wrangler.toml`,
- na začátku každé věty značka nálady podle pohádky (`MOOD_TAG` v `lib.mjs` a ve Workeru),
- klíč ElevenLabs zůstává ve Workeru, skripty ho nepotřebují.

```bash
ZNOVU=1 node tools/hlas/plan.mjs spolecne                         # všechny společné věty
ZNOVU=1 node tools/hlas/plan.mjs rodina tools/hlas/rodiny/tonik.json   # testovací rodiny
ZNOVU=1 node tools/hlas/plan.mjs rodina tools/hlas/rodiny/anicka.json
node tools/hlas/namluvit.mjs odhad tools/hlas/davky/*-spolecne.json tools/hlas/davky/*-tonik.json tools/hlas/davky/*-anicka.json
node tools/hlas/namluvit.mjs nahrat tools/hlas/davky/*-spolecne.json tools/hlas/davky/*-tonik.json tools/hlas/davky/*-anicka.json
```

`odhad` vypíše počet vět a znaků (ElevenLabs účtuje znaky včetně značky nálady). `nahrat` stáhne věty z Workeru do `tools/hlas/nahravky/el/` (po přerušení pokračuje), ořízne ticho na krajích (0,05 / 0,08 s), srovná hlasitost na −19 LUFS a přepíše `audio/hlas/jana/` a `index.json`. Bez `ZNOVU=1` naplánuje `plan.mjs` jen věty, které ještě nahrané nejsou.

**Po přepsání nahrávek zvyš číslo cache `AUDIO`** v `app/sw.js` i `app/offline.js` (např. `ospalek-hlas-1` → `ospalek-hlas-2`). Webová aplikace si nahrávky ukládá kvůli poslechu bez internetu a bez nového čísla by dál hrála ty staré.

**Když změníš hlas, model nebo stabilitu ve Workeru, musíš znovu namluvit všechny hotové věty** (příkazy výše), jinak se na spojích budou střídat dva přednesy. Worker má stabilitu v klíči mezipaměti, takže osobní věty se přegenerují samy.

Poslech celé pohádky: `node tools/hlas/slozit.mjs tools/hlas/rodiny/<rodina>.json <pohádka>` ji složí do `tools/hlas/ukazky/`.

ffmpeg: proměnná `FFMPEG`, jinak `ffmpeg` z PATH. Bez Homebrew stačí `uvx --from imageio-ffmpeg python -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"`.

`casovani.py` a `cut.mjs` jsou ze starší cesty (celá pohádka jako jedna nahrávka, pak střih na věty). Teď se nepoužívají.

## Psaní nových pohádek, aby vyšly levně a zněly sourodě

- Osobní údaje dávej do **krátkých samostatných vět**. Například „Tak Toník začal broukat. Tiše, tichounce, jako když padá sníh.“: první věta je osobní a krátká, druhá je společná. Věta, ve které je jméno, se platí pro každou rodinu celá.
- Nejlevnější jsou věty, ve kterých je **jen jméno**, třeba „Dobrou noc, Toníku.“ nebo „Toník dostal nápad.“. U častých jmen se zaplatí jen jednou a pak je sdílí všechny rodiny se stejným jménem.
- Místa, jídlo a zvíře jsou u každé rodiny jiné. Používej je střídmě a na pár místech, kde opravdu potěší.
- Po změně textu pohádky se změní klíče vět. Stačí znovu spustit `plan.mjs` a nahrát jen nové věty.

## Co je v repozitáři

- `audio/hlas/jana/`: nahrávky vět a `index.json`. Repozitář je veřejný, proto sem patří jen společné věty a smyšlené testovací rodiny z `tools/hlas/rodiny/` (Toník, Anička).
- Osobní věty skutečných rodin se v produkci generují přes `tts-worker` a ukládají do R2, do gitu nikdy. Přehrávač si chybějící věty umí vyžádat sám (`fallback` v `voice-player.js`).
- `davky/`, `nahravky/` a `ukazky/` jsou pracovní soubory a v gitu nejsou.

## Stejné jméno = stejné nahrávky

Klíč nahrávky je otisk textu věty, ne rodiny. Dva různí Toníci proto sdílejí každou větu, která zní stejně:

1. **Společné věty** (bez jména) jsou hotové v `audio/hlas/jana/` pro všechny.
2. **Věty se jménem**, třeba „Toník dostal nápad.“ nebo „Dobrou noc, Toníku.“, se namluví při prvním Toníkovi. Worker je uloží do společné mezipaměti a R2, takže každý další Toník je dostane zdarma. Přehrávač si o ně Workeru říká sám.
3. **Věty s městem, jídlem nebo jménem rodiče** jsou u každé rodiny jiné a platí se vždycky.

Druhý Toník s jiným městem, jídlem a rodičem dnes použije **83 %** hotových nahrávek. Platí jen věty ze skupiny 3 a věty s rodičem, kterého první Toník neměl.

Věty pro častá jména jde namluvit předem, aby za ně neplatila ani první rodina:

```bash
node tools/hlas/plan.mjs jmena
```

```bash
node tools/hlas/predehrat.mjs https://ospalek-tts.<tvuj-ucet>.workers.dev
```

- `plan.mjs jmena` vezme seznam jmen z `jmena.json` a spočítá cenu. Jedno jméno má asi 3 000 znaků, protože zahrnuje varianty s maminkou, tatínkem, babičkou a dědečkem i roli sourozence. Přes API ElevenLabs to je asi 5,50 Kč za jméno a 40 jmen stojí asi 220 Kč.
- `predehrat.mjs` pošle věty Workeru, který je namluví a uloží. Věta, která už uložená je, nic nestojí, takže skript jde pouštět opakovaně. Bez Workeru se dá vyzkoušet proti atrapě `node tts-worker/dev-mock.mjs` na adrese `http://localhost:8787`.
- Seznam v `jmena.json` je zatím jen odhad: nejčastější jména podle ČSÚ a domácké tvary. Až poběží provoz, nahraď ho nejčastějšími jmény z administrace.

Aby věty z Workeru seděly ke společným, Worker používá stejný model (`eleven_v4`), stabilitu 0.75 a značku nálady podle pohádky (`mood`). Přehrávač jim navíc ořízne ticho a srovná hlasitost jako `namluvit.mjs`. Dokud ve Workeru není zapnuté R2, drží sdílené věty jen mezipaměť Cloudflaru. Hotové nahrávky z `audio/hlas` ale hrají i bez Workeru.
