// ---------- Generátor pohádek a zásobník pohádek ----------
// Generátor: kategorie, o čem a délka → text pohádky píše Claude v Edge Function story-gen (supabase/functions/story-gen),
// klíč je jen v Secrets Supabase. V ukázkovém režimu (a lokálně bez klíče) se text nasimuluje přímo tady.
// Náhled dosazuje jména stejným kódem jako aplikace: část „Skloňování“ a ctx() se načte přímo z ../app/app.js
// (stejně jako tools/hlas/lib.mjs). Jména z náhledu zůstávají jen v tomhle prohlížeči, nikam se neposílají.
// Zásobník: koncepty v Supabase (story_drafts, funkce admin_story_draft_*), v ukázkovém režimu v localStorage.
// Publikovat = výroba obálky, hlasu a zvuku a pak zveřejnění v katalogu (stejně jako úprava v sekci Pohádky).
// Obálka a hlas se zatím vyrábějí lokálně nástroji z tools/ (viz kroky publikace), stránka jen hlídá, jestli jsou hotové.

const GCATS = CATS; // kategorie aplikace (bez „Vše“)
const LEN = { 5: '5 min', 10: '10 min', 15: '15 min' };
const STATUS = { koncept: ['Koncept', 'line'], vyroba: ['Ve výrobě', 'honey'], zverejneno: ['Zveřejněno', 'mint'], vyrazeno: ['Vyřazeno', 'line'] };
const STEPS = [
  ['obalka', 'Obálka', true],
  ['hlas', 'Namluvení společných vět', true],
  ['zvuk', 'Kulisa a hudba', false],
  ['zverejneni', 'Zveřejnění v aplikaci', true],
];
const SSTATE = { ceka: ['Čeká', 'peach'], hotovo: ['Hotovo', 'mint'], vynechano: ['Vynecháno', 'line'], bezi: ['Probíhá…', 'honey'] };
// Šablona se spouští jako kód. Odpověď modelu proto nesmí sahat na nic mimo kontext pohádky (stejná kontrola je v pohadka.js).
const UNSAFE = /\b(window|document|globalThis|self|top|parent|frames|opener|fetch|XMLHttpRequest|WebSocket|EventSource|localStorage|sessionStorage|indexedDB|caches|cookie|eval|Function|constructor|prototype|__proto__|import|require|location|navigator|setTimeout|setInterval|postMessage|Worker|alert)\b|\\u|\\x/;
const unsafe = (s) => UNSAFE.test(s.titleSrc) || UNSAFE.test(s.textSrc);

// ---------- Dosazování jako v aplikaci ----------
const ENGINE = (() => {
  let p = null;
  return () => (p = p || fetch('../app/app.js', { cache: 'no-cache' }).then((r) => {
    if (!r.ok) throw new Error('Nepodařilo se načíst app/app.js');
    return r.text();
  }).then((src) => {
    const a = src.indexOf('// ---------- Skloňování'), b = src.indexOf('const heroes = () =>');
    if (a < 0 || b < 0) throw new Error('V app/app.js se nenašla část se skloňováním a kontextem.');
    const S = { family: null };
    const e = new Function('S', 'listCz', 'cap', `"use strict";\n${src.slice(a, b)}\nreturn { decline, ROLES, inTownGuess, ctx, CASES };`)(S, listT, capT);
    return { ...e, S };
  }));
})();
let ENG = null;
ENGINE().then((e) => { ENG = e; if (['generator', 'zasobnik'].includes(route())) renderBench(); }).catch((e) => { ENG = { err: e.message }; });

// rodina pro náhled: jen v tomhle prohlížeči
const FKEY = 'ospalek.admin.genfam.v1';
const FAM_DEF = {
  kids: [{ name: 'Toník', g: 'm', age: 5, food: 'palačinky', animal: 'pejsek', hero: true, forms: null }, { name: 'Eliška', g: 'f', age: 3, food: 'jahody', animal: 'kočička', hero: false, forms: null }],
  p1: { role: 'mama', name: 'Petra' }, p2: { role: 'tata', name: '' },
  town: 'Benešov', inTown: '', near: 'Vlašim, Týnec nad Sázavou, Bystřice', attr: 'zámek Konopiště',
};
const GS = {
  form: { category: 'noc', topic: '', length: 5, pro: 'vse' },
  busy: false, err: '', noKey: false, cur: null, note: '', srcOpen: false,
  fam: store.get(FKEY) || structuredClone(FAM_DEF),
};
const splitList = (s) => String(s || '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);

function famFor(E, f) {
  return {
    children: f.kids.map((k, i) => ({ id: 'k' + i, forms: { ...E.decline(k.name, k.g), ...(k.forms || {}) }, gender: k.g, age: k.age, food: k.food, animal: k.animal })),
    parents: [f.p1, f.p2].filter((p) => p && p.role).map((p) => ({ role: p.role, name: p.name.trim(), forms: E.decline(p.name, E.ROLES[p.role].g) })),
    home: { town: f.town.trim(), inTown: f.inTown.trim() || E.inTownGuess(f.town), near: splitList(f.near), attr: splitList(f.attr) },
  };
}
// stejná rodina, jen osobní údaje nahrazené značkami ⟦…⟧ (jako tools/hlas/plan.mjs) – věta se značkou je osobní
function famMarked(E, f) {
  const mk = (n) => `⟦${n}⟧`;
  return {
    children: f.kids.map((k, i) => ({ id: 'k' + i, forms: E.decline(mk('dítě' + i), k.g), gender: k.g, age: k.age, food: mk('jídlo' + i), animal: mk('zvíře' + i) })),
    parents: [f.p1, f.p2].filter((p) => p && p.role).map((p) => ({ role: p.role, name: p.name.trim() ? mk('rodič') : '', forms: E.decline(p.name.trim() ? mk('rodič') : '', E.ROLES[p.role].g) })),
    home: { town: mk('obec'), inTown: mk('vObci'), near: splitList(f.near).map((_, i) => mk('o' + i)), attr: splitList(f.attr).map((_, i) => mk('v' + i)) },
  };
}
function renderFor(E, s, family, heroIdx) {
  E.S.family = family;
  const hs = heroIdx.map((i) => family.children[i]);
  const c = E.ctx(hs.length ? hs : family.children.slice(0, 1));
  const title = compile(s.titleSrc)(c), segs = compile(s.textSrc)(c);
  if (typeof title !== 'string') throw new Error('Název musí vrátit text.');
  if (!Array.isArray(segs) || !segs.length || segs.some((p) => !p || typeof p.t !== 'string')) throw new Error('Text musí vrátit pole odstavců { t: `…` }.');
  return { title, segs };
}
const heroIdx = (f) => { const h = f.kids.map((k, i) => (k.hero ? i : -1)).filter((i) => i >= 0).slice(0, 3); return h.length ? h : [0]; };
const splitT = (t) => (window.VOICE_LINES ? VOICE_LINES.splitLines(t) : t.split(/(?<=[.!?…])\s+/));
const words = (segs) => segs.reduce((a, p) => a + p.t.split(/\s+/).filter(Boolean).length, 0);

// ---------- Kontrola (jako tools/pohadky/over.mjs) ----------
const SFXS = ['sparkle', 'magic', 'car', 'horn', 'birds', 'owl', 'paper', 'wind', 'ding'];
const BAD = /undefined|null|NaN|\[object|\$\{|\s[,.]|\s{2,}|„\s|\s“|,,|\.\.(?!\.)/;
const TEST_FAMS = (() => {
  const kid = (name, g, food, animal) => ({ name, g, food, animal, age: 5, hero: false, forms: null });
  const K = { tonik: kid('Toník', 'm', 'palačinky', 'liška'), matej: kid('Matěj', 'm', 'špagety', 'tygr'), eliska: kid('Eliška', 'f', 'jahody', 'koník'), anicka: kid('Anička', 'f', 'knedlíky', 'kočička') };
  const A = { town: 'Benešov', inTown: 'v Benešově', near: 'Týnec nad Sázavou, Vlašim, Bystřice', attr: 'hrad Konopiště' };
  const B = { town: 'Ponětovice', inTown: 'v Ponětovicích', near: 'Šlapanice, Sokolnice, Telnice, Jiříkovice', attr: 'rozhledna Akátová věž, zámek Slavkov' };
  const O = { town: 'Lhota', inTown: 've Lhotě', near: '', attr: '' };
  const fam = (heroes, sib, p1, p2, home) => ({ f: { kids: [...heroes.map((k) => ({ ...k, hero: true })), ...(sib ? [sib] : [])], p1, p2, ...home }, h: heroes.map((_, i) => i) });
  return {
    kluk: fam([K.tonik], K.eliska, { role: 'mama', name: 'Petra' }, { role: 'tata', name: 'Honza' }, A),
    holka: fam([K.eliska], K.tonik, { role: 'tata', name: 'Honza' }, { role: 'mama', name: '' }, A),
    'holka B': fam([K.anicka], null, { role: 'mama', name: 'Lucie' }, null, B),
    'dvě děti': fam([K.tonik, K.eliska], null, { role: 'mama', name: 'Petra' }, { role: 'tata', name: 'Honza' }, A),
    'dvě holky': fam([K.eliska, K.anicka], K.matej, { role: 'mama', name: '' }, null, B),
    'babička, bez okolí': fam([K.matej], null, { role: 'babi', name: '' }, null, O),
  };
})();
function checkStory(E, s, len) {
  const err = [];
  if (unsafe(s)) return { err: ['Šablona obsahuje nepovolený kód (přístup mimo pohádku). Vygeneruj ji znovu.'], info: '' };
  let base = null;
  for (const [k, t] of Object.entries(TEST_FAMS)) {
    try {
      const r = renderFor(E, s, famFor(E, t.f), t.h);
      r.segs.forEach((p, i) => {
        if (!p.t.trim()) err.push(`${k}: prázdný odstavec ${i + 1}`);
        if (p.sfx && !SFXS.includes(p.sfx)) err.push(`${k}: neznámý zvuk ${p.sfx}`);
        const m = p.t.match(BAD); if (m) err.push(`${k}: odstavec ${i + 1}, podezřelé „${m[0]}“: …${p.t.slice(Math.max(0, m.index - 30), m.index + 30)}…`);
        if ((p.t.match(/„/g) || []).length !== (p.t.match(/“/g) || []).length) err.push(`${k}: odstavec ${i + 1} má nepárové uvozovky`);
      });
      if (BAD.test(r.title)) err.push(`${k}: název „${r.title}“`);
      if (!base) base = { r, t };
    } catch (e) { err.push(`${k}: ${e.message}`); }
  }
  let info = '';
  if (base) {
    const min = minutes(base.r.segs);
    if (len && Math.abs(min - len) > (len >= 10 ? 1 : 0)) err.push(`Délka vychází na ${min} min místo ${len} min.`);
    const mk = renderFor(E, s, famMarked(E, base.t.f), base.t.h);
    let all = 0, pers = 0;
    mk.segs.forEach((p) => splitT(p.t).forEach((l) => { all += l.length; if (/⟦/.test(l)) pers += l.length; }));
    const pp = Math.round((100 * pers) / Math.max(1, all));
    info = `${min} min · ${words(base.r.segs)} slov · ${base.r.segs.length} odstavců · osobní věty ${pp} % znaků`;
    if (pp > 35) err.push(`Osobní věty tvoří ${pp} % znaků (cíl do 25 %), namlouvání bude drahé.`);
  }
  return { err: [...new Set(err)].slice(0, 30), info };
}

// ---------- Simulace textu (ukázkový režim, lokálně bez klíče) ----------
function simulate(inp) {
  const topic = inp.topic.replace(/[`\\]|\$\{/g, '').replace(/[.!?\s]+$/, '');
  const open = [
    'Bylo nebylo, ${c.inTown} ${c.g(\'bydlel\', \'bydlela\', \'bydleli\')} ${c.H}. Ten večer byl úplně obyčejný, ale jen do chvíle, než se za oknem něco tiše zatřpytilo.',
    'Pohádka, kterou dnes uslyšíte, je o tomhle: ' + topic + '. A začíná, jak už to u pohádek bývá, jednoho klidného večera.',
  ];
  const mid = [
    { t: '${c.H} ${c.g(\'se rozhlédl\', \'se rozhlédla\', \'se rozhlédli\')} kolem sebe. Všechno bylo jako jindy, a přece trochu jinak. Stíny na zdi se natahovaly a vítr si za oknem broukal tichou písničku.', sfx: 'wind' },
    { t: 'Cestou potkali malou sovičku, která seděla na větvi a přemýšlela. „Na co myslíš?“ ${c.g(\'zeptal\', \'zeptala\', \'zeptali\')} se ${c.H}. „Na to, jak se dá všechno vyřešit trpělivostí,“ zahoukala sovička.', sfx: 'owl' },
    { t: 'Chvíli šli mlčky a poslouchali, jak pod nohama šustí listí. Každý krok zněl jako tiché ťuknutí na dveře, za kterými čeká další kousek dobrodružství.' },
    { t: '${cap(c.p1.full)} se ${c.p1.g(\'usmál\', \'usmála\')}: „Víš, co mi vždycky pomůže? Když se zastavím, nadechnu se a podívám se na věc z druhé strany.“' },
    { t: 'A tak se zastavili. Nadechli se. A najednou to bylo vidět: řešení bylo celou dobu blízko, jen bylo potřeba se dívat pozorně a v klidu.', sfx: 'sparkle' },
    { t: '${c.near.length ? `Z kopce bylo vidět celé okolí – ${listCz(c.near.slice(0, 3))}. V oknech se rozsvěcela malá světélka.` : \'Z kopce bylo vidět celé okolí. V oknech se rozsvěcela malá světélka.\'} Svět se pomalu chystal ke spánku.' },
    { t: 'Nebylo to vůbec jednoduché. Chvíli to nešlo, pak to šlo jen trochu, a pak zase vůbec. Ale kdo se nevzdá, ten se nakonec dočká, a tak zkoušeli dál, krůček po krůčku.' },
    { t: '„Já vím, co uděláme,“ ${c.g(\'řekl\', \'řekla\', \'řekli\')} ${c.H}. A protože ${c.n(\'měl\', \'měli\')} dobrý nápad, všichni hned věděli, že to tentokrát vyjde.', sfx: 'ding' },
    { t: 'Na svačinu bylo to nejlepší jídlo na světě: ${c.food}. Chutnalo ještě líp, protože se jedlo venku pod širým nebem a s dobrou náladou.' },
    { t: 'Kousek dál se ozvalo tiché zapípání a z trávy vykoukl malý zvědavý ježek. Prý ho celý den zajímalo, kam ti dobrodruzi tak spěchají.', sfx: 'birds' },
  ];
  const close = [
    'Když se vrátili domů, venku už byla tma a na obloze svítily hvězdy. ${c.H} ${c.g(\'zalezl\', \'zalezla\', \'zalezli\')} pod peřinu a ${c.g(\'zavřel\', \'zavřela\', \'zavřeli\')} oči.',
    'Víčka byla těžká a hlava plná krásných obrázků z celého dne. Dobrou noc, ${c.h.voc}.',
  ];
  const target = { 5: 300, 10: 600, 15: 900 }[inp.length];
  const paras = open.map((t) => ({ t }));
  const sec = () => paras.reduce((a, p) => a + p.t.split(/\s+/).length / 2 + 1, 0);
  for (let i = 0; sec() + 30 < target; i++) paras.push({ ...mid[i % mid.length] });
  close.forEach((t) => paras.push({ t }));
  const slug = topic.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').filter((w) => w.length > 2).slice(0, 3).join('-') || 'nova-pohadka';
  const q2 = (t) => t.replace(/\\/g, '\\\\');
  return {
    story: {
      id: slug, free: false, cats: [inp.category], ages: [3, 7], mood: inp.category === 'auto' ? 'road' : inp.category === 'dobro' ? 'adventure' : 'lullaby',
      cover: { img: '', imgF: '', emoji: '🌙', g1: '#1d2b64', g2: '#6a4c93' },
      titleSrc: "(c) => c.n(`${c.H} a večerní dobrodružství`, `Večerní dobrodružství ${c.h.gen}`)",
      textSrc: '(c) => [\n' + paras.map((p) => `      { t: \`${q2(p.t)}\`${p.sfx ? `, sfx: '${p.sfx}'` : ''} },`).join('\n') + '\n    ]',
    },
    brief: { category: inp.category, topic: inp.topic, length: inp.length, pro: inp.pro, pozn: 'Simulovaný text, nenapsal ho model.', pouceni: '', model: 'simulace' },
  };
}

// ---------- Volání generátoru ----------
async function generateStory(inp, revise) {
  const avoid = STORIES.map((s) => `${s.id} – ${safeTitle(s)}`);
  const body = { ...inp, avoid, ...(revise ? { revise } : {}) };
  if (!D.live) { await new Promise((r) => setTimeout(r, 900)); return { ...simulate(inp), simulated: true }; }
  const out = await LIVE.fn('story-gen', body);
  if (!out || !out.story) throw new Error('Generátor vrátil prázdnou odpověď.');
  return out;
}
async function runGen(revise) {
  const f = GS.form;
  if (!f.topic.trim() && !revise) { GS.err = 'Napiš, o čem má pohádka být.'; render(); return; }
  GS.busy = true; GS.err = ''; GS.noKey = false; render();
  try {
    const out = await generateStory({ category: f.category, topic: f.topic.trim() || GS.cur?.brief.topic || '', length: f.length, pro: f.pro }, revise);
    if (unsafe(out.story)) throw new Error('Odpověď obsahuje nepovolený kód. Vygeneruj ji znovu.');
    if (revise && GS.cur) out.story.id = GS.cur.story.id;
    GS.cur = { story: out.story, brief: out.brief, simulated: !!out.simulated, draftId: null };
    GS.note = '';
  } catch (e) {
    GS.noKey = e.code === 'no_key' || e.status === 503;
    GS.err = e.message;
  }
  GS.busy = false; render();
}

// ---------- Zásobník: data ----------
const DKEY = 'ospalek.admin.drafts.v1';
const DR = {
  list: null, err: '', busy: false,
  async load() {
    try {
      DR.list = D.live ? await LIVE.rpc('admin_story_drafts') : store.get(DKEY) || [];
      DR.err = '';
    } catch (e) { DR.err = 'Zásobník se nepodařilo načíst: ' + e.message; DR.list = DR.list || []; }
    if (['zasobnik', 'generator'].includes(route())) render();
  },
  async save(d) {
    const row = { id: d.id || null, story: d.story, brief: d.brief || {}, status: d.status || 'koncept', steps: d.steps || {}, catalog_version: d.catalog_version ?? null };
    if (D.live) {
      const r = await LIVE.rpc('admin_story_draft_save', d.id ? { d: row, base: d.updated_at } : { d: row });
      Object.assign(d, { id: r.id, updated_at: r.updated_at, status: r.status });
    } else {
      const list = store.get(DKEY) || [];
      const now = new Date().toISOString();
      if (!d.id) Object.assign(d, { id: 'd' + Date.now().toString(36), created_at: now, created_by: API.me?.name || 'Ty' });
      Object.assign(d, { updated_at: now, updated_by: API.me?.name || 'Ty' });
      const i = list.findIndex((x) => x.id === d.id);
      const clean = JSON.parse(JSON.stringify({ ...d, dirty: undefined }));
      if (i >= 0) list[i] = clean; else list.unshift(clean);
      store.set(DKEY, list);
    }
    if (DR.list) { const i = DR.list.findIndex((x) => x.id === d.id); if (i >= 0) DR.list[i] = d; else DR.list.unshift(d); }
    return d;
  },
  async del(id) {
    if (D.live) await LIVE.rpc('admin_story_draft_delete', { draft: id });
    else store.set(DKEY, (store.get(DKEY) || []).filter((x) => x.id !== id));
    DR.list = (DR.list || []).filter((x) => x.id !== id);
  },
};
const canEdit = () => API.can('content.edit') && (!D.live || ['owner', 'content'].includes(D.me?.role));
const draftOf = (id) => (DR.list || []).find((x) => x.id === id);
const stepOf = (d, k) => (d.steps && d.steps[k]) || { stav: 'ceka' };
const titleOf = (s) => safeTitle(s);

// ---------- Kroky publikace ----------
const head404 = (url) => fetch(url, { method: 'HEAD', cache: 'no-store' }).then((r) => r.ok).catch(() => false);
let VOICE_INDEX = null, BG_INDEX = null;
const voiceIndex = () => (VOICE_INDEX = VOICE_INDEX || fetch('../audio/hlas/jana/index.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : { clips: {} })).catch(() => ({ clips: {} })));
const bgIndex = () => (BG_INDEX = BG_INDEX || fetch('../audio/pozadi/index.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : { clips: {} })).catch(() => ({ clips: {} })));

// společné věty pohádky ve všech tvarech (stejné varianty jako tools/hlas/plan.mjs spolecne)
function sharedKeys(E, s) {
  const keys = new Set();
  const mk = (n) => `⟦${n}⟧`;
  const kid = (n, g) => ({ forms: E.decline(mk(n), g), gender: g, food: mk('jídlo' + n), animal: mk('zvíře' + n) });
  const par = (role, named) => ({ role, name: named ? mk('rodič') : '', forms: E.decline(named ? mk('rodič') : '', role === 'mama' || role === 'babi' ? 'f' : 'm') });
  for (const heroes of [['m'], ['f'], ['m', 'f'], ['f', 'f']])
    for (const sib of [null, 'm', 'f'])
      for (const p1 of ['mama', 'tata', 'babi', 'deda'])
        for (const named of [false, true])
          for (const p2 of [null, 'mama', 'tata'])
            for (const home of [false, true]) {
              const children = heroes.map((g, i) => kid('dítě' + i, g));
              if (sib) children.push(kid('sourozenec', sib));
              const family = { children, parents: [par(p1, named), ...(p2 ? [par(p2, false)] : [])], home: home ? { town: mk('obec'), inTown: mk('vObci'), near: [mk('o1'), mk('o2'), mk('o3')], attr: [mk('výlet')] } : { town: '', inTown: '', near: [], attr: [] } };
              renderFor(E, s, family, heroes.map((_, i) => i)).segs.forEach((p) => splitT(p.t).forEach((l) => { if (!/⟦/.test(l)) keys.add(VOICE_LINES.lineKey(l)); }));
            }
  return [...keys];
}

const now = () => new Date().toISOString();
async function checkSteps(d) {
  const s = d.story, st = { ...d.steps };
  const keep = (k, v) => { st[k] = ['vynechano'].includes(st[k]?.stav) ? st[k] : { ...v, at: now() }; };
  // obálka: soubor v covers/ (na webu vedle administrace)
  const hasM = await head404(`../covers/${s.id}.jpg`), hasF = hasM && (await head404(`../covers/${s.id}-f.jpg`));
  if (hasM) { s.cover.img = `../covers/${s.id}.jpg`; s.cover.imgF = hasF ? `../covers/${s.id}-f.jpg` : ''; }
  keep('obalka', hasM ? { stav: 'hotovo', pozn: `covers/${s.id}.jpg${hasF ? ` a ${s.id}-f.jpg` : ''}` } : { stav: 'ceka', pozn: `Čeká na obálku covers/${s.id}.jpg (JPG 573×768). Generování obrázků v administraci zatím není napojené.` });
  // hlas: společné věty v audio/hlas/jana
  const E = ENG && !ENG.err ? ENG : await ENGINE();
  const keys = sharedKeys(E, s), clips = (await voiceIndex()).clips || {};
  const have = keys.filter((k) => clips[k]).length;
  keep('hlas', have === keys.length ? { stav: 'hotovo', pozn: `${keys.length} společných vět namluveno` } : { stav: 'ceka', pozn: `Čeká na namluvení: hotovo ${have} z ${keys.length} společných vět.` });
  // zvuk: vlastní nebo půjčená smyčka v audio/pozadi/index.json (volitelné)
  const bg = ((await bgIndex()).clips || {})[s.id];
  keep('zvuk', bg ? { stav: 'hotovo', pozn: 'Kulisa a hudba jsou v audio/pozadi.' } : { stav: 'ceka', pozn: `Bez vlastní smyčky hraje hudba podle nálady (${MOODS[s.mood] || s.mood}). Nepovinné.` });
  d.steps = st;
}
const ready = (d) => STEPS.filter(([k, , req]) => req && k !== 'zverejneni').every(([k]) => ['hotovo', 'vynechano'].includes(stepOf(d, k).stav));

async function publishDraft(d) {
  if (!PUB.loaded) await PUB.load();
  const s = structuredClone(d.story);
  const other = STORIES.find((x) => x.id === s.id);
  if (other) throw new Error(`Pohádka s id „${s.id}“ už v aplikaci je. Změň id konceptu.`);
  s.titleSrc = s.titleSrc.trim(); s.textSrc = s.textSrc.trim();
  STORIES.push(s);
  DELETED = DELETED.filter((x) => x !== s.id);
  if (PUB.on) {
    await PUB.publish(`Ze zásobníku: ${s.id}`);
    if (PUB.err) { STORIES = STORIES.filter((x) => x !== s); throw new Error(PUB.err); }
  } else saveStories();
  d.steps = { ...d.steps, zverejneni: { stav: 'hotovo', pozn: PUB.on ? `Katalog verze ${PUB.version}` : 'Ukázkový režim: přidáno do pohádek v tomhle prohlížeči.', at: now() } };
  d.status = 'zverejneno';
  d.catalog_version = PUB.on ? PUB.version : null;
}

// Publikovat / Zkontrolovat znovu: zjistí stav kroků a když je vše hotové, zveřejní
async function advance(d, msg) {
  if (!canEdit()) { toast('Publikovat smí jen role Vlastník nebo Obsah'); return; }
  const bad = ENG && !ENG.err ? checkStory(ENG, d.story, d.brief?.length).err.filter((e) => !/^Délka|^Osobní/.test(e)) : [];
  if (bad.length) { toast('Šablona má chyby, oprav je před publikací'); return; }
  DR.busy = true; render();
  try {
    if (d.status === 'koncept') d.status = 'vyroba';
    await checkSteps(d);
    if (ready(d)) await publishDraft(d);
    await DR.save(d);
    toast(d.status === 'zverejneno' ? 'Zveřejněno v aplikaci' : msg || 'Publikace běží, čeká na další kroky');
  } catch (e) {
    toast(e.message);
    DR.err = e.message;
  }
  DR.busy = false; render();
}

// ---------- Stažení konceptu pro tools/pohadky ----------
function draftFile(d) {
  const s = d.story, b = d.brief || {}, q = (v) => `'${String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  return `// Koncept ze zásobníku administrace (${fdate(new Date())}): ${titleOf(s)}
// Ulož jako koncepty/pohadky/${s.id}.js, zkontroluj (node tools/pohadky/over.mjs koncepty/pohadky/${s.id}.js)
// a přenes do aplikace: node tools/pohadky/prenest.mjs ${s.id}
window.STORIES_DRAFT = (window.STORIES_DRAFT || []).concat([
  {
    id: ${q(s.id)},
    delka: ${[5, 10, 15].includes(Number(b.length)) ? Number(b.length) : 5},
    pro: ${q(b.pro || 'vse')},
    pozn: ${q(b.pozn || b.topic || '')},
    pouceni: ${q(b.pouceni || '')},
    free: false,
    cats: [${s.cats.map(q).join(', ')}],
    ages: [${s.ages[0]}, ${s.ages[1]}],
    mood: ${q(s.mood)},
    cover: { emoji: ${q(s.cover.emoji)}, g1: ${q(s.cover.g1)}, g2: ${q(s.cover.g2)} },
    title: ${s.titleSrc.trim()},
    text: ${s.textSrc.trim()},
  },
]);
`;
}

// ---------- Pracovní plocha: náhled se jmény, šablona a kontrola ----------
// BENCH = co se právě zobrazuje: { story, brief, readonly }
let BENCH = null;
function benchHtml(b, opts = {}) {
  BENCH = b;
  const f = GS.fam;
  const kidRow = (k, i) => `
    <div class="gkid">
      <div class="fields3">
        <div><label>Jméno ${i + 1}. dítěte</label><input data-fam="k${i}.name" value="${esc(k.name)}" autocomplete="off"></div>
        <div><label>Kluk / holka</label><select data-fam="k${i}.g"><option value="m" ${k.g === 'm' ? 'selected' : ''}>kluk</option><option value="f" ${k.g === 'f' ? 'selected' : ''}>holka</option></select></div>
        <div><label>Věk</label><input type="number" min="1" max="12" data-fam="k${i}.age" value="${esc(k.age)}"></div>
        <div><label>Oblíbené jídlo</label><input data-fam="k${i}.food" value="${esc(k.food)}"></div>
        <div><label>Oblíbené zvíře</label><input data-fam="k${i}.animal" value="${esc(k.animal)}"></div>
        <div><label>&nbsp;</label><label class="check"><input type="checkbox" data-fam="k${i}.hero" ${k.hero ? 'checked' : ''}> Je v pohádce hrdina</label></div>
      </div>
      <details class="gforms"><summary>Tvary jména${k.forms ? ' (upravené)' : ''}</summary><div class="fields3" id="gForms${i}"></div></details>
      ${f.kids.length > 1 ? `<button class="linkbtn" data-a="gKidDel" data-v="${i}">Odebrat dítě</button>` : ''}
    </div>`;
  const parentSel = (key, p, allowNone) => `<select data-fam="${key}.role">${allowNone ? `<option value="" ${!p?.role ? 'selected' : ''}>nikdo</option>` : ''}${[['mama', 'maminka'], ['tata', 'tatínek'], ['babi', 'babička'], ['deda', 'dědeček']].map(([v, l]) => `<option value="${v}" ${p?.role === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  return `
    <div class="grid2 gbench">
      <section class="panel">
        <div class="panel-head"><h2>Rodina pro náhled</h2><button class="btn white sm" data-a="gFamReset">Výchozí rodina</button></div>
        <p class="hint" style="margin-top:-6px">Text se dosadí stejně jako v aplikaci. Údaje zůstávají jen v tomhle prohlížeči.</p>
        ${f.kids.map(kidRow).join('')}
        ${f.kids.length < 3 ? `<button class="btn white sm" data-a="gKidAdd" style="margin-top:8px">${I.plus}Přidat dítě</button>` : ''}
        <div class="fields2">
          <div><label>Kdo poslouchá (1. blízký)</label>${parentSel('p1', f.p1, false)}</div>
          <div><label>Jméno</label><input data-fam="p1.name" value="${esc(f.p1.name)}" placeholder="bez jména"></div>
          <div><label>2. blízký</label>${parentSel('p2', f.p2, true)}</div>
          <div><label>Jméno</label><input data-fam="p2.name" value="${esc(f.p2?.name || '')}" placeholder="bez jména"></div>
          <div><label>Obec</label><input data-fam="town" value="${esc(f.town)}"></div>
          <div><label>Kde bydlí (6. pád)</label><input data-fam="inTown" value="${esc(f.inTown)}" id="gInTown" placeholder="dopočítá se"></div>
        </div>
        <label>Okolní obce (oddělené čárkou)</label><input data-fam="near" value="${esc(f.near)}" placeholder="prázdné = rodina bez okolí">
        <label>Výlety v okolí (oddělené čárkou)</label><input data-fam="attr" value="${esc(f.attr)}">
      </section>
      <div><div class="preview" id="gPrev"><p class="muted">Načítám náhled…</p></div></div>
    </div>
    <section class="panel">
      <div class="panel-head"><h2>Kontrola</h2><span class="hint" id="gInfo"></span></div>
      <div id="gCheck"><p class="muted">…</p></div>
    </section>
    <section class="panel">
      <details ${GS.srcOpen ? 'open' : ''} id="gSrc"><summary class="gsum">Šablona pohádky (zdrojový kód)${b.readonly ? '' : ' · úpravy se hned projeví v náhledu'}</summary>
        <p class="hint">Stejný tvar jako v app/stories.cs.js: \${c.H} jméno, c.g('šel', 'šla', 'šli') tvar podle rodu, c.n(…) podle počtu, c.p1, c.inTown, c.near, c.food…</p>
        <label for="gTitle">Název</label><input id="gTitle" data-g="titleSrc" value="${esc(b.story.titleSrc)}" spellcheck="false" ${b.readonly ? 'readonly' : ''}>
        <label for="gText">Text</label><textarea id="gText" data-g="textSrc" rows="18" spellcheck="false" ${b.readonly ? 'readonly' : ''}>${esc(b.story.textSrc)}</textarea>
      </details>
    </section>
    ${opts.after || ''}`;
}
function renderBench() {
  const el = $('#gPrev'); if (!el || !BENCH) return;
  if (!ENG) { el.innerHTML = '<p class="muted">Načítám skloňování z aplikace…</p>'; return; }
  if (ENG.err) { el.innerHTML = `<p class="err">${esc(ENG.err)}</p>`; return; }
  const f = GS.fam, s = BENCH.story;
  // tvary jmen: předvyplněné podle aplikace, ruční úprava je přepíše
  f.kids.forEach((k, i) => {
    const box = $('#gForms' + i); if (!box || box.dataset.ok === k.name + k.g + JSON.stringify(k.forms)) return;
    const auto = ENG.decline(k.name, k.g);
    box.innerHTML = ENG.CASES.slice(1).map(([c, l]) => `<div><label>${esc(l)}</label><input data-fam="k${i}.forms.${c}" value="${esc((k.forms && k.forms[c]) || auto[c])}"></div>`).join('');
    box.dataset.ok = k.name + k.g + JSON.stringify(k.forms);
  });
  const it = $('#gInTown'); if (it) it.placeholder = ENG.inTownGuess(f.town) || 'dopočítá se';
  let body;
  if (unsafe(s)) body = '<p class="err">Šablona obsahuje nepovolený kód, náhled se nespustí.</p>';
  else {
    try {
      const hi = heroIdx(f);
      const r = renderFor(ENG, s, famFor(ENG, f), hi);
      const m = renderFor(ENG, s, famMarked(ENG, f), hi);
      const coverCv = `<div class="cv" style="--g1:${esc(s.cover.g1)};--g2:${esc(s.cover.g2)}">${esc(s.cover.emoji)}${s.cover.img ? `<img src="${esc(s.cover.img)}" alt="" onerror="this.remove()">` : ''}</div>`;
      body = `<div class="covers one" style="max-width:120px">${coverCv}</div><h3>${esc(r.title)}</h3>
        <p class="muted" style="font-size:13px;margin-bottom:10px">${r.segs.length} odstavců · ${words(r.segs)} slov · asi ${minutes(r.segs)} min · <span class="gpers">zvýrazněné</span> věty se namlouvají pro každou rodinu</p>
        <div class="txt">${r.segs.map((p, i) => {
          const ls = splitT(p.t), ms = splitT(m.segs[i]?.t || '');
          const html = ls.length === ms.length ? ls.map((l, j) => (/⟦/.test(ms[j]) ? `<span class="gpers">${esc(l)}</span>` : esc(l))).join(' ') : esc(p.t);
          return `<p>${html}${p.sfx ? ` <span class="sfx">♪ ${esc(p.sfx)}</span>` : ''}${p.pause ? ` <span class="sfx">⏸ ${p.pause} s</span>` : ''}</p>`;
        }).join('')}</div>`;
    } catch (e) { body = `<p class="err">Šablona má chybu: ${esc(e.message)}</p>`; }
  }
  el.innerHTML = `<div class="panel-head" style="margin-bottom:6px"><h2 style="font-size:15px">Jak to uslyší rodina</h2></div>${body}`;
  const ch = checkStory(ENG, s, BENCH.brief?.length);
  BENCH.check = ch;
  const ci = $('#gInfo'); if (ci) ci.textContent = ch.info;
  const cc = $('#gCheck');
  if (cc) cc.innerHTML = ch.err.length
    ? `<p class="err" style="margin-top:0">Kontrola pro testovací rodiny (kluk, holka, dvě děti, dvě holky, babička bez okolí) našla ${ch.err.length} ${plural(ch.err.length, 'problém', 'problémy', 'problémů')}:</p><ul class="gerr">${ch.err.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
       ${BENCH.fix ? `<button class="btn white sm" data-a="${BENCH.fix}" ${GS.busy ? 'disabled' : ''}>${I.wand}Nechat opravit generátorem</button>` : ''}`
    : '<p style="margin:0">✓ Šablona funguje pro kluka, holku, dvě děti, dvě holky i rodinu bez okolí a druhého rodiče. Gramatiku si ale přečti.</p>';
}

function famInput(t) {
  const f = GS.fam, [a, b, c] = t.dataset.fam.split('.');
  const v = t.type === 'checkbox' ? t.checked : t.type === 'number' ? Number(t.value) : t.value;
  if (/^k\d$/.test(a)) {
    const k = f.kids[Number(a.slice(1))];
    if (b === 'forms') { k.forms = { ...(k.forms || {}), [c]: v }; } else { k[b] = v; if (b === 'name' || b === 'g') k.forms = null; }
  } else if (a === 'p1' || a === 'p2') {
    if (b === 'role' && !v) f[a] = { role: '', name: '' }; else f[a] = { ...(f[a] || { name: '' }), [b]: v };
  } else f[a] = v;
  store.set(FKEY, f);
  renderBench();
}
let srcT;
function srcInput(t) {
  if (!BENCH || BENCH.readonly) return;
  BENCH.story[t.dataset.g] = t.value;
  BENCH.dirty = true;
  if (DED && BENCH.story === DED.d.story) DED.dirty = true;
  const sv = $('#dSave'); if (sv) sv.disabled = false;
  clearTimeout(srcT); srcT = setTimeout(renderBench, 250);
}

// ---------- Stránka Generátor ----------
function pageGenerator() {
  const f = GS.form, c = GS.cur;
  if (!DR.list && !DR.busy) { DR.busy = true; DR.load().finally(() => { DR.busy = false; }); }
  const can = canEdit();
  const chip = (v, l) => `<button class="chip ${f.category === v ? 'on' : ''}" data-a="gCat" data-v="${v}">${catIco(v)}${l}</button>`;
  const seg = (k, opts) => `<div class="seg">${opts.map(([v, l]) => `<button data-a="gSet" data-k="${k}" data-v="${v}" class="${String(f[k]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  if (c) after.push(renderBench);
  return `
    ${head('Generátor pohádek', D.live ? 'Text píše Claude na serveru (Supabase Edge Function story-gen). Zatím jen text, obrázek a hlas přijdou při publikaci.' : 'Ukázkový režim: text se nasimuluje v prohlížeči. V ostrém režimu ho píše Claude na serveru.', `<a class="btn white" href="#zasobnik">${I.list}Zásobník${DR.list ? ` (${DR.list.filter((d) => d.status !== 'zverejneno' && d.status !== 'vyrazeno').length})` : ''}</a>`)}
    ${!can ? `<div class="locked-note">${I.shield}<span>Generovat a ukládat pohádky smí role Vlastník a Obsah.</span></div>` : ''}
    <section class="panel">
      <div class="panel-head"><h2>Zadání</h2></div>
      <label>Kategorie</label>
      <div class="chips">${GCATS.map((x) => chip(x.id, x.label)).join('')}</div>
      <label for="gTopic">O čem má pohádka být</label>
      <textarea id="gTopic" data-gf="topic" rows="3" style="font-family:var(--body);font-size:14px" placeholder="Např. o ježkovi, který se bál tmy, a jak mu děti ukázaly, že noc je plná kamarádů">${esc(f.topic)}</textarea>
      <div class="gopts">
        <div><label>Délka</label>${seg('length', [[5, '5 min'], [10, '10 min'], [15, '15 min']])}</div>
        <div><label>Tématem spíš pro</label>${seg('pro', [['vse', 'všechny'], ['f', 'holky'], ['m', 'kluky']])}</div>
      </div>
      <div class="head-actions" style="margin-top:16px">
        <button class="btn" data-a="gGen" ${GS.busy || !can ? 'disabled' : ''}>${I.wand}${GS.busy ? 'Píšu pohádku… (obvykle 1–2 minuty)' : c ? 'Vygenerovat novou' : 'Vygenerovat pohádku'}</button>
        ${GS.noKey ? `<button class="btn white" data-a="gSim" ${GS.busy ? 'disabled' : ''}>Nasimulovat text</button>` : ''}
      </div>
      ${GS.err ? `<p class="err">${esc(GS.err)}</p>${GS.noKey ? '<p class="hint">Klíč patří do Supabase → Edge Functions → Secrets jako ANTHROPIC_API_KEY (návod v supabase/README.md). Do té doby jde text nasimulovat, ať se dá vyzkoušet zbytek.</p>' : ''}` : ''}
    </section>
    ${c ? `
    <section class="panel">
      <div class="panel-head">
        <div><h2>${c.simulated ? '<span class="tag honey">Simulace</span> ' : ''}Vygenerovaná pohádka</h2>
          <p class="muted" style="font-size:13px;margin-top:4px">${esc(catLabel(c.story.cats[0]))} · ${LEN[c.brief.length] || ''} · id ${esc(c.story.id)}${c.brief.model ? ` · ${esc(c.brief.model)}` : ''}${c.brief.usage ? ` · ${fmt(c.brief.usage.input)} + ${fmt(c.brief.usage.output)} tokenů` : ''}</p>
          ${c.brief.pozn ? `<p style="font-size:14px;margin-top:6px">${esc(c.brief.pozn)}${c.brief.pouceni ? ` <span class="muted">Poučení: ${esc(c.brief.pouceni)}</span>` : ''}</p>` : ''}</div>
        <div class="head-actions">
          ${c.draftId ? `<a class="btn white" href="#zasobnik/${esc(c.draftId)}">Otevřít v zásobníku</a>` : `<button class="btn" data-a="gSave" ${!can ? 'disabled' : ''}>Uložit do zásobníku</button>`}
        </div>
      </div>
      <div class="grevise">
        <input data-gf="note" value="${esc(GS.note)}" placeholder="Co upravit? Např. ať je konec klidnější a sovička má jméno" ${GS.busy ? 'disabled' : ''}>
        <button class="btn white" data-a="gRevise" ${GS.busy || !can ? 'disabled' : ''}>${I.wand}Upravit podle poznámky</button>
      </div>
    </section>
    ${benchHtml({ story: c.story, brief: c.brief, fix: 'gFix' })}` : ''}`;
}

// ---------- Stránka Zásobník ----------
const ZF = { status: 'aktivni' };
function draftCard(d) {
  const s = d.story, [sl, sc] = STATUS[d.status] || STATUS.koncept;
  const waits = d.status === 'vyroba' ? STEPS.filter(([k, , req]) => req && stepOf(d, k).stav === 'ceka').map(([, l]) => l.toLowerCase()) : [];
  return `<a class="panel story gdraft" href="#zasobnik/${esc(d.id)}">
    <div class="covers one"><div class="cv" style="--g1:${esc(s.cover.g1)};--g2:${esc(s.cover.g2)}">${esc(s.cover.emoji)}${s.cover.img ? `<img src="${esc(s.cover.img)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</div></div>
    <h3>${esc(titleOf(s))}</h3>
    <div class="tags"><span class="tag ${sc}">${sl}</span>${s.cats.slice(0, 1).map((c) => `<span class="tag">${catIco(c)}${esc(catLabel(c))}</span>`).join('')}${d.brief?.length ? `<span class="tag line">${LEN[d.brief.length]}</span>` : ''}${d.brief?.model === 'simulace' ? '<span class="tag honey">Simulace</span>' : ''}</div>
    ${waits.length ? `<p class="hint" style="margin:-4px 6px 8px">Čeká na: ${esc(waits.join(', '))}</p>` : ''}
    <p class="hint" style="margin:auto 6px 0">${d.updated_at ? ago(new Date(d.updated_at)) : ''}${d.updated_by ? ` · ${esc(d.updated_by)}` : ''}</p>
  </a>`;
}
function pageDrafts() {
  if (!DR.list) { if (!DR.busy) { DR.busy = true; DR.load().finally(() => { DR.busy = false; }); } return `${head('Zásobník pohádek')}<p class="muted">Načítám zásobník…</p>`; }
  const id = routeParam();
  if (id) return pageDraft(id);
  const by = { aktivni: (d) => d.status === 'koncept' || d.status === 'vyroba', koncept: (d) => d.status === 'koncept', vyroba: (d) => d.status === 'vyroba', zverejneno: (d) => d.status === 'zverejneno', vyrazeno: (d) => d.status === 'vyrazeno', vse: () => true };
  const list = DR.list.filter(by[ZF.status]);
  const n = (k) => DR.list.filter(by[k]).length;
  return `
    ${head('Zásobník pohádek', `${DR.list.length} ${plural(DR.list.length, 'koncept', 'koncepty', 'konceptů')} · ${D.live ? 'uložené v Supabase' : 'ukázkový režim: jen v tomhle prohlížeči'}`, `<a class="btn" href="#generator">${I.wand}Nová pohádka z generátoru</a>`)}
    ${DR.err ? `<p class="err">${esc(DR.err)} <button class="linkbtn" data-a="dReload">Načíst znovu</button></p>` : ''}
    <div class="filters"><div class="seg">${[['aktivni', 'Rozpracované'], ['koncept', 'Koncepty'], ['vyroba', 'Ve výrobě'], ['zverejneno', 'Zveřejněné'], ['vyrazeno', 'Vyřazené'], ['vse', 'Vše']].map(([v, l]) => `<button data-a="dFilter" data-v="${v}" class="${ZF.status === v ? 'on' : ''}">${l} ${n(v)}</button>`).join('')}</div></div>
    <div class="stories">${list.map(draftCard).join('') || `<div class="empty"><img src="../brand/maskot-3d/web/ospalek-spi.webp" alt="">Tady zatím nic není. Pohádku vygeneruj v <a class="link" href="#generator">generátoru</a> a ulož ji do zásobníku.</div>`}</div>`;
}

let DED = null; // rozpracovaný koncept v detailu: { id, d (kopie) }
function pageDraft(id) {
  const orig = draftOf(id);
  if (!orig) return `${head('Zásobník pohádek')}<div class="empty">Koncept nenalezen. <a class="link" href="#zasobnik">Zpět do zásobníku</a></div>`;
  if (!DED || DED.id !== id) DED = { id, d: structuredClone(orig), dirty: false };
  const d = DED.d, s = d.story, can = canEdit(), ro = !can || d.status === 'zverejneno';
  const [sl, sc] = STATUS[d.status] || STATUS.koncept;
  after.push(renderBench);
  const stepHtml = ([k, l, req]) => {
    const st = stepOf(d, k), [tl, tc] = SSTATE[DR.busy && d.status === 'vyroba' && st.stav === 'ceka' ? 'bezi' : st.stav] || SSTATE.ceka;
    let extra = '';
    if (st.stav === 'ceka' && d.status === 'vyroba') {
      if (k === 'obalka') extra = `<div class="head-actions"><button class="btn white sm" data-a="dCover">${I.wand}Zadání obálky</button>${can ? '<button class="linkbtn" data-a="dSkip" data-v="obalka">Zveřejnit bez obálky (jen emoji)</button>' : ''}</div>`;
      if (k === 'hlas') extra = `<details class="gcmd"><summary>Jak namluvit (tools/hlas)</summary><pre>${esc(voiceCmds(s.id))}</pre></details>${can ? '<button class="linkbtn" data-a="dSkip" data-v="hlas">Zveřejnit bez předem namluvených vět</button><p class="hint">Bez nich aplikace přečte chybějící věty přes tts-worker při prvním poslechu (ElevenLabs, platí se tehdy, nefunguje bez internetu).</p>' : ''}`;
      if (k === 'zvuk') extra = '<p class="hint">Smyčku jde půjčit od podobné pohádky v tools/pozadi/sdilene.json nebo vyrobit (tools/pozadi/README.md).</p>';
    }
    return `<li class="gstep"><span class="tag ${tc}">${tl}</span><div><b>${l}</b>${req ? '' : ' <span class="muted">(nepovinné)</span>'}${st.pozn ? `<div class="hint">${esc(st.pozn)}</div>` : ''}${extra}</div></li>`;
  };
  const pubPanel = d.status === 'koncept'
    ? `<p>Publikace zjistí stav obálky, namluvení a zvuku. Co je hotové, odškrtne. Až bude hotová obálka i hlas (nebo je vynecháš), pohádka se sama zveřejní v aplikaci.</p>
       <div class="head-actions" style="margin-top:10px"><button class="btn" data-a="dPublish" ${!can || DR.busy || DED.dirty ? 'disabled' : ''}>${DR.busy ? 'Zjišťuji…' : 'Publikovat'}</button>${DED.dirty ? '<span class="hint">Nejdřív ulož změny.</span>' : ''}</div>`
    : d.status === 'vyroba'
      ? `<ul class="gsteps">${STEPS.map(stepHtml).join('')}</ul>
         <div class="head-actions" style="margin-top:12px"><button class="btn" data-a="dPublish" ${!can || DR.busy || DED.dirty ? 'disabled' : ''}>${DR.busy ? 'Zjišťuji…' : 'Zkontrolovat a zveřejnit'}</button>
         ${!D.live && can ? '<button class="btn white" data-a="dSimulate">Nasimulovat výrobu</button>' : ''}
         <button class="btn white" data-a="dDownload">${I.down}Stáhnout koncept pro tools/pohadky</button></div>`
      : d.status === 'zverejneno'
        ? `<ul class="gsteps">${STEPS.map(stepHtml).join('')}</ul><p style="margin-top:10px">Pohádka je v aplikaci. Další úpravy dělej v sekci <a class="link" href="#pohadky">Pohádky</a>.</p>`
        : '<p class="muted">Koncept je vyřazený.</p>';
  const metaChip = (c) => `<button type="button" class="chip ${s.cats.includes(c.id) ? 'on' : ''}" data-a="dCatT" data-v="${c.id}" ${ro ? 'disabled' : ''}>${catIco(c.id)}${c.label}</button>`;
  return `
    ${head(esc(titleOf(s)), `<span class="tag ${sc}">${sl}</span> · ${esc(s.id)} · ${d.updated_at ? `upraveno ${ago(new Date(d.updated_at))}${d.updated_by ? ` (${esc(d.updated_by)})` : ''}` : ''}`,
      `<a class="btn white" href="#zasobnik">${I.back}Zásobník</a>${!ro ? `<button class="btn" id="dSave" data-a="dSave" ${DED.dirty || BENCH?.dirty ? '' : 'disabled'}>Uložit změny</button>` : ''}`)}
    <div class="grid2">
      <section class="panel"><div class="panel-head"><h2>Publikace</h2></div>${pubPanel}</section>
      <section class="panel">
        <div class="panel-head"><h2>Údaje</h2>${can ? `<div class="head-actions">${d.status !== 'zverejneno' ? `<button class="linkbtn" data-a="dStatus" data-v="${d.status === 'vyrazeno' ? 'koncept' : 'vyrazeno'}">${d.status === 'vyrazeno' ? 'Vrátit mezi koncepty' : 'Vyřadit'}</button>` : ''}<button class="linkbtn" data-a="dDelete" style="color:var(--err)">Smazat</button></div>` : ''}</div>
        ${d.brief?.topic ? `<p style="font-size:14px"><b>Zadání:</b> ${esc(d.brief.topic)} <span class="muted">(${LEN[d.brief.length] || '?'})</span></p>` : ''}
        ${d.brief?.pozn ? `<p class="hint">${esc(d.brief.pozn)}${d.brief.pouceni ? ` Poučení: ${esc(d.brief.pouceni)}` : ''}</p>` : ''}
        <div class="fields3">
          <div><label>Id (název obálky)</label><input data-dm="id" value="${esc(s.id)}" ${ro || d.status !== 'koncept' ? 'readonly' : ''}></div>
          <div><label>Věk od</label><input type="number" min="1" max="12" data-dm="a0" value="${s.ages[0]}" ${ro ? 'readonly' : ''}></div>
          <div><label>Věk do</label><input type="number" min="1" max="12" data-dm="a1" value="${s.ages[1]}" ${ro ? 'readonly' : ''}></div>
          <div><label>Hudba v pozadí</label><select data-dm="mood" ${ro ? 'disabled' : ''}>${Object.entries(MOODS).map(([v, l]) => `<option value="${v}" ${s.mood === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div><label>Emoji obálky</label><input data-dm="emoji" value="${esc(s.cover.emoji)}" ${ro ? 'readonly' : ''}></div>
          <div><label>&nbsp;</label><label class="check"><input type="checkbox" data-dm="free" ${s.free ? 'checked' : ''} ${ro ? 'disabled' : ''}> Zdarma</label></div>
        </div>
        <label>Kategorie</label><div class="chips">${GCATS.map(metaChip).join('')}</div>
        ${d.brief?.model ? `<p class="hint" style="margin-top:10px">${d.brief.model === 'simulace' ? 'Simulovaný text (bez modelu).' : `Model ${esc(d.brief.model)}${d.brief.usage ? ` · ${fmt(d.brief.usage.input)} + ${fmt(d.brief.usage.output)} tokenů` : ''}`}</p>` : ''}
      </section>
    </div>
    ${!ro ? `<section class="panel"><div class="grevise">
      <input data-gf="note" value="${esc(GS.note)}" placeholder="Co přepsat generátorem? Např. ať má sovička jméno a konec je klidnější" ${GS.busy ? 'disabled' : ''}>
      <button class="btn white" data-a="dRevise" ${GS.busy ? 'disabled' : ''}>${I.wand}${GS.busy ? 'Přepisuji…' : 'Upravit generátorem'}</button></div>
      ${GS.err && route() === 'zasobnik' ? `<p class="err">${esc(GS.err)}</p>` : ''}</section>` : ''}
    ${benchHtml({ story: s, brief: d.brief, readonly: ro, fix: ro ? null : 'dFix' })}`;
}
const voiceCmds = (id) => `# 1. koncept do repozitáře (tlačítko „Stáhnout koncept“) a přenos do aplikace
node tools/pohadky/over.mjs koncepty/pohadky/${id}.js
node tools/pohadky/prenest.mjs ${id}
# 2. společné věty přes tts-worker (ElevenLabs, hlas Jana)
node tools/hlas/plan.mjs spolecne
node tools/hlas/namluvit.mjs odhad tools/hlas/davky/${id}-spolecne.json
node tools/hlas/namluvit.mjs nahrat tools/hlas/davky/${id}-spolecne.json
# 3. zvýšit cache AUDIO v app/sw.js a app/offline.js, commit a nasadit web
# 4. tady „Zkontrolovat a zveřejnit“`;

function draftMeta(t) {
  if (!DED) return;
  const s = DED.d.story, k = t.dataset.dm;
  if (k === 'id') s.id = t.value.trim();
  else if (k === 'a0' || k === 'a1') s.ages[k === 'a0' ? 0 : 1] = Number(t.value);
  else if (k === 'mood') s.mood = t.value;
  else if (k === 'emoji') s.cover.emoji = t.value.trim();
  else if (k === 'free') s.free = t.checked;
  DED.dirty = true;
  const sv = $('#dSave'); if (sv) sv.disabled = false;
}

async function saveDraftEdits() {
  const d = DED.d, s = d.story;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.id)) { toast('Id smí mít jen malá písmena bez diakritiky, číslice a pomlčky'); return false; }
  if (!s.cats.length) { toast('Vyber aspoň jednu kategorii'); return false; }
  if (!(s.ages[0] >= 1 && s.ages[1] >= s.ages[0])) { toast('Věk od musí být menší nebo stejný jako věk do'); return false; }
  try {
    await DR.save(d);
    DED = { id: d.id, d: structuredClone(d), dirty: false };
    if (BENCH) BENCH.dirty = false;
    toast('Uloženo'); render(); return true;
  } catch (e) { toast(/conflict/.test(e.message) ? e.message.replace(/^conflict:\s*/, '') : 'Uložit se nepodařilo: ' + e.message); return false; }
}

function openCoverBrief(d) {
  let p;
  try { p = coverPrompt(d.story, 'm'); } catch (e) { toast('Šablona má chybu, oprav ji'); return; }
  modal(`<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dcT">
    <div class="dialog-head"><h2 id="dcT">Zadání obálky: ${esc(titleOf(d.story))}</h2><button class="x" data-a="close" aria-label="Zavřít">×</button></div>
    <div class="dialog-body">
      <div class="notice"><img src="../brand/maskot-3d/web/ospalek-hlava.webp" alt=""><div><b>Obrázek se zatím generuje mimo administraci</b> (stejně jako obálky ostatních pohádek). Prompt zkopíruj do generátoru obrázků nebo ho pošli Claudovi. Hotový obrázek ulož jako <span class="path">covers/${esc(d.story.id)}.jpg</span> (JPG 573×768), případně i verzi s holčičkou <span class="path">covers/${esc(d.story.id)}-f.jpg</span>, nasaď web a dej „Zkontrolovat a zveřejnit“.</div></div>
      <textarea data-prompt="m" rows="12" style="font-family:var(--body);font-size:13px" spellcheck="false">${esc(p)}</textarea>
    </div>
    <div class="dialog-foot"><div class="r"><button class="btn white" data-a="close">Zavřít</button><button class="btn" data-a="copyPrompt" data-v="m">${I.copy}Zkopírovat prompt</button></div></div>
  </div>`);
}

PAGES.generator = pageGenerator;
PAGES.zasobnik = pageDrafts;
Object.assign(ACTIONS, {
  gCat: (v) => { GS.form.category = v; render(); },
  gSet: (v, t) => { GS.form[t.dataset.k] = t.dataset.k === 'length' ? Number(v) : v; render(); },
  gGen: () => runGen(null),
  gSim: async () => { GS.busy = true; render(); const f = GS.form; GS.cur = { ...simulate({ category: f.category, topic: f.topic.trim() || 'nová pohádka', length: f.length, pro: f.pro }), simulated: true, draftId: null }; GS.err = ''; GS.noKey = false; GS.busy = false; render(); },
  gRevise: () => { if (!GS.cur) return; if (!GS.note.trim()) { toast('Napiš, co upravit'); return; } runGen({ id: GS.cur.story.id, titleSrc: GS.cur.story.titleSrc, textSrc: GS.cur.story.textSrc, note: GS.note, problems: [] }); },
  gFix: () => { if (!GS.cur || !BENCH?.check) return; runGen({ id: GS.cur.story.id, titleSrc: GS.cur.story.titleSrc, textSrc: GS.cur.story.textSrc, note: GS.note, problems: BENCH.check.err }); },
  gSave: async () => {
    const c = GS.cur; if (!c) return;
    if (!canEdit()) { toast('Ukládat smí jen role Vlastník nebo Obsah'); return; }
    if (unsafe(c.story)) { toast('Šablona obsahuje nepovolený kód'); return; }
    if ((DR.list || []).some((d) => d.story.id === c.story.id && d.status !== 'vyrazeno') || STORIES.some((s) => s.id === c.story.id)) {
      let n = 2; while (STORIES.some((s) => s.id === `${c.story.id}-${n}`) || (DR.list || []).some((d) => d.story.id === `${c.story.id}-${n}`)) n++;
      c.story.id = `${c.story.id}-${n}`;
    }
    try {
      if (!DR.list) await DR.load();
      const d = await DR.save({ story: structuredClone(c.story), brief: c.brief, status: 'koncept', steps: {} });
      c.draftId = d.id; toast('Uloženo do zásobníku'); render();
    } catch (e) { toast('Uložit se nepodařilo: ' + e.message); }
  },
  gKidAdd: () => { GS.fam.kids.push({ name: 'Matěj', g: 'm', age: 7, food: 'špagety', animal: 'tygr', hero: false, forms: null }); store.set(FKEY, GS.fam); render(); },
  gKidDel: (v) => { GS.fam.kids.splice(Number(v), 1); if (!GS.fam.kids.some((k) => k.hero)) GS.fam.kids[0].hero = true; store.set(FKEY, GS.fam); render(); },
  gFamReset: () => { GS.fam = structuredClone(FAM_DEF); store.set(FKEY, GS.fam); render(); },
  dReload: () => { DR.list = null; render(); },
  dFilter: (v) => { ZF.status = v; render(); },
  dSave: () => saveDraftEdits(),
  dCatT: (v, t) => { if (!DED) return; const c = DED.d.story.cats; DED.d.story.cats = c.includes(v) ? c.filter((x) => x !== v) : [...c, v]; t.classList.toggle('on'); DED.dirty = true; const sv = $('#dSave'); if (sv) sv.disabled = false; },
  dPublish: () => DED && advance(DED.d),
  dSkip: (v) => {
    if (!DED) return;
    const l = STEPS.find(([k]) => k === v)[1];
    confirmBox(`Zveřejnit bez kroku „${l}“?`, v === 'obalka' ? 'V aplikaci bude místo obrázku jen emoji a barvy. Obálku jde doplnit později v sekci Pohádky.' : 'Věty, které nejsou namluvené předem, aplikace dotáhne přes tts-worker při prvním poslechu. Platí se tehdy a bez internetu pohádka nehraje.', 'Vynechat', () => {
      DED.d.steps = { ...DED.d.steps, [v]: { stav: 'vynechano', pozn: 'Vynecháno ručně', at: now() } };
      advance(DED.d, 'Krok vynechán');
    });
  },
  dSimulate: async () => {
    if (!DED) return;
    const d = DED.d;
    ['obalka', 'hlas', 'zvuk'].forEach((k) => { d.steps = { ...d.steps, [k]: { stav: 'hotovo', pozn: 'Simulace (ukázkový režim)', at: now() } }; });
    DR.busy = true; render();
    await new Promise((r) => setTimeout(r, 700));
    try { await publishDraft(d); await DR.save(d); toast('Zveřejněno (ukázkový režim)'); } catch (e) { toast(e.message); }
    DR.busy = false; render();
  },
  dStatus: async (v) => { if (!DED) return; DED.d.status = v; try { await DR.save(DED.d); render(); toast(v === 'vyrazeno' ? 'Koncept je vyřazený' : 'Koncept je zpátky'); } catch (e) { toast(e.message); } },
  dDelete: () => {
    if (!DED) return;
    confirmBox('Smazat koncept?', DED.d.status === 'zverejneno' ? 'Smaže se jen záznam v zásobníku, pohádka v aplikaci zůstane.' : 'Koncept se smaže natrvalo.', 'Smazat', async () => {
      try { await DR.del(DED.id); DED = null; go('zasobnik'); toast('Koncept je smazaný'); } catch (e) { toast(e.message); }
    });
  },
  dDownload: () => { if (!DED) return; download(`${DED.d.story.id}.js`, draftFile(DED.d)); toast('Koncept se stahuje'); },
  dCover: () => DED && openCoverBrief(DED.d),
  dRevise: async () => {
    if (!DED) return;
    if (!GS.note.trim()) { toast('Napiš, co upravit'); return; }
    await reviseDraft([]);
  },
  dFix: () => reviseDraft(BENCH?.check?.err || []),
});
async function reviseDraft(problems) {
  const d = DED.d, b = d.brief || {};
  GS.busy = true; GS.err = ''; render();
  try {
    const out = await generateStory({ category: d.story.cats[0], topic: b.topic || titleOf(d.story), length: b.length || 5, pro: b.pro || 'vse' },
      { id: d.story.id, titleSrc: d.story.titleSrc, textSrc: d.story.textSrc, note: GS.note, problems });
    if (unsafe(out.story)) throw new Error('Odpověď obsahuje nepovolený kód.');
    // v ukázkovém režimu simulace text nepřepisuje, jen ukáže, kde by se úprava projevila
    if (!out.simulated) { d.story.titleSrc = out.story.titleSrc; d.story.textSrc = out.story.textSrc; d.brief = { ...b, model: out.brief.model, usage: out.brief.usage }; DED.dirty = true; GS.note = ''; toast('Text je přepsaný, zkontroluj ho a ulož'); }
    else toast('V ukázkovém režimu generátor text nepřepisuje');
  } catch (e) { GS.err = e.message; }
  GS.busy = false; render();
}
document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.dataset.fam) return famInput(t);
  if (t.dataset.g) return srcInput(t);
  if (t.dataset.gf) { if (t.dataset.gf === 'note') GS.note = t.value; else GS.form[t.dataset.gf] = t.value; return; }
  if (t.dataset.dm) return draftMeta(t);
});
document.addEventListener('toggle', (ev) => { if (ev.target.id === 'gSrc') GS.srcOpen = ev.target.open; }, true);
