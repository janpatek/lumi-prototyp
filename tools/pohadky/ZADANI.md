# Zadání: koncepty nových pohádek pro Ospalka

Ospalek je aplikace s personalizovanými audio pohádkami na dobrou noc pro děti 2–9 let v CZ a SK. Hrdinou je dítě z rodiny (případně víc sourozenců), děj se často dotkne jejich obce. Pohádku čte hlas „teta Terezka“ (ElevenLabs) po větách. Teď píšeme jen TEXT ke schválení – žádné generování hlasu, obrázků ani zvuků, nic necommituj.


Než začneš, přečti si:
- `app/stories.cs.js` – hlavička popisuje kontext `c`, a 6 hotových pohádek ukazuje styl a práci s tvary.
- `tools/hlas/README.md`, část „Psaní nových pohádek“.
- `app/voice-lines.js` – jak se odstavec dělí na věty (uvnitř „…“ se nedělí).

## Formát souboru

Svou dávku zapiš do JEDNOHO souboru `koncepty/pohadky/<písmeno>.js` (písmeno máš níže):

```js
// Dávka X – krátký popis
window.STORIES_DRAFT = (window.STORIES_DRAFT || []).concat([
  {
    id: 'jednorozec-duhanek',      // malá písmena, pomlčky, bez diakritiky
    delka: 5,                      // cílová délka v minutách: 5, 10 nebo 15
    pro: 'f',                      // komu tématem sedí víc: 'f' holky, 'm' kluci, 'vse'
    pozn: 'Jednou dvěma větami, o čem pohádka je (pro schvalování).',
    pouceni: 'Jedna věta: co si dítě odnese (pro schvalování).',
    free: false,
    cats: ['noc', 'zvirata'],      // první je hlavní kategorie
    ages: [2, 6],
    mood: 'lullaby',               // 'lullaby' | 'adventure' | 'road'
    cover: { emoji: '🦄', g1: '#…', g2: '#…' },   // obrázek zatím není
    title: (c) => `…`,
    text: (c) => [ { t: `…` }, { t: `…`, sfx: 'sparkle' }, { t: `…`, pause: 6 } ],
  },
]);
```

Kategorie: `noc` Na dobrou noc, `auto` Do auta, `dobro` Dobrodružství, `zivot` Ze života, `sranda` Srandovní, `lidove` Klasické pohádky, `hrdinove` Superhrdinové, `zvirata` O zvířátkách, a nové `svatky` Oslavy a svátky, `zvidave` Zvídavé (jak věci fungují).
sfx jen: sparkle, magic, car, horn, birds, owl, paper, wind, ding. Používej střídmě (2–5 na pohádku).
`cap` a `listCz` jsou globální funkce ze `stories.cs.js`, můžeš je používat, nedeklaruj je znovu.

## Délka

Aplikace počítá minuty takto: každé slovo 0,5 s + 1 s za odstavec + `pause`. Tedy zhruba:
- 5 min ≈ 520–600 slov (asi 15–22 odstavců)
- 10 min ≈ 1050–1150 slov (25–35 odstavců)
- 15 min ≈ 1600–1750 slov (35–50 odstavců)
Odstavec drž na 1–4 větách. Validátor hlídá, aby vyšlo 5 přesně, 10 ± 1 a 15 ± 1.

## Personalizace a hlas (důležité kvůli ceně)

- Každá věta, ve které je jméno, místo, jídlo, zvíře nebo jméno rodiče, se platí pro každou rodinu zvlášť. Proto:
  - osobní údaje dávej do KRÁTKÝCH samostatných vět („Tak Toník začal broukat. Tiše, tichounce, jako když padá sníh.“),
  - dlouhé popisné a dějové věty piš bez osobních údajů (jen s tvary c.g / c.n, ty jsou levné),
  - místo jména často stačí „hrdina“? NE – raději přirozeně skladbou: podmět vynech, nebo použij zájmeno („Hned se rozběhl…“ přes c.g).
  - cíl: osobní věty do ~25 % znaků (validátor to vypisuje). Jméno ale musí zaznít dost často, aby dítě cítilo, že je to o něm – třeba každý 3.–5. odstavec.
- Nedělej větu uprostřed přímé řeči. Replika postavy ať je v jedné větě/odstavci s uvozovkami „…“.
- Místa (c.inTown, c.near, c.attr), jídlo (c.food) a zvíře (c.animal) použij jen na 1–3 místech, kde opravdu potěší. Vždy počítej s tím, že `c.near` a `c.attr` mohou být prázdné pole a `c.p2` a `c.sib` null – měj záložní text.
- Pozor na tvary: c.food je seznam v 1. pádě („palačinky“, „jahody a knedlíky“), c.animal taky („liška“, „koník“). Nepoužívej je v jiných pádech – piš je za dvojtečku nebo do vazby, která 1. pád snese („to nejlepší jídlo na světě: …“, „zvíře, které má nejradši – …“).
- c.near jsou názvy obcí v 1. pádě. Nevkládej je do pádových vazeb typu „do …“, „v …“; použij výčet nebo „místo, kterému se říká …“.
- Rodiče: c.p1.full („maminka Petra“), c.p1.nom/gen/dat/acc/ins, c.p1.g(m, f). Druhý rodič c.p2 může chybět.
- Hrdinů může být 1–3: každé sloveso a přídavné jméno vztažené k hrdinovi přes c.g(m, f, mpl, fpl) a c.n(jedno, víc). Oslovení c.h.voc, „ty/vy“ přes c.n. Projdi to pečlivě – validátor zkouší kluka, holku, dvě děti, dvě holky a rodinu bez okolí, ale gramatiku za tebe nezkontroluje; přečti si výstup `--text` aspoň pro „holka“ a „dvě děti“.

## Obsah a tón

- Čeština přirozená, vřelá, s humorem a rytmem, krátké věty, žádné kostrbaté překlady. Zvukomalba, opakování, refrény jsou vítané (dobře se poslouchají).
- Bezpečné: nic opravdu strašidelného, žádné násilí, smrt, zranění. Zápor se vyřeší laskavostí, chytrostí nebo humorem. Pohádky v kategorii `noc` končí zklidněním a usínáním (poslední odstavce pomalé, „Dobrou noc, …“).
- Členové rodiny NIKDY nejsou záporáci (macecha, zlý tatínek apod.). U lidových pohádek záporné postavy zůstávají fiktivní (král, macecha z pohádky…), dítě v pohádce hraje hlavní roli nebo pomocníka.
- Lidové pohádky jsou volné dílo (Erben, Němcová), ale převyprávěj je VLASTNÍMI slovy a zkráceně pro malé děti; nepřebírej věty z žádných moderních adaptací ani filmů.
- Superhrdinové jsou úplně vlastní, vymyšlení (žádní Marvel/DC, Paw Patrol apod.). Superschopnosti dětské a laskavé.
- Pro holky / pro kluky je jen tématem (`pro`); text vždy funguje pro libovolný rod hrdiny přes c.g.
- Nová id nesmí kolidovat s existujícími (všechna id v `app/stories.cs.js`); témata nesmí opakovat hotové pohádky.

## Poučení a chytrost

- Každá pohádka má jasné poučení (`pouceni`), ale NEMORALIZUJE. Dítě na něj přijde samo přes děj: hrdina něco zkusí, splete se, najde lepší cestu. Žádné „A víte, děti, že…“ ani kázání na konci; nanejvýš jedna laskavá věta postavy nebo vypravěče, která to shrne.
- Chytré a inteligentní: hrdina problém vyřeší přemýšlením, otázkou, pozorováním, spoluprací nebo laskavostí – ne náhodou ani kouzlem, které vše spraví samo.
- Fakta musí sedět (věda, příroda, zdraví, bezpečnost). Řekni je jednoduše a přesně pro daný věk; když si nejsi jistý, raději méně faktů, ale správně. Tísňová čísla v CZ i SK: 150 hasiči, 155 záchranka, 158 policie, 112 jednotné.
- Vtip a nápad: každá pohádka má aspoň jeden originální, zapamatovatelný nápad (postava, refrén, zvrat), ať se pohádky navzájem nepodobají.

## Kontrola

Po napsání spusť:
```
node tools/pohadky/over.mjs koncepty/pohadky/<písmeno>.js
node tools/pohadky/over.mjs koncepty/pohadky/<písmeno>.js --text <id>
```
Oprav všechny ✗ a přečti si texty pro holku a dvě děti. Hotovo = všechny pohádky dávky ✓ a gramaticky správně.

Na konec vrať stručně: id, název, délka v min, osobní %, a jednu větu, co bylo nejtěžší / co by měl schvalovatel zkontrolovat.
