# Zadání: zvuky pro pohádky Ospalka

Ospalek je česká aplikace s pohádkami pro děti 2–8 let, čte je vypravěčka (teta Terezka). Pod hlasem hraje hudba a ruchy prostředí a na místech děje zazní zvukové efekty (štěkot psa, vrzání dveří, mňoukání…). Cílem je, aby to pro dítě bylo co nejpoutavější a přitom příjemné, ne rušivé.

Pracuješ v repozitáři. Výsledek patří do tools/pozadi/pohadky.json (pomocníci psali do zvláštních souborů, které se pak sloučily).

## Podklady (přečti si je)
- `tools/pozadi/styly.json` – 20 hudebních stylů (id a popis).
- `tools/pozadi/kulisy.mjs` – ruchy prostředí (smyčky), id a popis.
- `tools/pozadi/efekty-katalog.mjs` – katalog efektů: id → [popis česky, zadání, délka v s].
- Texty pohádek: `node tools/pozadi/texty.mjs <id> <id> …` vypíše odstavce s čísly [p].

## Co pro každou pohádku vybrat
1. **styl** – hudba celé pohádky podle nálady a tématu (Vánoce → vanoce nebo vanoce-noc, uspávanky → ukolebavka / hvezdy / klavir, klasické pohádky → lidova / zamek / zima, srandovní → sranda, superhrdinové → hrdinove, zvídavé → zvidave, do auta → auto, ze života → domov nebo klavir, zvířátka → zviratka …). Vyber podle toho, jak pohádka opravdu zní, ne jen podle kategorie.
2. **kulisa** – ruchy prostředí. Buď `null` (jen hudba), nebo id, nebo seznam změn podle děje: `[{"od": 0, "id": "domov-rano"}, {"od": 14, "id": "les-den"}, {"od": 30, "id": null}]` (od = číslo odstavce). Kulisu dávej jen tam, kde se děj opravdu odehrává v jasném prostředí. Ať nemění každou chvíli (nejvýš 3–4 změny v pohádce).
3. **fx** – efekty na místech děje. Každý záznam:
   `{"p": 12, "at": "zavrzaly dveře", "fx": "dvere-vrzani", "kdy": "pred"}`
   - `p` číslo odstavce, `at` krátký úryvek (2–5 slov) přesně z textu odstavce,
   - `kdy`: `pred` = efekt zazní a pak vypravěčka přečte větu s úryvkem; `po` = efekt zazní hned po té větě; `spolu` = efekt tiše pod začátkem věty (jen pro delší ruchy: déšť začne, vítr, vlak jede).
   - Úryvek **nesmí** obsahovat jméno dítěte, rodiče, město, jídlo, zvíře z kontextu ani slova, která se mění podle rodu a čísla (např. „uslyšel/uslyšela/uslyšeli“ – vezmi raději část bez nich, nebo jiné slovo z té věty). Kontrola to ověří na třech verzích textu.

## Kolik efektů a kam
- Efektů má být hodně, ale smysluplně: tam, kde text zmiňuje zvuk (štěkot, zaklepání, cink, kokrhání, hrom, „Haf!“, „Ťuk ťuk“) nebo výraznou akci (dveře se otevřou, něco spadne, kouzlo, auto zastaví, ptáci odletí).
- Orientačně: krátká pohádka (≈9 odstavců) 4–6 efektů, ≈25–30 odstavců 8–12, ≈50 odstavců 13–18, ≈70–80 odstavců 18–25.
- Když text zvuk napodobuje („Haf, haf!“, „Kykyryký!“), dej efekt `pred` nebo `po` k té větě – ať zvuk a slovo jdou spolu, ne přes sebe.
- Střídej efekty, ať se stejný neopakuje víckrát za sebou. Dvě efekty v jednom odstavci jen výjimečně.
- **Uspávanky (mood lullaby, kategorie noc)**: efekty jemné (sova, cvrček, třpyt, peřina, zívnutí, hodiny…), žádné hlasité (bouchnutí, troubení, řev). V posledních 20 % odstavců už žádné efekty – dítě usíná.
- Nic strašidelného ani lekavého. Bouchnutí dveří, hrom, řev zvířat jen tam, kde to děj opravdu chce, a ne v uspávankách.
- Dosavadní pole `sfx` v pohádkách (sparkle, magic, ding, birds…) ignoruj, tvůj plán je nahradí. Pokud se ti tam hodí třpyt/kouzlo/cink, dej je do plánu sám.

## Nové efekty
Když v katalogu chybí zvuk, který je pro děj důležitý, můžeš přidat nový do `_nove`:
`"_nove": { "kun-povoz": ["koňský povoz", "A horse-drawn carriage rolling on cobblestones.", 4] }`
(id bez diakritiky, popis česky, zadání anglicky – konkrétní zdroj zvuku, bez hudby a hlasů, délka 1–5 s). Nejdřív se ale podívej, jestli nestačí existující. Nejvýš ~8 nových na skupinu.

## Výstup
JSON soubor (cestu máš v zadání):
```json
{
  "_nove": { … },
  "hvezdicka": { "styl": "ukolebavka", "kulisa": "noc-okno", "fx": [ … ] },
  …
}
```
Pak spusť `node tools/pozadi/zvuky.mjs check <tvůj soubor>` a oprav všechny chyby, dokud nevypíše „v pořádku“.

Na konci odpověz jen krátce: kolik pohádek, kolik efektů celkem, seznam nových efektů z `_nove` a případné poznámky.
