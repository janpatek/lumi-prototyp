# Zvuky pohádek: hudba, kulisy a efekty

Pod hlasem vypravěčky hrají tři vrstvy. Přehrává je [app/audio.js](../../app/audio.js), efekty časuje [app/voice-player.js](../../app/voice-player.js).

- **Hudba podle stylu pohádky.** Knihovna má 20 stylů po 5 skladbách, každá trvá 2–3 minuty. Uložená je v `audio/hudba/`.
  - Styly jsou třeba ukolébavka, klidný klavír, Vánoce, tichá vánoční noc, lidová pohádka, zámek, legrace, vesmír, pod vodou nebo na cestách.
  - Skladby jednoho stylu hrají za sebou v náhodném pořadí a prolínají se. V průměrné pohádce (7 minut) se tak nic neopakuje.
- **Kulisa**: ruchy prostředí jako les, statek, krb, déšť nebo vlak. Je to smyčka 30 s v `audio/pozadi/`.
  - Během pohádky se může měnit podle děje, například domov → auto → les. Změna proběhne prolnutím.
- **Efekty**: krátké zvuky na místech děje, třeba štěkot psa, vrzání dveří, kokrhání nebo kouzlo.
  - Knihovna má 201 efektů, většinou po 3 variantách, aby se stejný zvuk neopakoval. Leží v `audio/efekty/`.
  - Efekt zazní před větou, po větě nebo tiše pod ní. Hlas na něj počká.

Pod hlasem se hudba a kulisa ztlumí na polovinu. V pauzách na odpověď a na konci zase zesílí. Uspávanky mají efekty tišší a v posledních 20 % pohádky už žádné.

„Bez hudby“ v přehrávači vypne hudbu i kulisu, efekty v textu hrají dál. Volba a hlasitost se pamatují v localStorage (`ospalek-pozadi`).

## Plán pohádky

Všechno, co ke které pohádce patří, je v [pohadky.json](pohadky.json):

```json
"vyprava": {
  "styl": "les",
  "kulisa": [{ "od": 0, "id": "domov-rano" }, { "od": 2, "id": "auto" }, { "od": 3, "id": "les-den" }],
  "fx": [{ "p": 1, "at": "Brrrrm", "fx": "auto-start", "kdy": "pred" }]
}
```

- `styl` je id ze [styly.json](styly.json).
- `kulisa` je `null`, jedno id, nebo seznam změn od odstavce `od`. Id jsou v [kulisy.mjs](kulisy.mjs).
- `fx[].p` je číslo odstavce a `at` krátký úryvek z jeho textu.
  - Úryvek nesmí obsahovat jméno, místo ani tvar podle rodu.
- `fx[].fx` je id z [efekty-katalog.mjs](efekty-katalog.mjs).
- `kdy` je `pred`, `po` nebo `spolu`.

Pohádka bez plánu dostane hudbu podle `mood` (lullaby → ukolebavka, adventure → les, road → auto). Staré značky `sfx` v textu (sparkle, magic, ding…) se přehrají jako efekty z knihovny.

Plán nové pohádky:

1. Vypiš text s čísly odstavců. Příkaz ukáže, jak text vypadá u kluka i u holky:
   ```bash
   node tools/pozadi/texty.mjs <id>
   ```
2. Doplň pohádku do `pohadky.json`. Pravidla pro výběr a hustotu efektů jsou ve [ZADANI.md](ZADANI.md).
   - Podle nich rozmístili efekty do 113 pohádek pomocníci Claude.
3. Spusť kontrolu:
   ```bash
   node tools/pozadi/zvuky.mjs check tools/pozadi/pohadky.json
   ```
   Kontrola ověří úryvky ve třech verzích textu a přiřazení k větě.
4. Sestav index:
   ```bash
   node tools/pozadi/zvuky.mjs build
   ```
   Zapíše `audio/pozadi/index.json`, ten si aplikace v telefonu dotahuje z webu. Plán nové pohádky tedy funguje i bez nové verze aplikace.

## Jak zvuky vznikly (2026-11-17)

Generuje se přes Magnific:

| Co | Model | Cena |
|---|---|---|
| Skladba | Google Lyria 3 Pro, 2–3 min | 160 kreditů |
| Efekt | ElevenLabs Sound Effects, 3 varianty po 2–5 s | 30–75 kreditů |
| Kulisa | ElevenLabs Sound Effects, 30 s, `loop: true` | 150 kreditů |

Zadání jsou v `styly.json`, `efekty-katalog.mjs` a `kulisy.mjs`.

- Lyria občas skladbu zablokuje moderací, nejspíš kvůli podobnosti se známou melodií. Pomůže přeformulovat zadání („original … with a new gentle melody“).
- Když kulisa vyjde skoro tichá (pod −60 dB), vygeneruj ji znovu s `promptInfluence` 0.6–0.7 a slovy „clearly audible“.
- Zip z Magnificu zkracuje dlouhé názvy souborů. Varianty efektu s dlouhým zadáním pak mají v zipu jiný název, ne `…_<id>.mp3`.

Celá knihovna stála asi 27 000 kreditů:

- hudba asi 17 300 (100 skladeb a 8 opakování po moderaci),
- efekty asi 7 700,
- kulisy asi 2 000.

## Úprava nahrávek

ffmpeg bez Homebrew:

```bash
uvx --from imageio-ffmpeg python -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"
```

Hudba: soubory `<styl>-<číslo>.mp3`.

```bash
uvx --with numpy python -I tools/pozadi/hudba.py "$FFMPEG" <složka>
```

- Ořízne ticho a plynule srovná hlasitost.
- Přidá náběh a doznění.
- Rozdělí skladbu na části po 30 s s půlsekundovým přesahem do sousedních částí. Dekódovaná 3min skladba by v telefonu zabrala desítky MB, část jen pár.
- Délky zapíše do `hudba.json`.

Efekty: soubory `<id>-<varianta>.mp3`.

```bash
uvx --with numpy python -I tools/pozadi/efekty.py "$FFMPEG" <složka>
```

- Převede na mono, ořízne ticho a srovná hlasitost.
- Délky zapíše do `efekty.json`.
- Skoro tiché varianty vypíše, ty smaž.

Kulisy: soubory `kulisa-<id>.mp3`.

```bash
uvx --with numpy python -I tools/pozadi/smycky.py "$FFMPEG" <složka> --kulisy
```

- Udělá smyčku bez švu a délku zapíše do `kulisy.json`.
- Bez `--kulisy` skript dělá staré smyčky pro jednotlivé pohádky.

Po každé úpravě spusť `node tools/pozadi/zvuky.mjs build`.

`obalka.py` vypíše hlasitost po sekundách. Hodí se na kontrolu nových nahrávek.

## V mobilní aplikaci

- `mobile/scripts/copy-web.mjs` přibalí efekty, kulisy a hudbu stylů pohádek zdarma.
- Ostatní hudbu aplikace stahuje z ospalek.cz při poslechu a ukládá ji do zařízení (složka `zvuky/`, viz [app/remote.js](../../app/remote.js)).
- „Stáhnout na cestu“ stáhne i celou hudbu stylu pohádky.

## Staré smyčky

`audio/pozadi/<pohádka>-hudba.mp3`, `<pohádka>-kulisa.mp3`, `sdilene.json` a `clips` v indexu jsou z první verze (2026-11-10).

- Používají je aplikace do verze 1.20, proto zůstávají.
- Kulisy z nich jsou v `kulisy.mjs` pod jmény prostředí.
- Do nové mobilní aplikace se staré smyčky hudby nepřibalují.
