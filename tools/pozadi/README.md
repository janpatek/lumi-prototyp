# Zvuk v pozadí pohádek

Každá pohádka má v `audio/pozadi/` dvě smyčky, které přehrávač ([app/audio.js](../../app/audio.js)) hraje současně:

- **kulisa** `<pohádka>-kulisa.mp3`: ruchy podle děje (noc a cvrčci, les, auto, jeskyně, kuchyně, ráno doma),
- **hudba** `<pohádka>-hudba.mp3`: tichá hrací skříňka a klavír.

Pod hlasem se pozadí ztlumí na polovinu, v pauzách na odpověď a na konci zase zesílí. V přehrávači jde přepnout na „Jen čtení“. Volba a hlasitost se pamatují v localStorage (`ospalek-pozadi`). Pohádka bez smyček dostane hudbu syntetizovanou podle `mood`.

## Jak smyčky vznikly

Vygenerované přes Magnific (2026-11-10):
- kulisa: ElevenLabs Sound Effects, 30 s, `loop: true`,
- hudba: Google Lyria 3, 30 s, instrumentální.

Jedna smyčka stojí asi 150 kreditů (kulisa) a 80 kreditů (hudba). Zadání byla v angličtině: popis místa a ruchů, „calm, no sudden sounds“, u hudby „music box and soft piano, no drums, no vocals, loopable ending“ a tempo podle nálady. Když kulisa vyjde skoro tichá (kolem −70 dB), vygeneruj ji znovu s `promptInfluence` 0.6 a slovy „clearly audible“.

## Úprava na smyčky

Nahrávky ulož jako `<složka>/kulisa-<pohádka>.mp3` a `<složka>/hudba-<pohádka>.mp3` a spusť:

```bash
uvx --with numpy python -I tools/pozadi/smycky.py "$FFMPEG" <složka>
```

Skript ořízne doznění na konci, ztlumí náhlé hlasité zvuky, prolne konec do začátku, srovná hlasitost a zapíše `audio/pozadi/index.json`. Smyčka má na krajích půl sekundy přesahu. Přehrávač smyčkuje mezi `pad` a `pad + body`, takže posun dekodéru MP3 nezpůsobí mezeru.

`obalka.py` vypíše hlasitost po sekundách. Hodí se na kontrolu nových nahrávek.

ffmpeg bez Homebrew: `uvx --from imageio-ffmpeg python -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"`.

## Sdílené kulisy (30 pohádek z 2026-11-10)

Každá pohádka má vlastní hudbu. Kulisu má vlastní jen část nových pohádek, ostatní si ji půjčují od pohádky s podobným prostředím. Seznam je v `sdilene.json`. Skript je v `index.json` nasměruje na cizí soubor, takže se nic nekopíruje.

- **Vlastní kulisa** (9): mesicni-lodka (řeka v noci), spaci-vlak, tajna-superschopnost (náměstí s fontánou), bourka-nebojsa (déšť a vzdálený hrom), dvanact-mesicku (oheň v zimním lese), raketou-na-mesic, ponorka-pod-rybnikem, jednorozec-narozeniny (kouzelné třpytky), velika-repa (statek se slepicemi, 2026-11-11).
- **Vlastní hudba**: všech 30. Šestnáct z nich (dvanact-mesicku, zlatovlaska, velika-repa, hrnecku-var, prvni-den-ve-skolce, spani-u-babicky, bourka-nebojsa, ponozkozrout, den-naruby, cesta-za-pokladem, zmrzlinovy-dest, kdo-to-dela, noc-v-lese, dinosaurus-na-zahrade, raketou-na-mesic, ponorka-pod-rybnikem) přibylo 2026-11-11, do té doby hrály hudbu jiné pohádky.

Když přibude vlastní smyčka, ulož nahrávku, spusť skript a smaž odpovídající řádek v `sdilene.json`.

## Pohádky do stovky (67 pohádek z 2026-11-11)

Nemají vlastní smyčky. Kulisu i hudbu si půjčují od hotových pohádek s podobným prostředím a náladou (`sdilene.json`, druh `kulisa` i `hudba`). Vlastní hudba by stála asi 80 kreditů Magnific na pohádku; po vygenerování stačí smazat řádek v `sdilene.json` a spustit skript.
