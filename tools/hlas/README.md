# Skládaný hlas pohádek

Pohádka se nečte jako jedna nahrávka, ale po větách. Každá věta je samostatné MP3 v `audio/hlas/jana/` a přehrávač ([app/voice-player.js](../../app/voice-player.js)) je pouští za sebou s přesnými mezerami. Hudba a zvukové efekty hrají ve vlastních stopách ([app/audio.js](../../app/audio.js)), do hlasu se nemíchají.

- **Společné věty** neobsahují jméno, místo ani jídlo. Jsou to jen tvary podle rodu a čísla (vzal / vzala / vzali / vzaly) a role rodiče (maminka / tatínek / babička / dědeček). Namluví se jednou pro všechny rodiny.
- **Osobní věty** obsahují údaje rodiny a namluví se pro ni zvlášť. Klíč nahrávky je otisk textu věty ([app/voice-lines.js](../../app/voice-lines.js)), takže stejnou větu, třeba „Dobrou noc, Aničko.“, sdílí všechny rodiny se stejným jménem.
- Věta se nikdy nedělí uprostřed přímé řeči, aby postava neměnila hlas v půlce repliky.

## Jak vznikají nahrávky

```
plan.mjs  →  dávka textu (jedna na pohádku)  →  TTS (Jana, eleven_v4, stability 0.6)
          →  casovani.py (kde začíná každá věta)  →  cut.mjs (střih v pauzách, hlasitost, kontrola)
```

1. Vytvoř plán dávek:
   - pro všechny pohádky: `node tools/hlas/plan.mjs spolecne`
   - pro jednu rodinu: `node tools/hlas/plan.mjs rodina tools/hlas/rodiny/<rodina>.json`

   Vzniknou soubory `tools/hlas/davky/<pohádka>-<dávka>.txt` (text pro TTS) a `.json` (seznam vět). Věty, které už jsou nahrané, se přeskočí.
2. Text z `.txt` nech namluvit:
   - hlas Jana (Magnific voice 857 = ElevenLabs „Jana Procházková“),
   - model `eleven_v4`, stability 0.6,
   - značku nálady na začátku nech být, drží stejný přednes ve všech dávkách.

   Nahrávku ulož jako `tools/hlas/nahravky/<dávka>.mp3`.
3. Najdi začátky vět. Rozpoznávání řeči běží lokálně, bez kreditů:
   ```bash
   uvx --with faster-whisper python tools/hlas/casovani.py <dávka> tools/hlas/nahravky/<dávka>.mp3
   ```
4. Rozstříhej nahrávku:
   ```bash
   node tools/hlas/cut.mjs <dávka> tools/hlas/nahravky/<dávka>.mp3 tools/hlas/nahravky/<dávka>.zacatky.json
   ```
   Skript srovná hlasitost dávky na −19 LUFS a stříhá v pauzách. Když dvě věty navazují bez pauzy, stříhá v nejtišším místě. Nakonec zkontroluje tempo každé věty. Když nějaká vybočuje, střih je špatně a skript `index.json` nezmění.
5. Poslechni si výsledek: `node tools/hlas/slozit.mjs tools/hlas/rodiny/<rodina>.json <pohádka>` složí celou pohádku do `tools/hlas/ukazky/`.

ffmpeg: proměnná `FFMPEG`, jinak `ffmpeg` z PATH. Bez Homebrew stačí `uvx --from imageio-ffmpeg python -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"`.

## Psaní nových pohádek, aby vyšly levně a zněly sourodě

- Osobní údaje dávej do **krátkých samostatných vět**. Například „Tak Toník začal broukat. Tiše, tichounce, jako když padá sníh.“: první věta je osobní a krátká, druhá je společná. Věta, ve které je jméno, se platí pro každou rodinu celá.
- Nejlevnější jsou věty, ve kterých je **jen jméno**, třeba „Dobrou noc, Toníku.“ nebo „Toník dostal nápad.“. U častých jmen se zaplatí jen jednou a pak je sdílí všechny rodiny se stejným jménem.
- Místa, jídlo a zvíře jsou u každé rodiny jiné. Používej je střídmě a na pár místech, kde opravdu potěší.
- Po změně textu pohádky se změní klíče vět. Stačí znovu spustit `plan.mjs` a nahrát jen nové věty.

## Co je v repozitáři

- `audio/hlas/jana/`: nahrávky vět a `index.json`. Repozitář je veřejný, proto sem patří jen společné věty a smyšlené testovací rodiny z `tools/hlas/rodiny/` (Toník, Anička).
- Osobní věty skutečných rodin se v produkci generují přes `tts-worker` a ukládají do R2, do gitu nikdy. Přehrávač si chybějící věty umí vyžádat sám (`fallback` v `voice-player.js`).
- `davky/`, `nahravky/` a `ukazky/` jsou pracovní soubory a v gitu nejsou.

**Pozor, ještě není hotové:** aby osobní věty z `tts-worker` seděly ke společným, musí Worker používat stejný hlas, stejný model (`eleven_v4`) a stejnou značku nálady. Teď má ve `wrangler.toml` model `eleven_multilingual_v2` a značku nálady neposílá. Dokud se to nesjednotí, bude na spojích slyšet jiný přednes.
