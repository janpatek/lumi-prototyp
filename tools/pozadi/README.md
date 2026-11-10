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
