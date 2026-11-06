# Lumi – pohádky o tobě (prototyp)

Klikací webový prototyp mobilní aplikace s personalizovanými pohádkami pro děti.
Rodič zadá děti, rodiče a bydliště. Pohádky jsou pak o jeho dětech a odehrávají se v okolí, které znají.

**Vyzkoušet:** https://janpatek.github.io/lumi-prototyp/ (nejlépe na mobilu)

## Co prototyp umí
- Onboarding: děti (jméno, kluk/holka, věk, oblíbené jídlo a zvíře), rodiče a prarodiče, bydliště a místa v okolí (OpenStreetMap).
- Automatické skloňování jmen („Toníkovi“, „s Eliškou“) a shoda sloves podle pohlaví.
- Hlavním hrdinou může být jedno dítě nebo víc sourozenců najednou.
- Knihovna 6 pohádek v kategoriích, 3 zdarma, ostatní za (simulovaným) předplatným.
- Přehrávač s hudbou, zvukovými efekty a zvýrazněním textu. Pauzy na odpověď u hádanek.
- Ukázky realistického hlasu (ElevenLabs, vypravěčka Jana): pohádky zdarma pro testovacího hrdinu „Toník“.

## Poznámky k testování
- Přihlášení i platba jsou jen simulované. Data rodiny se ukládají jen v daném prohlížeči.
- Nahrávky z ElevenLabs hrají, jen když je jediným hrdinou dítě jménem Toník. Jinak čte hlas prohlížeče.
- Začít znovu: ⚙️ → „Smazat všechna data a začít znovu“.

## Spuštění lokálně
Stačí jakýkoli statický server, například:

```bash
python3 -m http.server 5174
```
