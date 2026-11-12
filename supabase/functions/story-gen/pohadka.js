// Ospalek – generátor pohádek: zadání pro model, tvar odpovědi a převod na šablonu pohádky.
// Sdílí ho Edge Function (index.ts, Deno) i lokální dev-server.mjs (Node), proto čistý JavaScript bez závislostí.
// Pravidla vycházejí z tools/pohadky/ZADANI.md; když se tam změní, uprav i SYSTEM níže.

export const MODEL = 'claude-opus-5-5';
export const CATS = { noc: 'Na dobrou noc', auto: 'Do auta', dobro: 'Dobrodružství', zivot: 'Ze života', sranda: 'Srandovní', lidove: 'Klasické pohádky', hrdinove: 'Superhrdinové', zvirata: 'O zvířátkách', svatky: 'Oslavy a svátky', zvidave: 'Zvídavé' };
export const LENGTHS = { 5: [520, 600, '15–22'], 10: [1050, 1150, '25–35'], 15: [1600, 1750, '35–50'] };
// Šablona se v aplikaci i administraci spouští jako kód: nic mimo kontext pohádky (stejná kontrola je v admin/generator.js).
export const UNSAFE = /\b(window|document|globalThis|self|top|parent|frames|opener|fetch|XMLHttpRequest|WebSocket|EventSource|localStorage|sessionStorage|indexedDB|caches|cookie|eval|Function|constructor|prototype|__proto__|import|require|location|navigator|setTimeout|setInterval|postMessage|Worker|alert)\b|\\u|\\x/;
const SFX = ['sparkle', 'magic', 'car', 'horn', 'birds', 'owl', 'paper', 'wind', 'ding'];

// Odpověď modelu (structured outputs): odstavce jsou těla JS template literálů, server z nich složí šablonu.
export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'title', 'paragraphs', 'cats', 'ages_od', 'ages_do', 'mood', 'pro', 'emoji', 'g1', 'g2', 'pozn', 'pouceni'],
  properties: {
    id: { type: 'string', description: 'malá písmena, číslice a pomlčky, bez diakritiky, např. mesicni-lodka' },
    title: { type: 'string', description: 'tělo template literálu názvu, např. ${c.H} a měsíční lodička' },
    paragraphs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['t', 'sfx', 'pause'],
        properties: {
          t: { type: 'string', description: 'tělo template literálu odstavce (bez obalových zpětných apostrofů)' },
          sfx: { type: 'string', enum: ['', ...SFX] },
          pause: { type: 'integer', description: 'pauza po odstavci v sekundách, obvykle 0' },
        },
      },
    },
    cats: { type: 'array', items: { type: 'string', enum: Object.keys(CATS) } },
    ages_od: { type: 'integer' },
    ages_do: { type: 'integer' },
    mood: { type: 'string', enum: ['lullaby', 'adventure', 'road'] },
    pro: { type: 'string', enum: ['vse', 'f', 'm'] },
    emoji: { type: 'string' },
    g1: { type: 'string', description: 'tmavší barva obálky #rrggbb' },
    g2: { type: 'string', description: 'světlejší barva obálky #rrggbb' },
    pozn: { type: 'string', description: 'jednou dvěma větami, o čem pohádka je' },
    pouceni: { type: 'string', description: 'jedna věta: co si dítě odnese' },
  },
};

export const SYSTEM = `Píšeš české pohádky pro Ospalka, aplikaci s personalizovanými audio pohádkami na dobrou noc pro děti 2–9 let v Česku a na Slovensku. Hrdinou je dítě z rodiny (nebo 2–3 sourozenci), děj se často dotkne jejich obce. Pohádku čte vypravěčka po větách.

## Formát
Každý odstavec i název je TĚLO JavaScriptového template literálu. Údaje rodiny vkládáš výrazy \${…} nad kontextem c:
- c.H – hrdina/hrdinové v 1. pádě („Toník“ / „Toník a Eliška“); c.h.gen, c.h.dat, c.h.acc, c.h.voc, c.h.ins – další pády.
- c.g(m, f, mpl, fpl) – tvar podle rodu a čísla: kluk, holka, víc dětí (aspoň jeden kluk), víc holek. fpl lze u sloves na -li vynechat („šli“ → „šly“). Příklad: \${c.g('usnul', 'usnula', 'usnuli')}.
- c.n(jedno, víc) – tvar jen podle čísla („má“/„mají“, „ty“/„vy“, „Pomůžeš“/„Pomůžete“).
- c.sib – sourozenec, který v pohádce není hrdinou (má .nom .gen .dat .acc .voc .ins), nebo null; c.sg(m, f) – tvar podle jeho rodu.
- c.p1, c.p2 – rodiče: .full („maminka Petra“), .nom/.gen/.dat/.acc/.ins („maminka“), .g(m, f). c.p2 může být null.
- c.inTown („v Benešově“), c.near (pole okolních obcí v 1. pádě, může být prázdné), c.attr (pole atrakcí v okolí, může být prázdné).
- c.food a c.animal – oblíbené jídlo a zvíře v 1. pádě („palačinky“, „jahody a knedlíky“, „liška“).
- Globální funkce cap(s) (velké první písmeno) a listCz(pole) („A, B a C“).
Uvnitř \${…} smíš psát vnořené template literály se zpětnými apostrofy, podmínky ?: a volání výše. Mimo \${…} zpětný apostrof nikdy nepiš. Odstavec může mít sfx (jen sparkle, magic, car, horn, birds, owl, paper, wind, ding; 2–5 za pohádku, jinak prázdný řetězec) a pause v sekundách (obvykle 0; kladné číslo jen u otázky, na kterou dítě může odpovědět).

Ukázka odstavců:
Bylo nebylo, \${c.inTown} stál jeden docela obyčejný dům. A v tom domě \${c.g('bydlel', 'bydlela', 'bydleli')} \${c.H}.
„Ahoj,“ pípla hvězdička. „Spadla jsem z nebe a nevím, jak se vrátit domů. \${c.n('Pomůžeš', 'Pomůžete')} mi, \${c.h.voc}?“
\${c.H} ani chvilku \${c.g('neváhal', 'neváhala', 'neváhali')}.\${c.sib ? \` Potichu \${c.g('vzbudil', 'vzbudila', 'vzbudili')} i \${c.sib.acc}, protože ve více se hvězdičky zachraňují mnohem líp.\` : ''} Hvězdičku \${c.g('vzal', 'vzala', 'vzali')} opatrně do dlaní.
Vtom do pokoje \${c.p1.g('nakoukl', 'nakoukla')} \${c.p1.full}. „Copak to tady tak svítí?“
\${c.near.length ? \`Odtamtud bylo vidět celé okolí – \${listCz(c.near.slice(0, 3))}.\` : 'Odtamtud bylo vidět celé okolí.'} Všechna ta místa už spala pod peřinou tmy.
\${cap(c.p1.full)} \${c.p1.g('balil', 'balila')} svačinu a přibalil\${c.p1.g('', 'a')} i to, co \${c.n('má', 'mají')} \${c.H} ze všeho nejradši: \${c.food}.
\${c.H} \${c.g('zalezl', 'zalezla', 'zalezli')} pod peřinu. Dobrou noc, \${c.h.voc}.
Ukázka názvu: \${c.n(\`\${c.H} a velká výprava\`, \`Velká výprava \${c.h.gen}\`)}

## Délka
Aplikace počítá minuty: každé slovo 0,5 s + 1 s za odstavec + pause. Cíl:
- 5 min ≈ 520–600 slov (15–22 odstavců), 10 min ≈ 1050–1150 slov (25–35 odstavců), 15 min ≈ 1600–1750 slov (35–50 odstavců).
Odstavec drž na 1–4 větách.

## Personalizace a hlas (kvůli ceně)
- Věta se jménem, místem, jídlem, zvířetem nebo jménem rodiče se namlouvá pro každou rodinu zvlášť. Osobní údaje dávej do KRÁTKÝCH samostatných vět, dlouhé popisné a dějové věty piš bez nich (jen s tvary c.g / c.n, ty jsou levné). Cíl: osobní věty do ~25 % znaků, ale jméno ať zazní každý 3.–5. odstavec.
- Nedělej větu uprostřed přímé řeči; replika postavy ať je celá v jednom odstavci s uvozovkami „…“.
- Místa, jídlo a zvíře použij jen na 1–3 místech. Vždy počítej s tím, že c.near a c.attr mohou být prázdné a c.p2 a c.sib null – měj záložní text.
- c.food a c.animal jsou v 1. pádě; nevkládej je do jiných pádů, piš je za dvojtečku nebo pomlčku. c.near jsou názvy obcí v 1. pádě; nepiš „do …“, „v …“, použij výčet.
- Hrdinů může být 1–3: každé sloveso a přídavné jméno vztažené k hrdinovi přes c.g, oslovení přes c.h.voc, „ty/vy“ přes c.n. Text musí fungovat pro kluka, holku, dvě děti i dvě holky.

## Obsah a tón
- Čeština přirozená, vřelá, s humorem a rytmem, krátké věty, žádné kostrbaté překlady. Zvukomalba, opakování a refrény jsou vítané.
- Bezpečné: nic opravdu strašidelného, žádné násilí, smrt ani zranění. Zápor se vyřeší laskavostí, chytrostí nebo humorem.
- Pohádky v kategorii noc končí zklidněním a usínáním (poslední odstavce pomalé, „Dobrou noc, …“).
- Členové rodiny nikdy nejsou záporáci. Superhrdinové jsou úplně vlastní, vymyšlení (žádné známé postavy ze seriálů a filmů). Lidové pohádky převyprávěj vlastními slovy.
- Jasné poučení, ale NEMORALIZUJ: hrdina problém vyřeší přemýšlením, otázkou, pozorováním, spoluprací nebo laskavostí, ne náhodou. Nanejvýš jedna laskavá shrnující věta postavy.
- Fakta musí sedět (věda, příroda, zdraví, bezpečnost). Tísňová čísla CZ i SK: 150 hasiči, 155 záchranka, 158 policie, 112.
- Každá pohádka má aspoň jeden originální, zapamatovatelný nápad (postava, refrén, zvrat). Neopakuj témata ani názvy existujících pohádek.

## Ostatní pole
id: nové, krátké, z malých písmen bez diakritiky. cats: první je hlavní kategorie (zadaná), další nanejvýš jedna. ages_od a ages_do: věkové rozpětí 2–9. mood: lullaby (klidná), adventure (dobrodružná), road (na cesty). pro: komu tématem sedí víc (vse, f, m). emoji a dvě barvy obálky. pozn a pouceni pro schvalovatele.`;

const clean = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// vstup z administrace → zkontrolovaný tvar
export function readInput(b) {
  const category = String(b.category || '');
  if (!CATS[category]) throw Object.assign(new Error('Neznámá kategorie.'), { status: 400 });
  const length = Number(b.length);
  if (!LENGTHS[length]) throw Object.assign(new Error('Délka musí být 5, 10 nebo 15 minut.'), { status: 400 });
  const topic = clean(b.topic, 800);
  if (topic.length < 3) throw Object.assign(new Error('Napiš, o čem má pohádka být.'), { status: 400 });
  const ages = Array.isArray(b.ages) && b.ages.length === 2 ? b.ages.map((x) => Math.min(9, Math.max(2, Math.round(Number(x) || 0)))) : null;
  const avoid = (Array.isArray(b.avoid) ? b.avoid : []).slice(0, 400).map((x) => clean(x, 120)).filter(Boolean);
  const rev = b.revise && typeof b.revise === 'object' ? {
    id: String(b.revise.id || '').slice(0, 80),
    titleSrc: String(b.revise.titleSrc || '').slice(0, 2000),
    textSrc: String(b.revise.textSrc || '').slice(0, 200000),
    note: clean(b.revise.note, 2000),
    problems: (Array.isArray(b.revise.problems) ? b.revise.problems : []).slice(0, 40).map((x) => clean(x, 300)),
  } : null;
  return { category, length, topic, ages, pro: ['f', 'm', 'vse'].includes(b.pro) ? b.pro : 'vse', avoid, revise: rev };
}

export function userPrompt(i) {
  const [lo, hi, paras] = LENGTHS[i.length];
  const lines = [
    `Kategorie: ${i.category} (${CATS[i.category]})`,
    `O čem má pohádka být: ${i.topic}`,
    `Délka: ${i.length} minut (${lo}–${hi} slov, ${paras} odstavců)`,
    i.ages ? `Věk dětí: ${i.ages[0]}–${i.ages[1]} let` : '',
    i.pro !== 'vse' ? `Tématem spíš pro ${i.pro === 'f' ? 'holky' : 'kluky'} (text ale musí fungovat pro libovolný rod hrdiny).` : '',
    i.avoid.length ? `Existující pohádky (id – název), neopakuj jejich id, názvy ani zápletky:\n${i.avoid.join('\n')}` : '',
  ];
  if (i.revise) {
    lines.push(`\nPředchozí verze pohádky (zdrojový kód šablony):\nNázev: ${i.revise.titleSrc}\nText: ${i.revise.textSrc}`);
    if (i.revise.problems.length) lines.push(`Automatická kontrola našla tyto problémy, oprav je:\n- ${i.revise.problems.join('\n- ')}`);
    lines.push(i.revise.note ? `Úpravy, které chce redaktor: ${i.revise.note}` : 'Zachovej děj a styl, oprav jen to, co je potřeba.');
    lines.push('Vrať celou upravenou pohádku ve stejném tvaru odpovědi a se stejným id.');
  } else {
    lines.push('\nNapiš celou pohádku.');
  }
  return lines.filter(Boolean).join('\n');
}

const tl = (s) => '`' + String(s).replace(/\r/g, '').trim() + '`';
const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const color = (s, d) => (/^#[0-9a-f]{6}$/i.test(String(s || '').trim()) ? String(s).trim() : d);

// odpověď modelu → pohádka ve tvaru katalogu (titleSrc, textSrc jako zdroj funkce) + údaje pro zásobník
export function toStory(o, i) {
  const paras = (o.paragraphs || []).filter((p) => p && String(p.t || '').trim());
  if (!paras.length) throw new Error('Model nevrátil žádný text.');
  const textSrc = '(c) => [\n' + paras.map((p) => `      { t: ${tl(p.t)}${SFX.includes(p.sfx) ? `, sfx: '${p.sfx}'` : ''}${p.pause > 0 ? `, pause: ${Math.min(30, Math.round(p.pause))}` : ''} },`).join('\n') + '\n    ]';
  if (UNSAFE.test(textSrc) || UNSAFE.test(String(o.title || ''))) throw Object.assign(new Error('Model vrátil šablonu s nepovoleným kódem. Zkus to znovu.'), { status: 502 });
  const cats = [i.category, ...(o.cats || []).filter((c) => CATS[c] && c !== i.category)].slice(0, 2);
  const a = [Number(o.ages_od) || 2, Number(o.ages_do) || 9].map((x) => Math.min(9, Math.max(2, x))).sort((x, y) => x - y);
  return {
    story: {
      id: slug(o.id) || 'nova-pohadka', free: false, cats, ages: i.ages || a, mood: ['lullaby', 'adventure', 'road'].includes(o.mood) ? o.mood : 'lullaby',
      cover: { img: '', imgF: '', emoji: clean(o.emoji, 8) || '🌙', g1: color(o.g1, '#1d2b64'), g2: color(o.g2, '#6a4c93') },
      titleSrc: '(c) => ' + tl(o.title || '${c.H} a nová pohádka'), textSrc,
    },
    brief: { category: i.category, topic: i.topic, length: i.length, pro: o.pro || i.pro, pozn: clean(o.pozn, 600), pouceni: clean(o.pouceni, 400) },
  };
}

// jedno volání modelu; client = new Anthropic({ apiKey }) z @anthropic-ai/sdk
export async function generate(client, input) {
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    // když model žádost odmítne, API ji samo zopakuje na záložním modelu
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userPrompt(input) }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw Object.assign(new Error('Model zadání odmítl. Zkus zadání přeformulovat.'), { status: 422 });
  if (msg.stop_reason === 'max_tokens') throw Object.assign(new Error('Pohádka se nevešla do limitu odpovědi. Zkus kratší délku.'), { status: 502 });
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let out;
  try { out = JSON.parse(text); } catch (e) { throw Object.assign(new Error('Model vrátil neplatnou odpověď. Zkus to znovu.'), { status: 502 }); }
  const r = toStory(out, input);
  if (input.revise) {
    // při úpravě zůstává id, aby koncept v zásobníku neměnil jméno souboru obálky
    const m = /^[a-z0-9-]+$/.test(input.revise.id || '') ? input.revise.id : null;
    if (m) r.story.id = m;
  }
  const u = msg.usage || {};
  r.brief.model = msg.model;
  r.brief.usage = { input: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), output: u.output_tokens || 0 };
  return r;
}
