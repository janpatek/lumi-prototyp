// Ospalek – webový prototyp. Bez buildu, data v localStorage tohoto prohlížeče.
// Je-li vyplněný ../config.js, posílá sync.js rodinu a poslechy do databáze (Supabase) pro administraci.
// (cap a listCz pochází ze stories.cs.js)

const APP_NAME = 'Ospalek';
// Server s hlasem ElevenLabs (složka tts-worker/). Prázdné = čte hlas prohlížeče.
// Nasazený Worker; hlas Jany nastavuje tts-worker/wrangler.toml (VOICES).
const TTS_URL_DEFAULT = 'https://ospalek-tts.jan-patek.workers.dev';
// lokální zkouška: ?tts=http://localhost:8787 (jen localhost, aby odkaz nemohl poslat pohádku jinam)
const TTS_URL = (() => {
  const q = new URLSearchParams(location.search).get('tts');
  return q && /^http:\/\/localhost(:\d+)?$/.test(q) ? q : TTS_URL_DEFAULT;
})();
// Limity formulářů: brání tomu, aby rodina (nebo skript) zbytečně pálila kredity za hlas. Worker má vlastní pojistky.
const LIMIT = { children: 2, parents: 4, heroes: 2, changes: 10, name: 20, cases: 24, item: 30, place: 40, spots: 10 };
// jméno: jen písmena, mezera, spojovník a apostrof
const cleanName = (s, max = LIMIT.name) => String(s || '').replace(/[^\p{L}\s'’-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanText = (s, max) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
// Změny údajů, které mění text pohádek (jméno, jídlo, zvíře, obec, nové dítě…), po dokončení úvodního nastavení:
// nejvýš LIMIT.changes za kalendářní měsíc. Každá změna znamená nové věty k namluvení.
function changesLeft() {
  const m = new Date().toISOString().slice(0, 7);
  if (!S.changes || S.changes.m !== m) S.changes = { m, n: 0 };
  return Math.max(0, LIMIT.changes - S.changes.n);
}
function useChange() {
  if (!S.onboarded) return true;
  if (!changesLeft()) return false;
  S.changes.n++;
  return true;
}
const changesNote = () => (S.onboarded ? `<p class="note" id="changesMsg">Změny jmen, jídla, zvířat a míst: tento měsíc zbývá ${changesLeft()} z ${LIMIT.changes}.</p>` : '');
const changesOut = 'Tento měsíc už další změny udělat nejde. Nové budou možné od začátku příštího měsíce.';
const LS_KEY = 'lumi.v1'; // klíč z doby pracovního názvu, ať se neztratí uložené rodiny
const store = {
  get() { try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch (e) { return null; } },
  set(v) { try { localStorage.setItem(LS_KEY, JSON.stringify(v)); } catch (e) { /* prototyp běží i bez úložiště */ } },
  clear() { try { localStorage.removeItem(LS_KEY); } catch (e) {} },
};
const blank = () => ({ user: null, onboarded: false, premium: false, heroIds: [], family: { children: [], parents: [], home: { town: '', inTown: '', near: [], attr: [], nearOpts: [], attrOpts: [] } } });
let S = store.get() || blank();
if (!S.heroIds) S.heroIds = S.heroId ? [S.heroId] : []; // starší uložená data měla jen jednoho hrdinu
// shelf: otevřená polička knihovny (id kategorie, 'fav', 'unheard', 'all'), null = všechny poličky
let ui = { screen: S.user ? (S.onboarded ? 'lib' : 'onb') : 'login', step: 0, shelf: null, ageOnly: false, unheard: false };
// SYNC: app/sync.js, odešle do databáze, je-li nastavená. Po změně rodiny se přepočítá, co je stažené na cestu,
// a věty se starými jmény se ze zařízení smažou (pruneOffline).
let pruneT = null;
const save = () => { store.set(S); SYNC.family(S); offlineMemo.clear(); clearTimeout(pruneT); pruneT = setTimeout(pruneOffline, 2000); };
const $app = document.getElementById('app');
const $modal = document.getElementById('modal');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const uid = () => Math.random().toString(36).slice(2, 9);

// ---------- Značka: ikony, maskot, barvy kategorií ----------
const ico = (d, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const I = {
  gear: ico('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  close: ico('<path d="M6 6l12 12M18 6L6 18"/>'),
  back: ico('<path d="M15 5l-7 7 7 7"/>'),
  lock: ico('<rect x="5" y="11" width="14" height="10" rx="3"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  book: ico('<path d="M4 5a2 2 0 0 1 2-2h5v17H6a2 2 0 0 0-2 2zM20 5a2 2 0 0 0-2-2h-5v17h5a2 2 0 0 1 2 2z"/>'),
  home: ico('<path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z"/>'),
  star: ico('<path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8 6.6 19.7l1.1-6.1L3.2 9.4l6.1-.8z"/>'),
  music: ico('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>'),
  down: ico('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  hist: ico('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  bell: ico('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
  mic: ico('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
  replay: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg>',
};
const MASCOT = { mark: '../brand/maskot-3d/web/ospalek-mark.webp', head: '../brand/maskot-3d/web/ospalek-hlava.webp', sleep: '../brand/maskot-3d/web/ospalek-spi.webp', trip: '../brand/maskot-3d/web/ospalek-vyprava.webp' };
// každá kategorie má svou pastelovou barvu (brand manuál)
const CAT_COLOR = { noc: 'var(--lavender)', auto: 'var(--sky)', dobro: 'var(--peach)', zivot: 'var(--mint)', sranda: 'var(--honey)', lidove: 'var(--peach)', hrdinove: 'var(--sky)', zvirata: 'var(--mint)', svatky: 'var(--peach)', zvidave: 'var(--sky)' };
const catColor = (st) => CAT_COLOR[st.cats[0]] || 'var(--lavender)';
// plyšové ikonky kategorií (brand/ikony)
const CAT_ICONS = new Set(['noc', 'auto', 'dobro', 'zivot', 'sranda', 'lidove', 'hrdinove', 'zvirata', 'svatky', 'zvidave']);
const catIcon = (id, cls = 'cat-ico') => (CAT_ICONS.has(id) ? `<img class="${cls}" src="../brand/ikony/kat-${id}.webp" alt="">` : '');
const catLabel = (st) => (CATEGORIES.find((k) => k.id === st.cats[0]) || {}).label || '';
// avatar: první písmeno jména v pastelovém kolečku
const AV_TONES = { child: ['peach', 'mint', 'sky', 'honey'], mama: 'peach', tata: 'sky', babi: 'mint', deda: 'honey' };
const avatar = (p, kind, i = 0) => {
  const tone = kind === 'child' ? AV_TONES.child[i % 4] : AV_TONES[p.role];
  const letter = kind === 'child' || p.name ? (p.forms.nom || '?').charAt(0).toUpperCase() : ROLES[p.role].label.charAt(0);
  return `<div class="av ${tone}" aria-hidden="true">${esc(letter)}</div>`;
};

// ---------- Skloňování ----------
const CASES = [['nom', '1. pád – kdo'], ['gen', '2. pád – bez koho'], ['dat', '3. pád – komu'], ['acc', '4. pád – koho vidím'], ['voc', '5. pád – oslovení'], ['ins', '7. pád – s kým']];
const SOFT = 'žščřcjďťň';

function decline(name, gender) {
  const n = name.trim();
  const f = (gen, dat, acc, voc, ins) => ({ nom: n, gen, dat, acc, voc, ins });
  if (!n) return f('', '', '', '', '');
  const last = n.slice(-1).toLowerCase();
  const stem = n.slice(0, -1);
  if (gender === 'f') {
    if (last === 'a') {
      const s = stem.slice(-1).toLowerCase();
      if (SOFT.includes(s)) return f(stem + 'i', stem + 'e', stem + 'u', stem + 'o', stem + 'ou');
      const dat = { k: stem.slice(0, -1) + 'ce', h: stem.slice(0, -1) + 'ze', g: stem.slice(0, -1) + 'ze', r: stem.slice(0, -1) + 'ře' }[s]
        || ('lsz'.includes(s) ? stem + 'e' : stem + 'ě');
      return f(stem + 'y', dat, stem + 'u', stem + 'o', stem + 'ou');
    }
    if (last === 'e') return f(n, stem + 'i', stem + 'i', n, stem + 'í');
    return f(n, n, n, n, n); // Ester, Nikol – nesklonné
  }
  if (last === 'a') {
    const soft = SOFT.includes(stem.slice(-1).toLowerCase());
    return f(stem + (soft ? 'i' : 'y'), stem + 'ovi', stem + 'u', stem + 'o', stem + 'ou');
  }
  if (last === 'í') return f(n + 'ho', n + 'mu', n + 'ho', n, n + 'm');
  if (last === 'o') return f(stem + 'a', stem + 'ovi', stem + 'a', n, stem + 'em');
  let base = n;
  if (/ek$/i.test(n)) base = n.slice(0, -2) + 'k';
  if (/^(pavel|karel)$/i.test(n)) base = n.slice(0, -2) + 'l';
  const b = base.slice(-1).toLowerCase();
  if (SOFT.includes(b) || b === 'x') return f(base + 'e', base + 'ovi', base + 'e', base + 'i', base + 'em');
  let voc = base + 'e';
  if ('khg'.includes(b) || /ch$/i.test(base)) voc = base + 'u';
  else if (/[^aeiouyáéíóúůý]r$/i.test(base)) voc = base.slice(0, -1) + 'ře';
  return f(base + 'a', base + 'ovi', base + 'a', voc, base + 'em');
}

const ROLES = {
  mama: { label: 'Maminka', g: 'f', forms: { nom: 'maminka', gen: 'maminky', dat: 'mamince', acc: 'maminku', voc: 'maminko', ins: 'maminkou' } },
  tata: { label: 'Tatínek', g: 'm', forms: { nom: 'tatínek', gen: 'tatínka', dat: 'tatínkovi', acc: 'tatínka', voc: 'tatínku', ins: 'tatínkem' } },
  babi: { label: 'Babička', g: 'f', forms: { nom: 'babička', gen: 'babičky', dat: 'babičce', acc: 'babičku', voc: 'babičko', ins: 'babičkou' } },
  deda: { label: 'Dědeček', g: 'm', forms: { nom: 'dědeček', gen: 'dědečka', dat: 'dědečkovi', acc: 'dědečka', voc: 'dědečku', ins: 'dědečkem' } },
};

function inTownGuess(town) {
  const t = town.trim();
  if (!t) return '';
  const special = { praha: 'v Praze', brno: 'v Brně', plzeň: 'v Plzni', olomouc: 'v Olomouci', liberec: 'v Liberci', ostrava: 'v Ostravě', 'české budějovice': 'v Českých Budějovicích', 'hradec králové': 'v Hradci Králové', bratislava: 'v Bratislavě', košice: 'v Košicích', kladno: 'na Kladně' };
  if (special[t.toLowerCase()]) return special[t.toLowerCase()];
  const v = /^[vVfF]/.test(t) ? 've ' : 'v ';
  if (/ov$|ín$|ýn$/.test(t)) return v + t + 'ě';
  if (/ice$/.test(t)) return v + t.slice(0, -1) + 'ích';
  if (/any$/.test(t)) return v + t.slice(0, -1) + 'ech';
  if (/[dtnvbpm]a$/.test(t)) return v + t.slice(0, -1) + 'ě';
  return 've městě ' + t;
}

// ---------- Kontext pro pohádku ----------
// hrdinů může být víc – pády se spojí ("Toníkovi a Elišce"), slovesa přejdou do množného čísla
function ctx(heroes) {
  const fam = S.family;
  const one = heroes.length === 1;
  const allF = heroes.every((k) => k.gender === 'f');
  const sibRaw = fam.children.find((k) => !heroes.includes(k));
  const h = {};
  CASES.forEach(([k]) => { h[k] = listCz(heroes.map((x) => x.forms[k])); });
  const uniq = (a) => [...new Set(a.map((x) => x.toLowerCase()))];
  const mkParent = (p) => {
    const r = ROLES[p.role];
    const name = p.name ? p.forms : null;
    const full = r.forms.nom + (name ? ' ' + name.nom : '');
    return { ...r.forms, full, name, g: (m, f) => (r.g === 'f' ? f : m) };
  };
  const ps = fam.parents.map(mkParent);
  return {
    H: h.nom,
    h,
    // šablona může volat g() i ve větvi pro jedno dítě, která se pak nepoužije – proto náhrada za chybějící mpl
    g: (m, f, mpl = m, fpl) => (one ? (allF ? f : m) : allF ? fpl ?? mpl.replace(/li\b/g, 'ly') : mpl),
    n: (sg, pl) => (one ? sg : pl),
    sib: sibRaw ? sibRaw.forms : null,
    sg: (m, f) => (sibRaw && sibRaw.gender === 'f' ? f : m),
    p1: ps[0] || mkParent({ role: 'mama' }),
    p2: ps[1] || null,
    town: fam.home.town,
    inTown: fam.home.inTown || 'v jednom malém městečku',
    near: fam.home.near,
    attr: fam.home.attr,
    food: listCz(uniq(heroes.map((k) => k.food || 'palačinky'))),
    animal: listCz(uniq(heroes.map((k) => k.animal || 'pejsek'))),
  };
}
const heroes = () => {
  const sel = S.family.children.filter((k) => S.heroIds.includes(k.id)).slice(0, LIMIT.heroes);
  return sel.length ? sel : S.family.children.slice(0, 1);
};
const minutes = (segs) => Math.max(1, Math.round(segs.reduce((a, s) => a + s.t.split(/\s+/).length / 2 + (s.pause || 0) + 1, 0) / 60));
const coverImg = (st, ks) => (ks.every((k) => k.gender === 'f') && st.cover.imgF) || st.cover.img;
const unlocked = (st) => st.free || S.premium;
// Plus odemčený kódem (recenzenti obchodů, dárky): do kdy platí, ověřuje server (app_redeem_code)
const codeOn = () => !!(S.codeUntil && S.codeUntil > Date.now());
// Aplikace pro iPhone: kód „Mám kód“ tu není. App Store nedovoluje odemykat obsah vlastním kódem mimo nákup v aplikaci
// (pravidlo 3.1.1); kupóny pro iPhone jsou nabídkové kódy App Storu, které se uplatňují v App Storu.
const IOS_APP = !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios');
const yrs = (n) => `${n} ${n >= 2 && n <= 4 ? 'roky' : 'let'}`;

// ---------- Obrazovky ----------
const screens = {
  login: () => `
    <div class="login">
      <div class="logo"><img src="${MASCOT.mark}" alt=""><h1 class="wordmark">${APP_NAME}</h1></div>
      <p class="tag">Pohádky, kde je hlavním hrdinou vaše dítě.</p>
      <button class="btn" data-a="start">Začít</button>
      <p class="fine">Bez registrace a bez e-mailu. První 3 pohádky jsou zdarma.<br><a href="../obchodni-podminky/" target="_blank" rel="noopener">Obchodní podmínky</a> · <a href="../ochrana-osobnich-udaju/" target="_blank" rel="noopener">Ochrana osobních údajů</a></p>
    </div>`,

  onb: () => {
    const steps = onbSteps();
    ui.step = Math.min(ui.step, steps.length - 1);
    return `
      <div class="step-label">Krok ${ui.step + 1} ze ${steps.length}</div>
      <div class="progress"><div style="width:${((ui.step + 1) / steps.length) * 100}%"></div></div>
      ${steps[ui.step]()}`;
  },

  lib: () => {
    const hs = heroes();
    const c = ctx(hs);
    const fits = (s) => hs.every((k) => k.age >= s.ages[0] && k.age <= s.ages[1]);
    // pořadí na poličce: nejdřív pohádky pro věk vybraných dětí, z nich ty ještě neslyšené
    const rank = (list) => list.map((s, i) => [s, (fits(s) ? 0 : 2) + (heardCount(s.id) ? 1 : 0), i]).sort((a, b) => a[1] - b[1] || a[2] - b[2]).map((x) => x[0]);
    const favs = favList();
    const banners = `
      ${navigator.onLine ? '' : `<div class="netnote">${I.down}<span><b>Jste bez internetu.</b> Pustit jdou pohádky se značkou Offline.</span></div>`}`;
    // stránka jedné poličky („vše ›“): mřížka se dvěma filtry
    if (ui.shelf) {
      const base = ui.shelf === 'fav' ? favs : ui.shelf === 'all' ? STORIES : ui.shelf === 'unheard' ? STORIES.filter((s) => !heardCount(s.id)) : STORIES.filter((s) => s.cats.includes(ui.shelf));
      const list = (ui.shelf === 'fav' ? base : rank(base)).filter((s) => (!ui.ageOnly || fits(s)) && (!ui.unheard || !heardCount(s.id)));
      const title = { fav: 'Oblíbené', all: 'Všechny pohádky', unheard: 'Ještě neslyšené' }[ui.shelf] || (CATEGORIES.find((k) => k.id === ui.shelf) || {}).label || '';
      const empty = ui.shelf === 'fav' && !base.length ? 'Zatím tu nic není. Hvězdičkou u pohádky si ji uložíte sem.'
        : ui.unheard ? 'Všechny pohádky z výběru už jste slyšeli.' : 'Pro tenhle výběr tu zatím nic není.';
      return `
      <div class="top">
        <button class="icon-btn" data-a="shelfBack" aria-label="Zpět na všechny poličky">${I.back}</button>
        <h1 class="grow">${catIcon(ui.shelf)}${esc(title)}</h1>
      </div>
      ${banners}
      ${base.length ? `<div class="hscroll">
        <button class="chip ${ui.ageOnly ? 'on' : ''}" data-a="age" aria-pressed="${ui.ageOnly}">${hs.length === 1 ? `Pro ${hs[0].age}leté` : 'Podle věku'}</button>
        ${ui.shelf === 'unheard' ? '' : `<button class="chip ${ui.unheard ? 'on' : ''}" data-a="unheard" aria-pressed="${ui.unheard}">Ještě neslyšené</button>`}
      </div>` : ''}
      <div class="grid">${list.map((s) => storyCard(s, c, hs)).join('') || `<div class="empty"><img src="${MASCOT.trip}" alt="">${empty}</div>`}</div>`;
    }
    const shelf = (key, label, list, ico = '') => list.length ? `
      <section class="shelf">
        <button class="shelf-h" data-a="shelf" data-id="${key}"><span class="shelf-t">${ico}${esc(label)}</span><span class="shelf-all">vše<span aria-hidden="true"> ›</span></span></button>
        <div class="shelf-row" data-k="${key}">${list.map((s) => storyCard(s, c, hs, true)).join('')}</div>
      </section>` : '';
    const heardAny = (S.history || []).some((x) => x.done);
    return `
      <div class="top">
        <h1>Pohádky pro ${esc(c.h.acc)}</h1>
        <div class="top-btns"><button class="icon-btn" data-a="history" aria-label="Co jsme už slyšeli">${I.hist}</button><button class="icon-btn" data-a="settings" aria-label="Nastavení">${I.gear}</button></div>
      </div>
      ${banners}
      ${todayCard(hs, c)}
      ${S.onboarded && S.notify === undefined && DAILY.supported() ? `<div class="person remind-ask"><div class="av lavender">${I.bell}</div><div class="nm"><b>Připomenout vám večer pohádku?</b><span>Každý den v ${DAILY.hour()}:00 přijde upozornění s pohádkou dne. Vypnout to jde kdykoli v nastavení.</span><span class="err" id="remindMsg"></span></div><button class="btn small" data-a="remindYes">Ano</button><button class="btn small ghost" data-a="remindNo">Ne, díky</button></div>` : ''}
      ${S.family.children.length > 1 ? `
        <div class="section-t">Hlavní hrdinové <span class="hint">– vyberte jednoho nebo víc</span></div>
        <div class="chips">${S.family.children.map((k) => `<button class="chip ${hs.includes(k) ? 'on' : ''}" data-a="hero" data-id="${k.id}" aria-pressed="${hs.includes(k)}">${hs.includes(k) ? '✓ ' : ''}${esc(k.forms.nom)}</button>`).join('')}</div>` : ''}
      ${S.premium && ui.trial && ui.trial.renews ? `<div class="person" style="margin-bottom:12px"><div class="nm"><b>Zkušební doba končí ${trialWhen(ui.trial.end)}</b><span>Pak ${PRICE.text} měsíčně. Když nechcete pokračovat, zrušte předplatné nejpozději ${trialWhen(new Date(ui.trial.end - 24 * 3600e3))}.</span></div><button class="btn small ghost" data-a="unsub">Spravovat</button></div>` : ''}
      ${S.premium ? '' : `<button class="promo" data-a="paywall"><img src="${MASCOT.mark}" alt=""><div><b>Odemkněte všechny pohádky</b><span>3 dny zdarma, pak ${PRICE.text} měsíčně</span></div></button>`}
      ${SYNC.on && S.analytics === undefined ? `<div class="person" style="margin-bottom:12px"><div class="nm"><b>Pomůžete nám zlepšovat pohádky?</b><span>Uvidíme, které pohádky posloucháte a jak dlouho. Bez souhlasu jen anonymně. Změnit to můžete kdykoli v nastavení.</span></div><button class="btn small" data-a="analytics" data-v="1">Ano</button><button class="btn small ghost" data-a="analytics" data-v="0">Ne, díky</button></div>` : ''}
      ${shelf('fav', 'Oblíbené', favs, `<span class="shelf-star">${I.star}</span>`)}
      ${heardAny ? shelf('unheard', 'Ještě neslyšené', rank(STORIES.filter((s) => !heardCount(s.id)))) : ''}
      ${CATEGORIES.filter((k) => k.id !== 'all').map((k) => shelf(k.id, k.label, rank(STORIES.filter((s) => s.cats.includes(k.id))), catIcon(k.id))).join('')}
      <button class="btn ghost all-btn" data-a="shelf" data-id="all">Všechny pohádky (${STORIES.length})</button>`;
  },

  history: () => {
    const h = S.history || [];
    const done = h.filter((x) => x.done);
    const kinds = new Set(done.map((x) => x.id)).size;
    const when = (t) => new Date(t).toLocaleString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
    return `
    <div class="top">
      <h1>Co jsme už slyšeli</h1>
      <button class="icon-btn" data-a="back" aria-label="Zpět">${I.close}</button>
    </div>
    ${h.length ? `
      <p class="note">Dohráno ${done.length}× · ${kinds} z ${STORIES.length} pohádek. Ukládá se jen v tomhle zařízení.</p>
      <div class="hist">${h.slice(0, 50).map((x) => {
        const st = STORIES.find((s) => s.id === x.id);
        return `<button class="person" data-a="open" data-id="${x.id}"${st ? '' : ' disabled'}>
          <div class="av" style="background:${st ? catColor(st) : 'var(--line)'}">${st ? catIcon(st.cats[0], 'cat-ico') : ''}</div>
          <div class="nm"><b>${esc(x.title)}</b><span>${when(x.at)} · ${esc(x.who)} · ${x.done ? 'celá' : `rozposlechnutá (${Math.round(x.part * 100)} %)`}</span></div>
        </button>`;
      }).join('')}</div>
      <div class="footer-actions"><button class="btn ghost" data-a="clearHistory">Smazat historii poslechu</button></div>`
    : `<div class="empty"><img src="${MASCOT.head}" alt="">Zatím jste žádnou pohádku neposlouchali. Až nějakou pustíte, objeví se tady.</div>`}`;
  },

  settings: () => `
    <div class="top">
      <h1>Rodina a nastavení</h1>
      <button class="icon-btn" data-a="back" aria-label="Zpět">${I.close}</button>
    </div>
    <div class="section-t">Děti</div>${peopleList('child')}
    <div class="section-t">Rodiče a blízcí</div>${peopleList('parent')}
    <div class="section-t">Bydliště</div>
    <div class="person"><div class="av mint">${I.home}</div><div class="nm"><b>${esc(S.family.home.town || 'Nevyplněno')}</b><span>${esc([...S.family.home.near, ...S.family.home.attr].join(', ') || 'Bez míst v okolí')}</span></div><button class="btn small ghost" data-a="editHome">Upravit</button></div>
    <div class="section-t">Poslech bez internetu</div>
    <div class="person"><div class="av sky">${I.down}</div><div class="nm"><b id="offStat">Zjišťuji, co je staženo…</b><span>Stažené pohádky pustíte v autě nebo na chalupě bez signálu. Co dohrajete do konce, uloží se samo.</span></div></div>
    <div class="row-btns"><button class="btn small" data-a="downloadAll" id="dlAll">${I.down} Stáhnout všechny</button><button class="btn small ghost" data-a="clearOffline">Smazat stažené</button></div>
    ${remindSettings()}
    <div class="section-t">Předplatné</div>
    <div class="person"><div class="av ${S.premium ? 'honey' : ''}">${S.premium ? I.star : I.lock}</div><div class="nm"><b>${S.premium ? `${APP_NAME} Plus${BILLING.native || codeOn() ? '' : ' (demo)'}` : 'Zdarma – 3 pohádky'}</b><span>${S.premium && codeOn() ? `Odemčeno kódem do ${new Date(S.codeUntil).toLocaleDateString('cs-CZ')}.` : BILLING.native ? (S.premium ? 'Spravujete ho v nastavení předplatných App Store nebo Google Play.' : 'Koupili jste ho už na jiném zařízení? Klepněte na Odemknout → Obnovit nákupy.') : 'Předplatné se kupuje v mobilní aplikaci.'}</span></div>
      ${S.premium ? (codeOn() ? '' : `<button class="btn small ghost" data-a="unsub">${BILLING.native ? 'Spravovat' : 'Zrušit'}</button>`) : '<button class="btn small" data-a="paywall">Odemknout</button>'}</div>
    ${SYNC.on ? `<div class="section-t">Statistiky</div>
    <div class="person"><div class="nm"><b>Sdílet statistiky poslechu</b><span>${S.analytics ? 'Zapnuto: vidíme, které pohádky vaše rodina poslouchá a jak dlouho.' : 'Vypnuto: poslechy posíláme jen anonymně, bez vazby na vaši rodinu.'}</span></div><button class="btn small ${S.analytics ? 'ghost' : ''}" data-a="analytics" data-v="${S.analytics ? 0 : 1}">${S.analytics ? 'Vypnout' : 'Zapnout'}</button></div>` : ''}
    <p class="note" style="margin-top:6px"><a href="../obchodni-podminky/" target="_blank" rel="noopener">Obchodní podmínky</a> · <a href="../ochrana-osobnich-udaju/" target="_blank" rel="noopener">Ochrana osobních údajů</a></p>
    <div class="section-t">Vzhled</div>
    <div class="seg">${[['auto', 'Podle času'], ['light', 'Den'], ['dark', 'Noc']].map(([v, l]) => `<button data-a="theme" data-v="${v}" class="${(S.theme || 'auto') === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    <p class="note" style="margin-top:6px">Podle času: od 19 do 7 hodin je zapnutý noční režim.</p>
    <div class="footer-actions"><button class="btn ghost" data-a="reset">Smazat účet a všechna data</button></div>`,
};

function peopleList(kind) {
  const arr = kind === 'child' ? S.family.children : S.family.parents;
  return `<div class="people">${arr.map((p, i) => `
    <div class="person">
      ${avatar(p, kind, i)}
      <div class="nm"><b>${esc(kind === 'child' ? p.forms.nom : ROLES[p.role].label + (p.name ? ' ' + p.forms.nom : ''))}</b>
      <span>${kind === 'child' ? `${yrs(p.age)} · ${esc(p.food || '—')} · ${esc(p.animal || '—')}` : 'v pohádkách: „' + esc(ROLES[p.role].forms.nom + (p.name ? ' ' + p.forms.nom : '')) + '“'}</span></div>
      <button class="btn small ghost" data-a="editPerson" data-kind="${kind}" data-id="${p.id}">Upravit</button>
    </div>`).join('')}</div>
    ${arr.length < LIMIT[kind === 'child' ? 'children' : 'parents']
      ? `<button class="add" data-a="addPerson" data-kind="${kind}">+ Přidat ${kind === 'child' ? 'dítě' : 'rodiče nebo prarodiče'}</button>`
      : `<p class="note">${kind === 'child' ? `Víc než ${LIMIT.children} děti přidat nejde.` : `Víc než ${LIMIT.parents} dospělé přidat nejde.`}</p>`}`;
}

const stepKids = () => `
  <img class="onb-mascot" src="${MASCOT.head}" alt="">
  <h1>Kdo bude hlavní hrdina?</h1>
  <p class="lead">Přidejte své děti, nejvýš ${LIMIT.children}. Pohádky budou o nich – s jejich jménem, oblíbeným jídlem i zvířátkem.</p>
  ${peopleList('child')}
  <div class="footer-actions"><button class="btn" data-a="next" ${S.family.children.length ? '' : 'disabled'}>Pokračovat</button></div>`;

const stepParents = () => `
  <h1>Kdo s nimi zažije dobrodružství?</h1>
  <p class="lead">Maminka, tatínek, babička… V pohádkách se objeví vedle dětí.</p>
  ${peopleList('parent')}
  <div class="footer-actions">
    <button class="btn" data-a="next">${S.family.parents.length ? 'Pokračovat' : 'Přeskočit'}</button>
    <button class="link" data-a="prev">Zpět</button>
  </div>`;

const stepHome = () => `
  <h1>Kde bydlíte?</h1>
  <p class="lead">Pohádky se pak budou odehrávat na místech, která děti znají. Stačí obec. Přesnou adresu nepotřebujeme.</p>
  ${homeForm()}
  <div class="footer-actions">
    ${onbSteps().length > 3 ? '<button class="btn" data-a="homeNext">Pokračovat</button>' : '<button class="btn" data-a="finish">Hotovo – jdeme na pohádky</button>'}
    <button class="link" data-a="prev">Zpět</button>
  </div>`;

// Poslední krok: svolení k večerní připomínce. Prohlížeč se na povolení zeptá až po klepnutí na „Ano“.
const stepRemind = () => {
  const hs = heroes();
  const st = DAILY.pick(STORIES);
  const name = st ? st.title(ctx(hs)) : 'Hvězdička';
  return `
  <img class="onb-mascot" src="${MASCOT.sleep}" alt="">
  <h1>Připomenout večer pohádku?</h1>
  <p class="lead">Každý den v ${DAILY.hour()}:00 vám Ospalek připomene, že je čas na pohádku, a prozradí, která je pohádkou dne.</p>
  <div class="notif-demo" aria-hidden="true"><img src="icon-192.png" alt=""><div><b>Je čas na pohádku 🌙</b><span>Čeká na vás pohádka „${esc(name)}“.</span></div><small>${DAILY.hour()}:00</small></div>
  ${DAILY.needsInstall() ? `<p class="note">Na iPhonu chodí upozornění jen z Ospalka přidaného na plochu: v Safari klepněte na <b>Sdílet → Přidat na plochu</b>, otevřete Ospalka z plochy a připomínku zapněte v nastavení.</p>
  <div class="footer-actions"><button class="btn" data-a="remindNo">Rozumím, pokračovat</button><button class="link" data-a="prev">Zpět</button></div>` : `
  <div class="footer-actions">
    <button class="btn" data-a="remindYes">Ano, připomínat</button>
    <button class="link" data-a="remindNo">Teď ne</button>
  </div>
  <p class="note" id="remindMsg">Telefon se vás zeptá, jestli může Ospalek posílat upozornění. Vypnout to jde kdykoli v nastavení.</p>`}`;
};
const onbSteps = () => [stepKids, stepParents, stepHome, ...(DAILY.supported() || DAILY.needsInstall() ? [stepRemind] : [])];

// ---------- Oblíbené a karta pohádky ----------
// Oblíbené jsou jen v zařízení (localStorage spolu s rodinou), na server se neposílají. Nově přidané jsou první.
const isFav = (id) => (S.favs || []).includes(id);
const favList = () => (S.favs || []).map((id) => STORIES.find((s) => s.id === id)).filter(Boolean);
const favBtn = (id, cls = 'fav') => `<button class="${cls}${isFav(id) ? ' on' : ''}" data-a="fav" data-id="${id}" aria-pressed="${isFav(id)}" aria-label="${isFav(id) ? 'Odebrat z oblíbených' : 'Přidat do oblíbených'}">${I.star}</button>`;
function storyCard(s, c, hs, small = false) {
  const n = heardCount(s.id);
  return `
    <div class="card-w">
      <button class="card" data-a="open" data-id="${s.id}">
        <div class="cover" style="--g1:${s.cover.g1};--g2:${s.cover.g2}">
          ${s.cover.img ? `<img src="${coverImg(s, hs)}" alt="" loading="lazy">` : s.cover.emoji}
          ${s.free && !S.premium ? '<span class="badge free">Zdarma</span>' : ''}
          ${unlocked(s) ? '' : `<span class="badge lock">${I.lock}${small ? '<span class="sr-only">Zamčeno</span>' : 'Zamčeno'}</span>`}
          <span class="badge off" hidden>${I.down}Offline</span>
          ${n ? `<span class="badge heard">✓${small ? `${n > 1 ? ` ${n}×` : ''}<span class="sr-only"> slyšeno</span>` : ` Slyšeno${n > 1 ? ` ${n}×` : ''}`}</span>` : ''}
        </div>
        <h3>${esc(s.title(c))}</h3>
        <div class="meta">${catIcon(s.cats[0], 'cat-ico sm')}${minutes(s.text(c))} min · ${s.ages[0]}–${s.ages[1]} let</div>
      </button>
      ${favBtn(s.id)}
    </div>`;
}

// ---------- Pohádka dne ----------
function todayCard(hs, c) {
  const st = DAILY.pick(STORIES);
  if (!st) return '';
  return `
    <button class="today" data-a="open" data-id="${st.id}" style="--g1:${st.cover.g1};--g2:${st.cover.g2};--cat:${catColor(st)}">
      <div class="today-cover">${st.cover.img ? `<img src="${coverImg(st, hs)}" alt="">` : st.cover.emoji}</div>
      <div class="today-txt">
        <span class="today-tag">${I.star} Pohádka dne</span>
        <h2>${esc(st.title(c))}</h2>
        <span class="meta">${catIcon(st.cats[0], 'cat-ico sm')}${minutes(st.text(c))} min · ${esc(catLabel(st))}${heardCount(st.id) ? ' · ✓ slyšeli jste' : ''}</span>
      </div>
      <span class="today-play" aria-hidden="true">${unlocked(st) ? I.play : I.lock}</span>
    </button>`;
}

// Názvy pohádek se jménem dětí pro upozornění (doplní je sw.js, na server nejdou). Jen se zapnutou připomínkou.
function saveTitles(force) {
  if (!force && S.notify !== true) return;
  const c = ctx(heroes());
  const map = {};
  STORIES.forEach((st) => { try { map[st.id] = st.title(c); } catch (e) { /* šablona bez dat */ } });
  DAILY.titles(map);
}

// Nastavení: večerní připomínka
function remindSettings() {
  if (!DAILY.supported() && !DAILY.needsInstall()) return '';
  const h = `${DAILY.hour()}:00`;
  if (DAILY.needsInstall()) return `<div class="section-t">Večerní připomínka</div>
    <div class="person"><div class="av lavender">${I.bell}</div><div class="nm"><b>Jen z aplikace na ploše</b><span>Na iPhonu v Safari klepněte na Sdílet → Přidat na plochu, otevřete Ospalka z plochy a připomínku zapněte tady.</span></div></div>`;
  const blocked = DAILY.permission() === 'denied';
  const on = S.notify === true && !blocked;
  return `<div class="section-t">Večerní připomínka</div>
    <div class="person"><div class="av lavender">${I.bell}</div><div class="nm"><b>${on ? `Zapnuto: každý den v ${h}` : blocked ? 'Upozornění jsou zakázaná' : 'Vypnuto'}</b><span id="remindMsg">${on ? 'Upozornění „Je čas na pohádku“ s pohádkou dne.' : blocked ? 'Povolte je v nastavení prohlížeče nebo telefonu u webu Ospalek, pak tady připomínku zapněte.' : `Každý den v ${h} připomeneme, že je čas na pohádku, a prozradíme pohádku dne.`}</span></div>
    ${on ? '<button class="btn small ghost" data-a="remindOff">Vypnout</button>' : `<button class="btn small" data-a="remindYes"${blocked ? ' disabled' : ''}>Zapnout</button>`}</div>`;
}

function homeForm() {
  const h = S.family.home;
  const chips = (opts, sel, kind) => opts.map((o, i) => `<button class="chip ${sel.includes(o) ? 'on' : ''}" data-a="toggleSpot" data-kind="${kind}" data-i="${i}">${esc(o)}</button>`).join('');
  return `
    <label for="town">Obec nebo město</label>
    <div class="row"><input id="town" maxlength="${LIMIT.place}" placeholder="např. Benešov" value="${esc(h.town)}" autocomplete="address-level2"><button class="btn small" style="flex:0 0 auto" data-a="findSpots">Najít okolí</button></div>
    <label for="inTown">Jak doma říkáte: „bydlíme …“</label>
    <input id="inTown" maxlength="${LIMIT.place + 4}" placeholder="v Benešově" value="${esc(h.inTown)}">
    <div id="spotsMsg" class="note" style="margin-top:8px"></div>
    ${h.nearOpts.length ? `<div class="section-t">Obce v okolí</div><div class="chips">${chips(h.nearOpts, h.near, 'near')}</div>` : ''}
    ${h.attrOpts.length ? `<div class="section-t">Výletní místa</div><div class="chips">${chips(h.attrOpts, h.attr, 'attr')}</div>` : ''}
    <label for="addSpot">Přidat vlastní oblíbené místo</label>
    <div class="row"><input id="addSpot" maxlength="${LIMIT.place}" placeholder="např. Zoo Dvůr Králové"><button class="btn small ghost" style="flex:0 0 auto" data-a="addSpot">Přidat</button></div>`;
}

// ---------- Okolí z OpenStreetMap ----------
async function findSpots() {
  const town = document.getElementById('town').value.trim();
  const msg = document.getElementById('spotsMsg');
  if (!town) { msg.textContent = 'Nejdřív napište obec.'; return; }
  if (syncHome() === false) return;
  msg.textContent = 'Hledám místa v okolí…';
  try {
    const g = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=cz,sk&accept-language=cs&q=${encodeURIComponent(town)}`).then((r) => r.json());
    if (!g.length) throw new Error('Obec jsme nenašli. Zkuste jiný název.');
    const lat = +g[0].lat, lon = +g[0].lon;
    const q = `[out:json][timeout:25];(node(around:12000,${lat},${lon})[place~"^(town|village)$"][name];nwr(around:25000,${lat},${lon})[tourism~"^(zoo|theme_park|attraction)$"][name];nwr(around:25000,${lat},${lon})[historic~"^(castle|ruins)$"][name];);out tags center 200;`;
    const d = await overpass(q);
    const dist = (e) => { const la = e.lat ?? e.center?.lat, lo = e.lon ?? e.center?.lon; return (la - lat) ** 2 + ((lo - lon) * 0.64) ** 2; };
    const score = (t) => ({ castle: 3, zoo: 3, theme_park: 3, ruins: 2 }[t.historic || t.tourism] || 1);
    const uniq = (a) => [...new Set(a)];
    const towns = uniq(d.elements.filter((e) => e.tags.place && e.tags.name !== town).sort((a, b) => (a.tags.place === 'town' ? 0 : 1) - (b.tags.place === 'town' ? 0 : 1) || dist(a) - dist(b)).map((e) => e.tags.name)).slice(0, 10);
    const attrs = uniq(d.elements.filter((e) => !e.tags.place).sort((a, b) => score(b.tags) - score(a.tags) || dist(a) - dist(b)).map((e) => e.tags.name)).slice(0, 10);
    const h = S.family.home;
    h.nearOpts = towns; h.near = towns.slice(0, 4);
    h.attrOpts = uniq([...h.attr, ...attrs]); h.attr = h.attr.length ? h.attr : attrs.slice(0, 3);
    save(); render();
    document.getElementById('spotsMsg').textContent = towns.length || attrs.length ? 'Vybraná místa se objeví v pohádkách. Klepnutím je zapnete nebo vypnete.' : 'V okolí jsme nic nenašli. Přidejte místa ručně.';
  } catch (e) {
    msg.innerHTML = `<span class="err">${esc(e.message || 'Hledání se nepovedlo.')} Místa můžete přidat i ručně.</span>`;
  }
}
// veřejné servery Overpass bývají přetížené – zkusíme víc zrcadel, každé s časovým limitem
async function overpass(q) {
  for (const url of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter']) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(15000) });
      if (r.ok) return await r.json();
    } catch (e) { /* další zrcadlo */ }
  }
  throw new Error('Mapový server je teď přetížený.');
}
function syncHome() {
  const t = document.getElementById('town'), i = document.getElementById('inTown');
  if (!t) return;
  const h = S.family.home;
  const town = cleanText(t.value, LIMIT.place);
  const inTown = cleanText(i.value, LIMIT.place + 4);
  if ((town !== h.town || (inTown && inTown !== h.inTown)) && !useChange()) {
    t.value = h.town; i.value = h.inTown;
    const msg = document.getElementById('spotsMsg'); if (msg) msg.innerHTML = `<span class="err">${changesOut}</span>`;
    return false;
  }
  if (town !== h.town) { h.town = town; if (!i.value.trim() || i.dataset.auto) i.value = inTownGuess(h.town); }
  h.inTown = cleanText(i.value, LIMIT.place + 4) || inTownGuess(h.town);
  save();
}

// ---------- Formulář osoby ----------
function personSheet(kind, id) {
  const arr = kind === 'child' ? S.family.children : S.family.parents;
  const p = arr.find((x) => x.id === id) || (kind === 'child' ? { gender: 'm', age: 5, forms: decline('', 'm') } : { role: 'mama', forms: decline('', 'f') });
  ui.edit = { kind, id: p.id || null, gender: p.gender, role: p.role };
  const isChild = kind === 'child';
  $modal.innerHTML = `
    <div class="overlay" data-a="closeModal"><div class="sheet" data-stop>
      <h2>${p.id ? 'Upravit' : 'Přidat'} ${isChild ? 'dítě' : 'člena rodiny'}</h2>
      ${isChild ? `
        <label for="pName">Jak dítěti doma říkáte?</label>
        <input id="pName" maxlength="${LIMIT.name}" value="${esc(p.forms.nom)}" placeholder="např. Toník, Ema, Kubík">
        <label>Je to</label>
        <div class="seg" id="gSeg"><button data-a="gender" data-v="m" class="${p.gender !== 'f' ? 'on' : ''}">Kluk</button><button data-a="gender" data-v="f" class="${p.gender === 'f' ? 'on' : ''}">Holka</button></div>
        <div class="row">
          <div><label for="pAge">Věk</label><select id="pAge">${[2, 3, 4, 5, 6, 7, 8, 9, 10].map((a) => `<option ${a === p.age ? 'selected' : ''}>${a}</option>`).join('')}</select></div>
        </div>
        <label for="pFood">Oblíbené jídlo</label>
        <input id="pFood" maxlength="${LIMIT.item}" value="${esc(p.food || '')}" placeholder="např. palačinky">
        <label for="pAnimal">Oblíbené zvíře</label>
        <input id="pAnimal" maxlength="${LIMIT.item}" value="${esc(p.animal || '')}" placeholder="např. liška">
      ` : `
        <label>Kdo to je</label>
        <div class="seg" id="rSeg">${Object.entries(ROLES).map(([k, r]) => `<button data-a="role" data-v="${k}" class="${p.role === k ? 'on' : ''}">${r.label}</button>`).join('')}</div>
                <label for="pName">Jméno (nepovinné)</label>
        <input id="pName" maxlength="${LIMIT.name}" value="${esc(p.name ? p.forms.nom : '')}" placeholder="např. Petra">
        <p class="note">V pohádce pak zazní třeba „maminka Petra“. Bez jména jen „maminka“.</p>
      `}
      ${changesNote()}
      <details><summary>Skloňování jména (zkontrolujte)</summary>
        <div class="cases">${CASES.map(([k, l]) => `<div><label for="c_${k}">${l}</label><input id="c_${k}" maxlength="${LIMIT.cases}" value="${esc(p.forms[k])}"></div>`).join('')}</div>
      </details>
      <div class="footer-actions">
        <button class="btn" data-a="savePerson">Uložit</button>
        ${p.id ? '<button class="link" data-a="deletePerson">Odebrat</button>' : '<button class="link" data-a="closeModal">Zrušit</button>'}
      </div>
    </div></div>`;
  const nameInput = document.getElementById('pName');
  nameInput.addEventListener('input', refreshCases);
  if (!p.id) nameInput.focus();
}
function editGender() { return ui.edit.kind === 'child' ? ui.edit.gender || 'm' : ROLES[ui.edit.role].g; }
function refreshCases() {
  const forms = decline(document.getElementById('pName').value, editGender());
  CASES.forEach(([k]) => { document.getElementById('c_' + k).value = forms[k]; });
}

function savePerson() {
  const name = cleanName(document.getElementById('pName').value);
  const isChild = ui.edit.kind === 'child';
  if (isChild && !name) { document.getElementById('pName').focus(); return; }
  const forms = {};
  CASES.forEach(([k]) => { forms[k] = cleanName(document.getElementById('c_' + k).value, LIMIT.cases) || name; });
  if (name) forms.nom = name;
  const arr = isChild ? S.family.children : S.family.parents;
  let p = arr.find((x) => x.id === ui.edit.id);
  if (!p && arr.length >= LIMIT[isChild ? 'children' : 'parents']) { closeModal(); return; }
  const next = isChild
    ? { forms, gender: ui.edit.gender || 'm', age: +document.getElementById('pAge').value, food: cleanText(document.getElementById('pFood').value, LIMIT.item), animal: cleanText(document.getElementById('pAnimal').value, LIMIT.item) }
    : { forms, role: ui.edit.role, name: !!name };
  // věk se do textu pohádky nepromítá, ostatní ano
  const story = (o) => o && JSON.stringify([o.forms, o.gender, o.food, o.animal, o.role, o.name]);
  if (story(p) !== story(next) && !useChange()) { document.getElementById('changesMsg').innerHTML = `<span class="err">${changesOut}</span>`; return; }
  if (!p) { p = { id: uid() }; arr.push(p); }
  Object.assign(p, next);
  if (!S.heroIds.length && isChild) S.heroIds = [p.id];
  save(); closeModal(); render();
}

// ---------- Předplatné ----------
// cena předplatného: z obchodu (App Store / Google Play), jinak česká cena; slovenská je v textu u plánu
const PRICE = { text: '129 Kč', store: false };
const WEB_DEMO = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
BILLING.price().then((p) => { if (p) { PRICE.text = p; PRICE.store = true; render(); } });
// zkušební doba 3 dny: v knihovně je vidět její konec a telefon den předem připomene, že se začne platit
const trialWhen = (d) => `${d.getDate()}. ${d.getMonth() + 1}. v ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
async function checkTrial(ask) {
  const t = await BILLING.trial();
  const was = JSON.stringify(ui.trial || null);
  ui.trial = t;
  await BILLING.remind(t, PRICE.text, ask);
  if (JSON.stringify(t) !== was && ui.screen === 'lib' && !document.getElementById('player')) render();
}

// kolik toho předplatné odemkne: počet pohádek a celková délka (stejný výpočet jako minutes, spočítá se jednou)
let libraryStats = null;
function libraryStat() {
  if (!libraryStats || libraryStats.n !== STORIES.length) {
    let sec = 0;
    try {
      const c = ctx(heroes());
      STORIES.forEach((st) => { sec += st.text(c).reduce((a, s) => a + s.t.split(/\s+/).length / 2 + (s.pause || 0) + 1, 0); });
    } catch (e) { /* bez rodiny jen počet */ }
    libraryStats = { n: STORIES.length, hours: Math.floor(sec / 3600) };
  }
  return libraryStats;
}
function paywall() {
  const lib = libraryStat();
  const many = lib.n >= 100 ? `více než ${Math.floor(lib.n / 50) * 50} pohádkám` : `${lib.n} pohádkám`;
  $modal.innerHTML = `
    <div class="overlay" data-a="closeModal"><div class="sheet" data-stop>
      <button class="icon-btn sheet-close" data-a="closeModal" aria-label="Zavřít">${I.close}</button>
      <img class="sheet-mascot" src="${MASCOT.mark}" alt="">
      <h2 style="text-align:center">${APP_NAME} Plus</h2>
      <p class="lead" style="text-align:center">Předplatným získáte přístup k ${many}${lib.hours >= 2 ? `, dohromady přes ${lib.hours}&nbsp;hodin poslechu` : ''}.</p>
      <ul class="perks">
        <li>Všechny pohádky a pravidelně nové</li>
        <li>Pohádky na dobrou noc, do auta i ze života</li>
        <li>Pro jeden účet, až ${LIMIT.children} děti, na všech vašich zařízeních</li>
        <li>Poslech bez internetu: pohádky si stáhnete na cestu</li>
        <li>Brzy i časovač usínání</li>
      </ul>
      <div class="plans">
        <div class="plan on"><div><b>Měsíčně</b><small>${PRICE.text} / měsíc${PRICE.store ? '' : ' (na Slovensku 4,99 €)'} · zrušit můžete kdykoli</small></div></div>
      </div>
      ${BILLING.native || WEB_DEMO ? `<button class="btn cta2" data-a="subscribe"><span>Vyzkoušet 3 dny zdarma,</span><span>pak ${PRICE.text} měsíčně</span></button>` : '<a class="btn" href="../#end">Stáhnout aplikaci Ospalek</a>'}
      <p class="fine" style="text-align:center">Po 3 dnech zdarma ${PRICE.text} měsíčně, dokud předplatné nezrušíte. Pohádky se odemknou hned, proto po zaplacení nelze od smlouvy odstoupit do 14 dnů. Pokračováním souhlasíte s <a href="../obchodni-podminky/" target="_blank" rel="noopener">obchodními podmínkami</a>. Jak chráníme vaše údaje, popisují <a href="../ochrana-osobnich-udaju/" target="_blank" rel="noopener">zásady ochrany osobních údajů</a>.</p>
      ${BILLING.native ? '<p class="fine" style="text-align:center">Platbu vyřizuje App Store nebo Google Play. Zrušit můžete kdykoli v nastavení předplatných svého účtu, nejpozději 24 hodin před koncem období. <a href="#" data-a="restore">Obnovit nákupy</a></p>' : '<p class="fine" style="text-align:center">Na webu se předplatné koupit nedá. Kupuje se v mobilní aplikaci Ospalek pro iPhone a Android přes App Store nebo Google Play. Tady si zatím pustíte 3 pohádky zdarma.</p>'}
      ${SYNC.on && !IOS_APP ? '<p class="fine" style="text-align:center"><a href="#" data-a="codeSheet">Mám kód</a></p>' : ''}
    </div></div>`;
}

// Kód, který odemkne Plus bez platby (recenzenti Google Play a App Store, dárky). Ověří ho server, v aplikaci žádný kód není.
function codeSheet() {
  $modal.innerHTML = `
    <div class="overlay" data-a="closeModal"><div class="sheet" data-stop>
      <button class="icon-btn sheet-close" data-a="closeModal" aria-label="Zavřít">${I.close}</button>
      <img class="sheet-mascot" src="${MASCOT.mark}" alt="">
      <h2 style="text-align:center">Máte kód?</h2>
      <p class="lead" style="text-align:center">Kód od nás odemkne ${APP_NAME} Plus na několik dní, bez platby a bez předplatného.</p>
      <input id="codeIn" maxlength="40" placeholder="Kód" autocomplete="off" autocapitalize="characters" spellcheck="false" style="text-transform:uppercase;text-align:center">
      <p class="fine" style="text-align:center" id="codeMsg"></p>
      <button class="btn" data-a="redeem">Uplatnit kód</button>
    </div></div>`;
  setTimeout(() => document.getElementById('codeIn')?.focus(), 50);
}

// ---------- Přehrávač ----------
let P = null;
let csVoice = null;
function loadVoices() {
  if (!('speechSynthesis' in window)) return;
  const v = speechSynthesis.getVoices();
  csVoice = v.find((x) => /^cs/i.test(x.lang)) || null;
}
if ('speechSynthesis' in window) { speechSynthesis.onvoiceschanged = loadVoices; loadVoices(); }

function speak(text, onend) {
  if (!csVoice) {
    const t = setTimeout(onend, Math.max(2500, text.split(/\s+/).length * 400));
    return () => clearTimeout(t);
  }
  const u = new SpeechSynthesisUtterance(text);
  u.voice = csVoice; u.lang = csVoice.lang; u.rate = 0.92; u.pitch = 1.05;
  let done = false;
  u.onend = u.onerror = () => { if (!done) { done = true; onend(); } };
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
  return () => { done = true; speechSynthesis.cancel(); };
}

// --- hlas ElevenLabs přes tts-worker: každý odstavec zvlášť, hotové nahrávky si pamatujeme ---
// mood = nálada pohádky: Worker podle ní přidá stejnou značku přednesu jako u hotových nahrávek vět
const cloudClips = new Map();
// požadavek na Worker se po 25 s zruší – zaseknutý by jinak zůstal v mezipaměti a pohádka by stála
function fetchLimited(url, opts, ms = 25000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  return fetch(url, { ...opts, signal: ac.signal }).finally(() => clearTimeout(t));
}
function cloudClip(text, mood) {
  const id = (mood || '') + '|' + text;
  if (!cloudClips.has(id)) {
    // věta už stažená v zařízení (offline.js), jinak z Workeru a hned ji uložit na příště i na cestu
    const p = OFFLINE.get(id)
      .then((buf) => buf || fetchLimited(TTS_URL + '/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice: 'jana', ...(mood ? { mood } : {}) }) })
        .catch(() => { throw Object.assign(new Error('Bez připojení k internetu se hlas nenačte.'), { status: 0 }); })
        .then(async (r) => {
          if (!r.ok) throw Object.assign(new Error((await r.json().catch(() => ({}))).error || 'Hlas se nepodařilo načíst.'), { status: r.status });
          const b = await r.arrayBuffer();
          await OFFLINE.put(id, b);
          return b;
        }))
      .then((b) => URL.createObjectURL(new Blob([b], { type: 'audio/mpeg' })));
    p.catch(() => cloudClips.delete(id)); // chybu příště zkusit znovu
    cloudClips.set(id, p);
  }
  return cloudClips.get(id);
}
// Vypravěčka pohádek. Výběr hlasu v přehrávači není, hlas (ElevenLabs „Jana“) určuje tts-worker.
const NARRATOR = 'teta Terezka';
// Síťová chyba (TypeError: „Failed to fetch“, na iOS „Load failed“) je anglicky, tu nezobrazujeme. České chyby z workeru ano.
const voiceFail = (e) => `${e instanceof TypeError ? '' : e.message + ' '}Teta Terezka se teď nenačetla, zatím čte náhradní hlas.`;
// stejné rozhraní jako speak(): zavolá onend, vrací funkci pro zastavení; při chybě dočte hlasem prohlížeče
function cloudSpeak(text, onend) {
  let stopped = false, fallback = null;
  const el = P.cloudEl;
  cloudClip(text).then((url) => {
    if (stopped) return;
    el.onended = () => { if (!stopped) onend(); };
    el.src = url;
    el.play().catch(() => {});
  }).catch((e) => {
    if (stopped) return;
    P.cloudFailed = true;
    document.getElementById('voicewarn').textContent = voiceFail(e);
    fallback = speak(text, onend);
  });
  return () => { stopped = true; el.onended = null; el.pause(); fallback && fallback(); };
}

// ---------- Poslech bez internetu (offline.js, sw.js) ----------
const lineId = (t, mood) => (mood || '') + '|' + t;
// co pohádka pro dané hrdiny potřebuje: věty s rodinou (IndexedDB) a soubory (společné věty, obálka)
async function storyNeeds(st, hs = heroes()) {
  await voiceLines.ready;
  const lines = VOICE_LINES.planStory(st.text(ctx(hs))).flatMap((p) => p.lines);
  return {
    family: [...new Set(lines.filter((l) => !voiceLines.has(l)).map((l) => l.t))],
    files: [...new Set([...lines.filter((l) => voiceLines.has(l)).map(voiceLines.url), ...(st.cover.img ? [coverImg(st, hs)] : [])])],
  };
}
const offlineMemo = new Map(); // pohádka + hrdinové → Promise<true/false>
const memoKey = (st, hs) => st.id + '|' + hs.map((k) => k.id).join(',');
function storyOffline(st, hs = heroes()) {
  const k = memoKey(st, hs);
  if (!offlineMemo.has(k)) {
    offlineMemo.set(k, (async () => {
      const n = await storyNeeds(st, hs);
      const have = await OFFLINE.keys();
      if (!n.family.every((t) => have.has(lineId(t, st.mood)))) return false;
      for (const f of n.files) if (!(await OFFLINE.hasFile(f))) return false;
      return true;
    })().catch(() => false));
  }
  return offlineMemo.get(k);
}
// stáhne vše, co pohádka potřebuje; věty rodiny jdou přes cloudClip, takže se zaplatí jen jednou
async function downloadStory(st, onprog) {
  const n = await storyNeeds(st);
  const jobs = [...n.family.map((t) => () => cloudClip(t, st.mood)), ...n.files.map((f) => () => OFFLINE.saveFile(f))];
  const run = async (job) => {
    for (let a = 1; ; a++) {
      try { return await job(); } catch (e) {
        // limit nových vět ve Workeru (120 za minutu) – chvilku počkat
        if (e.status === 429 && a < 4) { await new Promise((r) => setTimeout(r, 20000)); continue; }
        // zakolísání sítě: ještě dvakrát zkusit
        if (navigator.onLine && e.status !== 429 && a < 3) { await new Promise((r) => setTimeout(r, 1500 * a)); continue; }
        throw navigator.onLine ? e : new Error('Bez internetu se pohádka stáhnout nedá.');
      }
    }
  };
  let done = 0;
  const q = [...jobs];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (q.length) { await run(q.shift()); onprog && onprog(++done, jobs.length); }
  }));
  offlineMemo.delete(memoKey(st, heroes()));
}
// věty se jmény, které už žádná pohádka nepotřebuje (změna jména, smazané dítě), ze zařízení smazat
async function pruneOffline() {
  try {
    await voiceLines.ready;
    const kids = S.family.children, need = new Set();
    for (let m = 1; m < 1 << kids.length; m++) {
      const c = kids.filter((_, i) => m & (1 << i));
      if (c.length > LIMIT.heroes) continue;
      STORIES.forEach((st) => VOICE_LINES.planStory(st.text(ctx(c))).forEach((p) => p.lines.forEach((l) => need.add(lineId(l.t, st.mood)))));
    }
    await OFFLINE.remove([...(await OFFLINE.keys())].filter((k) => !need.has(k)));
  } catch (e) { /* příště znovu */ }
}
// značky Offline v knihovně; bez internetu nestažené pohádky zešednou
function markOffline() {
  const hs = heroes();
  document.querySelectorAll('.card[data-id]').forEach(async (card) => {
    const st = STORIES.find((s) => s.id === card.dataset.id);
    const ok = unlocked(st) && (await storyOffline(st, hs));
    const b = card.querySelector('.badge.off');
    if (b) b.hidden = !ok;
    card.classList.toggle('dim', !navigator.onLine && !ok);
  });
}
async function offlineStats() {
  const el = document.getElementById('offStat');
  if (!el) return;
  const list = STORIES.filter(unlocked);
  const ok = (await Promise.all(list.map((st) => storyOffline(st)))).filter(Boolean).length;
  if (el.dataset.busy) return;
  el.textContent = `Staženo ${ok} z ${list.length} pohádek`;
}
function notOffline() {
  $modal.innerHTML = `<div class="overlay" data-a="closeModal"><div class="sheet" data-stop>
    <img class="sheet-mascot" src="${MASCOT.trip}" alt="">
    <h2 style="text-align:center">Tahle pohádka není stažená</h2>
    <p class="lead" style="text-align:center">Bez internetu jdou pustit jen pohádky se značkou Offline. Až budete zase online, otevřete pohádku a klepněte na <b>Stáhnout na cestu</b>.</p>
    <button class="btn" data-a="closeModal">Rozumím</button>
  </div></div>`;
}
const dlLabel = (ok) => (ok ? '✓ Staženo' : `${I.down} Stáhnout na cestu`);

// ---------- Co jsme už slyšeli (jen v zařízení, S.history) ----------
const heardCount = (id) => (S.history || []).filter((x) => x.id === id && x.done).length;
function logListen(done) {
  if (!P || P.logged || (!done && P.i === 0)) return;
  P.logged = true;
  const c = ctx(heroes());
  S.history = [{ id: P.st.id, title: P.st.title(c), who: c.H, at: Date.now(), done, part: done ? 1 : Math.round((P.i / P.segs.length) * 100) / 100 }, ...(S.history || [])].slice(0, 200);
  store.set(S); // historie zůstává v zařízení, na server se neposílá
}

function openPlayer(st, queue) {
  const c = ctx(heroes());
  // nahrávky z ElevenLabs existují jen pro rodinu, pro kterou byly vygenerované
  const rec = RECORDINGS[st.id] && RECORDINGS[st.id].hero === c.H ? RECORDINGS[st.id] : null;
  const segs = st.text(c);
  // skládaný hlas (voice-player.js): jde, když jsou namluvené všechny věty, nebo chybějící dotáhne tts-worker
  const plan = VOICE_LINES.planStory(segs);
  const linesOk = voiceLines.missing(plan) === 0 || !!TTS_URL;
  P = { st, segs, plan, i: 0, playing: false, stop: null, showText: true, rec, voice: linesOk ? 'lines' : rec ? rec.voices[0].id : TTS_URL ? 'cloud' : 'browser', audio: null, ready: false, prog: 0 };
  // pořadí pohádek pro Předchozí / Další ze zamčené obrazovky: polička, ze které se pohádka otevřela
  P.queue = queue && queue.includes(st.id) ? queue : STORIES.map((s) => s.id);
  // jeden přehrávač vytvořený při kliknutí – iOS pak pustí i další odstavce bez dalšího klepnutí
  if (TTS_URL) P.cloudEl = new Audio();
  $app.insertAdjacentHTML('beforeend', `
    <div class="player" id="player" style="--c:${catColor(st)}">
      <div class="inner">
        <div class="bar"><button class="icon-btn" data-a="closePlayer" aria-label="Zavřít">${I.close}</button><button class="chip dl" data-a="download" id="dlBtn">${dlLabel(false)}</button><div class="pbtns">${favBtn(st.id, 'icon-btn pfav')}<button class="icon-btn" data-a="toggleText" aria-label="Text">${I.book}</button></div></div>
        <div class="pcover">${st.cover.img ? `<img src="${coverImg(st, heroes())}" alt="">` : st.cover.emoji}</div>
        <h2>${esc(st.title(c))}</h2>
        <div class="ptext" id="ptext">${P.segs.map((s, i) => `<p data-i="${i}">${esc(s.t)}</p>`).join('')}<div class="self-end"><img src="${st.cats.includes('noc') ? MASCOT.sleep : MASCOT.head}" alt=""><h2>${st.cats.includes('noc') ? 'Dobrou noc' : 'Konec'}</h2></div></div>
        <div class="waiting" id="waiting"></div>
        <div class="controls">
          <button class="skip" data-a="prevSeg" aria-label="Předchozí">${I.prev}</button>
          <button class="play" data-a="playPause" id="playBtn" aria-label="Přehrát">${I.play}</button>
          <button class="skip" data-a="nextSeg" aria-label="Další">${I.next}</button>
        </div>
        <div class="seg bgmode" role="group" aria-label="Zvuk v pozadí">
          <button data-a="bgOn" aria-pressed="${ambience.bedOn}" class="${ambience.bedOn ? 'on' : ''}">${I.music} Se zvukem</button>
          <button data-a="bgOff" aria-pressed="${!ambience.bedOn}" class="${ambience.bedOn ? '' : 'on'}">${I.mic} Bez hudby</button>
        </div>
        <div class="mix${ambience.bedOn ? '' : ' off'}" id="bgMix">Hlasitost pozadí <input type="range" id="musicVol" min="0" max="1" step="0.05" value="${ambience.musicVol}" aria-label="Hlasitost zvuku v pozadí"></div>
        <button class="readswitch" data-a="readSelf" id="readSwitch">${I.book} Raději ji přečtu já</button>
        <div class="voicewarn" id="voicewarn">${linesOk || rec || TTS_URL || BILLING.native ? '' : csVoice ? 'Ukázkový hlas prohlížeče. Ve finální verzi čte realistický hlas (ElevenLabs).' : 'Prohlížeč nemá český hlas – text se jen zvýrazňuje. Ve finální verzi čte hlas ElevenLabs.'}</div>
      </div>
    </div>`);
  document.getElementById('musicVol').addEventListener('input', (e) => ambience.setMusicVolume(+e.target.value));
  ambience.preloadBackground(st);
  document.getElementById('ptext').addEventListener('scroll', selfReadEnd, { passive: true });
  highlight();
  prepareStory();
}

// ---------- celá pohádka připravená předem ----------
// Přehrát jde až ve chvíli, kdy je v zařízení všechno, co pohádka potřebuje (věty, věty se jménem,
// obálka, hudba v pozadí). Během poslechu se pak nic nestahuje: žádné ticho uprostřed, když se síť
// zadrhne, a hraje to i se zhasnutým displejem, kdy Android přístup k internetu omezuje.
// Stažené zůstane v zařízení (jako Stáhnout na cestu), příště se pohádka otevře hned.
const PREP_MSG = 'Připravuji celou pohádku, aby se nikde nezadrhla…';
async function prepareStory() {
  const p = P;
  if (!p) return;
  const st = p.st;
  const live = () => P === p;
  const w = () => document.getElementById('waiting');
  p.loadErr = false;
  const finish = (saved) => {
    if (!live()) return;
    p.ready = true;
    p.prog = 1;
    if (w() && w().textContent === PREP_MSG) w().textContent = '';
    const b = document.getElementById('dlBtn');
    if (b && saved) { b.innerHTML = dlLabel(true); b.classList.add('on'); }
    highlight();
    if (p.autoplay) { p.autoplay = false; playPause(); }
  };
  // jiný hlas než skládaný (nahrávka, hlas prohlížeče) se nepřipravuje
  if (p.voice !== 'lines') return finish(false);
  const beds = Promise.race([ambience.bedsReady(st), new Promise((r) => setTimeout(r, 15000))]);
  if (await storyOffline(st)) { await beds; return finish(true); }
  if (!live()) return;
  if (w()) w().textContent = PREP_MSG;
  highlight();
  try {
    await downloadStory(st, (d, n) => { if (live() && !p.ready) { p.prog = (d / n) * 0.97; playBtnPrep(document.getElementById('playBtn')); } });
    await beds;
    finish(true);
  } catch (e) {
    if (!live()) return;
    p.loadErr = true;
    if (w()) w().textContent = navigator.onLine ? 'Pohádku se nepodařilo načíst celou. Klepněte na tlačítko a zkusíme to znovu.' : 'Bez internetu se pohádka nenačte. Připojte se a klepněte na tlačítko.';
    highlight();
  }
}
// tlačítko Přehrát během přípravy: průběh v procentech, po chybě Zkusit znovu
function playBtnPrep(b) {
  if (P.ready) { b.disabled = false; b.classList.remove('loading'); return false; }
  b.classList.add('loading');
  if (P.loadErr) {
    b.disabled = false;
    b.innerHTML = I.replay;
    b.setAttribute('aria-label', 'Zkusit načíst znovu');
  } else {
    b.disabled = true;
    b.style.setProperty('--p', P.prog || 0);
    b.innerHTML = `<span class="pct">${Math.round((P.prog || 0) * 100)} %</span>`;
    b.setAttribute('aria-label', 'Pohádka se načítá');
  }
  return true;
}

// posouvá jen textem pohádky; scrollIntoView by posunul i celou stránku a v iOS aplikaci
// by horní lišta přehrávače zajela pod stavový řádek
function scrollInText(el, center) {
  const box = document.getElementById('ptext');
  const off = el.getBoundingClientRect().top - box.getBoundingClientRect().top;
  box.scrollBy({ top: center ? off - (box.clientHeight - el.offsetHeight) / 2 : off, behavior: 'smooth' });
}

function highlight() {
  document.querySelectorAll('#ptext p').forEach((p) => {
    const i = +p.dataset.i;
    p.className = i === P.i ? 'now' : i < P.i ? 'done' : '';
    if (i === P.i) scrollInText(p, true);
  });
  const b = document.getElementById('playBtn');
  if (!playBtnPrep(b)) {
    b.innerHTML = P.playing ? I.pause : I.play;
    b.setAttribute('aria-label', P.playing ? 'Pozastavit' : 'Přehrát');
  }
  syncMedia();
}

// ---------- zamčená obrazovka a oznámení (media.js) ----------
// sousední odemčená pohádka ve frontě (d = 1 další, -1 předchozí)
function neighbour(d) {
  if (!P) return null;
  const q = P.queue;
  for (let k = q.indexOf(P.st.id) + d; k >= 0 && k < q.length; k += d) {
    const st = STORIES.find((s) => s.id === q[k]);
    if (st && unlocked(st)) return st;
  }
  return null;
}
// ovládání se ukáže, až pohádka poprvé začne hrát, a pak drží stav přehrávače
function syncMedia() {
  if (!P || !P.started) return;
  const hs = heroes();
  MEDIA.update({
    title: P.st.title(ctx(hs)),
    subtitle: `Ospalek · čte ${NARRATOR}`,
    cover: P.st.cover.img ? coverImg(P.st, hs) : null,
    playing: P.playing,
    hasPrev: !!neighbour(-1),
    hasNext: !!neighbour(1),
  });
}
// přepnutí na jinou pohádku (i se zhasnutým displejem): rovnou hraje
async function switchStory(d) {
  const st = neighbour(d);
  if (!st) return;
  if (!navigator.onLine && !(await storyOffline(st))) return;
  const queue = P.queue;
  closePlayer(true);
  openPlayer(st, queue);
  playPause();
}
MEDIA.onAction((a) => {
  if (!P) return;
  if (a === 'play' && !P.playing) playPause();
  else if (a === 'pause' && P.playing) playPause();
  else if (a === 'toggle') playPause();
  else if (a === 'next' || a === 'prev') switchStory(a === 'next' ? 1 : -1);
  else if (a === 'stop') closePlayer();
});

// ---------- pokračování po pádu ----------
// Když Android ukončí WebView (nejčastěji kvůli paměti), MainActivity aplikaci načte znovu (jen mobil).
// Rozehraná pohádka si proto pamatuje odstavec; po znovunačtení se otevře na stejném místě.
const RESUME_KEY = 'ospalek.resume';
const NATIVE_APP = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
function resumeMark() {
  if (!NATIVE_APP || !P) return;
  try { localStorage.setItem(RESUME_KEY, JSON.stringify({ id: P.st.id, i: P.i, at: Date.now() })); } catch (e) { /* plné úložiště */ }
}
function resumeClear() { try { localStorage.removeItem(RESUME_KEY); } catch (e) { /* nic */ } }
function resumeAfterReload() {
  if (!NATIVE_APP) return;
  let r = null;
  try { r = JSON.parse(localStorage.getItem(RESUME_KEY)); } catch (e) { /* nic */ }
  resumeClear();
  // jen čerstvě přerušená pohádka (pár minut); jinak by se otevírala i druhý den
  if (!r || !r.id || Date.now() - r.at > 10 * 60 * 1000 || !S.onboarded || !S.family.children.length) return;
  const st = STORIES.find((s) => s.id === r.id);
  if (!st || !unlocked(st)) return;
  openPlayer(st);
  if (!P) return;
  P.i = Math.max(0, Math.min(+r.i || 0, P.segs.length - 1));
  highlight();
  document.getElementById('waiting').textContent = 'Aplikace se musela znovu načíst. Klepněte na Přehrát a pokračujeme.';
}

function playSeg() {
  if (!P) return;
  P.stop && P.stop();
  document.getElementById('waiting').textContent = '';
  if (P.i >= P.segs.length) return theEnd();
  resumeMark();
  highlight();
  const seg = P.segs[P.i];
  if (seg.sfx) ambience.sfx(seg.sfx);
  const token = (P.token = (P.token || 0) + 1);
  const go = () => { if (P && P.playing && P.token === token) { P.i++; playSeg(); } };
  const cloud = P.voice === 'cloud' && !P.cloudFailed;
  const lines = P.voice === 'lines' && !P.cloudFailed;
  const fallback = TTS_URL ? (t) => cloudClip(t, P.st.mood) : null;
  // další odstavec se připravuje, zatímco tenhle hraje
  if (cloud && P.segs[P.i + 1]) cloudClip(P.segs[P.i + 1].t).catch(() => {});
  if (lines) voiceLines.prefetch(P.plan[P.i + 1], fallback);
  const after = () => {
    if (!seg.pause) return setTimeout(go, 500);
    ambience.duck(false); // čas na odpověď: pozadí zase nahlas
    P.stop = waitAnswer(seg.pause, go);
  };
  const delay = setTimeout(() => {
    ambience.duck(true);
    P.stop = lines
      ? voiceLines.speak(P.plan[P.i], () => { P.retries = 0; after(); }, { fallback, onerror: (e) => voiceStalled(e, token) })
      : (cloud ? cloudSpeak : speak)(seg.t, after);
  }, seg.sfx ? 700 : 150);
  P.stop = () => clearTimeout(delay);
}

// Hlas odstavce se nenačetl: dvakrát to zkusit znovu, pak pohádku pozastavit se srozumitelnou zprávou.
// Dřív se tiše přepnulo na hlas prohlížeče – v aplikaci pro Android žádný český není, takže čtení
// uprostřed ztichlo a hudba hrála dál.
function voiceStalled(e, token) {
  if (!P || !P.playing || P.token !== token) return;
  const w = document.getElementById('waiting');
  P.retries = (P.retries || 0) + 1;
  if (P.retries <= 2) {
    w.textContent = 'Hlas se načítá, chvilku strpení…';
    const t = setTimeout(() => { if (P && P.playing && P.token === token) playSeg(); }, P.retries * 2500);
    P.stop = () => clearTimeout(t);
    return;
  }
  P.retries = 0;
  playPause(); // pozastavit i hudbu
  document.getElementById('waiting').textContent = navigator.onLine
    ? 'Čtení se zadrhlo. Klepněte na Přehrát a pokračujeme od tohoto odstavce.'
    : 'Jste bez internetu. Až budete zase online, klepněte na Přehrát.';
}

// --- nahraný hlas (ElevenLabs) ---
const recVoice = () => P.rec && P.rec.voices.find((v) => v.id === P.voice);
// celý soubor do paměti – přetáčení pak funguje i na jednoduchém serveru bez podpory Range
const recBlob = (v) => (v.blob = v.blob || fetch(v.src).then((r) => r.blob()).then((b) => URL.createObjectURL(b)));
async function playRec() {
  const v = recVoice();
  if (!P.audio || P.audioVoice !== v.id) {
    P.audio && P.audio.pause();
    const url = await recBlob(v);
    if (!P || !P.playing || recVoice() !== v) return;
    P.audio = new Audio(url);
    P.audioVoice = v.id;
    P.audio.ontimeupdate = onRecTime;
    P.audio.onended = () => { P.i = P.segs.length; theEnd(); };
    const start = v.starts[P.i] || 0;
    await new Promise((ok) => P.audio.addEventListener('loadedmetadata', ok, { once: true }));
    P.audio.currentTime = start;
    if (P.segs[P.i].sfx) ambience.sfx(P.segs[P.i].sfx);
  }
  if (P.audio.ended) P.audio.currentTime = 0;
  P.audio.play();
  ambience.duck(true);
  highlight();
}
function onRecTime() {
  const v = recVoice();
  if (!v || P.waiting) return;
  const t = P.audio.currentTime;
  let i = 0;
  v.starts.forEach((s, k) => { if (t >= s - 0.05) i = k; });
  if (i !== P.i) {
    const prev = P.segs[P.i];
    if (P.playing && i === P.i + 1 && prev.pause && P.pausedAt !== P.i) {
      // nahrávka je souvislá – pauzu na odpověď udělá přehrávač
      P.pausedAt = P.i;
      P.audio.pause();
      P.audio.currentTime = v.starts[i];
      P.waiting = true;
      ambience.duck(false);
      P.stop = waitAnswer(prev.pause, () => { P.waiting = false; ambience.duck(true); P.audio.play(); });
      return;
    }
    P.i = i;
    if (P.playing && P.segs[i].sfx) ambience.sfx(P.segs[i].sfx);
    highlight();
  }
}
function stopVoice() {
  P.token = (P.token || 0) + 1;
  P.waiting = false;
  P.stop && P.stop();
  P.audio && P.audio.pause();
  P.cloudEl && P.cloudEl.pause();
}

// pauza na odpověď u hádanek – vrací funkci, která odpočet zruší
function waitAnswer(sec, done) {
  let left = sec;
  const w = document.getElementById('waiting');
  w.textContent = `Čas na odpověď… ${left}`;
  const iv = setInterval(() => { left--; w.textContent = left > 0 ? `Čas na odpověď… ${left}` : ''; if (left <= 0) { clearInterval(iv); done(); } }, 1000);
  return () => { clearInterval(iv); w.textContent = ''; };
}

function playPause() {
  if (!P) return;
  if (!P.ready && !P.playing) {
    // po chybě klepnutí zkusí načíst znovu; jinak (zamčená obrazovka, další pohádka) se spustí po načtení
    if (P.loadErr) { P.autoplay = true; prepareStory(); } else P.autoplay = true;
    return;
  }
  if (P.playing) {
    P.playing = false;
    stopVoice();
    ambience.stopBackground(true);
    highlight();
  } else {
    P.playing = true;
    P.started = true;
    if (P.i >= P.segs.length) { P.i = 0; P.logged = false; }
    if (!P.sync || P.sync.done) P.sync = SYNC.playStart(P.st, S);
    ambience.startBackground(P.st);
    document.querySelector('.the-end')?.remove();
    document.querySelector('.end-rate')?.remove();
    recVoice() ? playRec() : playSeg();
  }
}

function jump(d) {
  P.i = Math.max(0, Math.min(P.segs.length - 1, P.i + d));
  P.pausedAt = null;
  const v = recVoice();
  if (v && P.audio) { P.audio.currentTime = v.starts[P.i]; highlight(); } else if (P.playing && !v) playSeg(); else highlight();
}

function theEnd() {
  resumeClear();
  P.playing = false;
  logListen(true);
  // dohraná pohádka je teď celá v zařízení (věty i soubory se uložily při přehrávání)
  offlineMemo.delete(memoKey(P.st, heroes()));
  SYNC.playEnd(P.sync, true);
  ambience.duck(false);
  ambience.stopBackground(false); // pomalé ztlumení
  const bedtime = P.st.cats.includes('noc');
  document.getElementById('ptext').insertAdjacentHTML('beforeend', `<div class="the-end"><img src="${bedtime ? MASCOT.sleep : MASCOT.head}" alt=""><h2>${bedtime ? 'Dobrou noc' : 'Konec'}</h2></div>`);
  // hodnocení pod textem (ne v něm: text má nahoře a dole průhledný přechod a posouvá se)
  document.getElementById('ptext').insertAdjacentHTML('afterend', rateHtml(P.st).replace('class="rate"', 'class="rate end-rate"'));
  scrollInText(document.querySelector('.the-end'), false);
  document.getElementById('playBtn').innerHTML = I.replay;
  syncMedia();
}

// „Raději ji přečtu já“: rodič čte sám, přehrávač ukáže jen celý text pohádky. Je to vedlejší volba –
// každá pohádka se otevře tak, že čte teta Terezka, a hlavní je tlačítko Přehrát.
function setReadSelf(on) {
  if (!P) return;
  if (on && P.playing) playPause(); // zastavit hlas i hudbu
  P.self = on;
  const pl = document.getElementById('player');
  pl.classList.toggle('self', on);
  const sw = document.getElementById('readSwitch');
  sw.dataset.a = on ? 'readVoice' : 'readSelf';
  sw.innerHTML = on ? `${I.mic} Ať čte ${NARRATOR}` : `${I.book} Raději ji přečtu já`;
  document.getElementById('ptext').classList.remove('hide');
  if (on) document.getElementById('ptext').scrollTo({ top: 0 });
  else highlight();
}
// dočteno až na konec textu = pohádka se počítá jako dohraná (Co jsme už slyšeli)
function selfReadEnd(e) {
  if (!P || !P.self || P.logged) return;
  const box = e.target;
  if (box.scrollTop + box.clientHeight >= box.scrollHeight - 40) {
    P.i = P.segs.length; logListen(true);
    const end = box.querySelector('.self-end');
    if (end && !end.querySelector('.rate')) end.insertAdjacentHTML('beforeend', rateHtml(P.st));
  }
}

// ---------- hodnocení po dohrání ----------
// Odpověď se uloží v zařízení (S.ratings) a odešle ke stejnému záznamu poslechu (sync.js → plays.rating).
// Průměr po čase ukážeme u pohádek a v administraci (admin_story_ratings).
const RATES = [
  { v: 1, img: '../brand/hodnoceni/mracek.webp', label: 'Nic moc' },
  { v: 2, img: '../brand/hodnoceni/hvezda.webp', label: 'Líbila' },
  { v: 3, img: '../brand/hodnoceni/srdce.webp', label: 'Skvělá' },
];
function rateHtml(st) {
  const mine = (S.ratings || {})[st.id];
  return `<div class="rate" data-story="${esc(st.id)}"><p class="rate-q">Jak se vám pohádka líbila?</p><div class="rate-opts">${RATES.map((r) => `<button class="rate-btn${mine === r.v ? ' on' : ''}" data-a="rate" data-v="${r.v}" aria-pressed="${mine === r.v}"><img src="${r.img}" alt=""><span>${r.label}</span></button>`).join('')}</div><p class="rate-thanks"${mine ? '' : ' hidden'}>Děkujeme! Pomůžete nám vybírat další pohádky.</p></div>`;
}
function rate(el) {
  if (!P) return;
  const v = +el.dataset.v;
  S.ratings = { ...(S.ratings || {}), [P.st.id]: v };
  store.set(S);
  SYNC.rate(P.sync, v);
  const box = el.closest('.rate');
  box.querySelectorAll('.rate-btn').forEach((b) => { const on = b === el; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  box.querySelector('.rate-thanks').hidden = false;
}

// „Se zvukem“ / „Bez hudby“: volbu si pamatuje audio.js (localStorage)
function setBackground(on) {
  ambience.setBackgroundOn(on);
  document.querySelectorAll('.bgmode button').forEach((b) => {
    const sel = (b.dataset.a === 'bgOn') === on;
    b.classList.toggle('on', sel);
    b.setAttribute('aria-pressed', sel);
  });
  document.getElementById('bgMix').classList.toggle('off', !on); // jen skrýt, ať tlačítka neposkočí
  if (!P || !P.playing) return;
  if (on) { ambience.startBackground(P.st); ambience.duck(true); } else ambience.stopBackground(true);
}

// keepMedia: přepnutí na další pohádku – oznámení na zamčené obrazovce nezmizí, jen se přepíše
function closePlayer(keepMedia) {
  resumeClear();
  if (P) { SYNC.playEnd(P.sync, false, P.i / P.segs.length); logListen(false); stopVoice(); P = null; }
  if (keepMedia !== true) MEDIA.stop();
  if (ui.screen === 'lib' || ui.screen === 'history') render();
  ambience.stopBackground(true);
  document.getElementById('player')?.remove();
}

// ---------- Akce ----------
const closeModal = () => { $modal.innerHTML = ''; ui.edit = null; };
const actions = {
  // Bez přihlášení: rodina má anonymní účet (sync.js), předplatné patří k účtu v obchodě (Obnovit nákupy na dalším zařízení).
  start: () => { S.user = { provider: 'device' }; save(); go(S.onboarded ? 'lib' : 'onb'); },
  next: () => { ui.step++; render(); },
  prev: () => { syncHome(); ui.step--; render(); },
  finish: () => { syncHome(); S.onboarded = true; save(); go('lib'); },
  homeNext: () => { syncHome(); ui.step++; render(); },
  // připomínka: v onboardingu dokončí nastavení, jinde jen přepne stav
  remindYes: async (el) => {
    if (el.disabled) return;
    el.disabled = true;
    saveTitles(true);
    const r = await DAILY.enable();
    S.notify = r === 'ok' ? true : S.notify;
    if (r === 'denied') S.notify = false;
    store.set(S);
    if (ui.screen === 'onb') {
      if (r === 'ok') return actions.finish();
      el.disabled = false;
      el.outerHTML = '<button class="btn" data-a="finish">Pokračovat na pohádky</button>';
      document.getElementById('remindMsg').innerHTML = `<span class="err">${r === 'denied' ? 'Upozornění jsou v prohlížeči zakázaná. Povolit je jde později v nastavení telefonu, pak připomínku zapnete v nastavení Ospalka.' : 'Připomínku se teď nepodařilo zapnout. Zkuste to později v nastavení.'}</span>`;
      return;
    }
    if (r === 'error') { el.disabled = false; const m = document.getElementById('remindMsg'); if (m) m.innerHTML = '<span class="err">Připomínku se teď nepodařilo zapnout. Zkuste to za chvíli znovu.</span>'; return; }
    render();
  },
  remindNo: () => { S.notify = false; store.set(S); if (ui.screen === 'onb') actions.finish(); else render(); },
  remindOff: async () => { S.notify = false; store.set(S); await DAILY.disable(); render(); },
  addPerson: (el) => personSheet(el.dataset.kind),
  editPerson: (el) => personSheet(el.dataset.kind, el.dataset.id),
  gender: (el) => { ui.edit.gender = el.dataset.v; el.parentNode.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el)); refreshCases(); },
  role: (el) => { ui.edit.role = el.dataset.v; el.parentNode.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el)); refreshCases(); },
  savePerson,
  deletePerson: () => {
    const k = ui.edit.kind === 'child' ? 'children' : 'parents';
    S.family[k] = S.family[k].filter((x) => x.id !== ui.edit.id);
    S.heroIds = S.heroIds.filter((id) => id !== ui.edit.id);
    save(); closeModal(); render();
  },
  closeModal: (el, e) => { if (e.target.closest('[data-stop]') && el.classList.contains('overlay')) return; closeModal(); },
  findSpots,
  toggleSpot: (el) => {
    syncHome();
    const h = S.family.home; const kind = el.dataset.kind;
    const name = h[kind + 'Opts'][+el.dataset.i];
    if (!h[kind].includes(name) && h[kind].length >= LIMIT.spots) return;
    h[kind] = h[kind].includes(name) ? h[kind].filter((x) => x !== name) : [...h[kind], name];
    save(); render();
  },
  addSpot: () => {
    syncHome();
    const v = cleanText(document.getElementById('addSpot').value, LIMIT.place);
    if (!v) return;
    const h = S.family.home;
    if (h.attr.length >= LIMIT.spots && !h.attr.includes(v)) { document.getElementById('spotsMsg').textContent = `Vybraných může být nejvýš ${LIMIT.spots} výletních míst. Nějaké nejdřív vypněte.`; return; }
    if (!h.attr.includes(v) && !useChange()) { document.getElementById('spotsMsg').innerHTML = `<span class="err">${changesOut}</span>`; return; }
    h.attrOpts = [v, ...h.attrOpts.filter((x) => x !== v)]; h.attr = [v, ...h.attr.filter((x) => x !== v)];
    save(); render();
  },
  hero: (el) => {
    // přepínání hrdinů – aspoň jeden musí zůstat vybraný
    const ids = heroes().map((k) => k.id);
    const id = el.dataset.id;
    // a nejvýš LIMIT.heroes najednou (každá kombinace hrdinů jsou nové věty k namluvení)
    S.heroIds = ids.includes(id) ? (ids.length > 1 ? ids.filter((x) => x !== id) : ids) : ids.length < LIMIT.heroes ? [...ids, id] : ids;
    save(); render();
  },
  shelf: (el) => { ui.libY = window.scrollY; ui.shelf = el.dataset.id; ui.ageOnly = false; ui.unheard = false; go('lib'); },
  shelfBack: () => { ui.shelf = null; render(); window.scrollTo(0, ui.libY || 0); },
  // hvězdička: přidá nebo odebere z oblíbených; v přehrávači jen přepne tlačítko (knihovna se překreslí po zavření)
  fav: (el) => {
    const id = el.dataset.id;
    S.favs = isFav(id) ? S.favs.filter((x) => x !== id) : [id, ...(S.favs || [])];
    store.set(S);
    if (document.getElementById('player')) {
      document.querySelectorAll(`.pfav[data-id="${id}"]`).forEach((b) => b.outerHTML = favBtn(id, 'icon-btn pfav'));
    } else render();
  },
  age: () => { ui.ageOnly = !ui.ageOnly; render(); },
  open: async (el) => {
    const st = STORIES.find((s) => s.id === el.dataset.id);
    if (!st) return;
    if (!unlocked(st)) return paywall();
    if (!navigator.onLine && !(await storyOffline(st))) return notOffline();
    const row = el.closest('.shelf-row, .grid');
    openPlayer(st, row ? [...row.querySelectorAll('.card[data-id]')].map((c) => c.dataset.id) : null);
  },
  unheard: () => { ui.unheard = !ui.unheard; render(); },
  history: () => go('history'),
  clearHistory: () => { if (confirm('Smazat historii poslechu v tomhle zařízení?')) { S.history = []; store.set(S); render(); } },
  download: async (el) => {
    if (!P || P.dl || el.classList.contains('on')) return;
    const st = P.st;
    P.dl = true;
    try {
      await downloadStory(st, (d, n) => { el.innerHTML = `${I.down} ${Math.round((d / n) * 100)} %`; });
      el.innerHTML = dlLabel(true); el.classList.add('on');
    } catch (e) {
      el.innerHTML = `${I.down} Zkusit znovu`;
      const w = document.getElementById('voicewarn'); if (w) w.textContent = e.message || 'Stažení se nepovedlo.';
    } finally { if (P) P.dl = false; }
  },
  downloadAll: async (el) => {
    if (el.dataset.busy) return;
    const stat = document.getElementById('offStat');
    const todo = [];
    for (const st of STORIES.filter(unlocked)) if (!(await storyOffline(st))) todo.push(st);
    if (!todo.length) return offlineStats();
    el.dataset.busy = stat.dataset.busy = '1';
    try {
      for (let i = 0; i < todo.length; i++) {
        await downloadStory(todo[i], (d, n) => { stat.textContent = `Stahuji ${i + 1}. z ${todo.length}: ${Math.round((d / n) * 100)} %`; });
      }
      delete stat.dataset.busy; offlineStats();
    } catch (e) {
      stat.textContent = e.message || 'Stažení se nepovedlo.';
    } finally { delete el.dataset.busy; delete stat.dataset.busy; }
  },
  clearOffline: async () => {
    if (!confirm('Smazat pohádky stažené na cestu? Bez internetu pak nepůjdou pustit.')) return;
    await OFFLINE.clear(); offlineMemo.clear(); render();
  },
  paywall,
  subscribe: async (el) => {
    // web: jen simulace (platí se jen v mobilní aplikaci přes App Store a Google Play, app/billing.js)
    if (!BILLING.native) { if (WEB_DEMO) { S.premium = true; save(); closeModal(); render(); } return; }
    el.disabled = true;
    try {
      if (await BILLING.buy()) { S.premium = true; save(); closeModal(); render(); checkTrial(true); } else el.disabled = false;
    } catch (e) { el.disabled = false; el.insertAdjacentHTML('afterend', `<p class="fine err" style="text-align:center">Nákup se nepovedl. ${esc(e && e.message || '')}</p>`); }
  },
  restore: async () => { const v = await BILLING.restore().catch(() => null); if (v !== null) { S.premium = v || codeOn(); save(); } closeModal(); render(); },
  codeSheet: (el, e) => { e.preventDefault(); codeSheet(); },
  redeem: async (el) => {
    const code = (document.getElementById('codeIn')?.value || '').trim();
    const msg = document.getElementById('codeMsg');
    if (!code) { msg.innerHTML = '<span class="err">Napište kód.</span>'; return; }
    el.disabled = true; msg.textContent = 'Ověřuji…';
    const r = await SYNC.call('app_redeem_code', { code }).catch(() => undefined);
    el.disabled = false;
    if (r && r.ok && r.until) {
      S.codeUntil = r.until; S.premium = true; save(); closeModal(); render();
      return;
    }
    msg.innerHTML = `<span class="err">${r === undefined ? 'Kód se teď nepodařilo ověřit. Zkontrolujte připojení k internetu a zkuste to znovu.' : r && r.error === 'tries' ? 'Moc pokusů. Zkuste to prosím za hodinu.' : 'Tenhle kód neznáme nebo už neplatí.'}</span>`;
  },
  unsub: () => { if (BILLING.native) { BILLING.manage(); return; } S.premium = false; save(); render(); },
  settings: () => go('settings'),
  // souhlas se statistikami poslechu (sync.js); vypnutí v databázi anonymizuje dosavadní poslechy
  analytics: (el) => { S.analytics = el.dataset.v === '1'; save(); render(); },
  theme: (el) => { S.theme = el.dataset.v === 'auto' ? null : el.dataset.v; save(); applyTheme(); render(); },
  back: () => { ui.shelf = null; go('lib'); },
  editHome: () => {
    $modal.innerHTML = `<div class="overlay" data-a="closeModal"><div class="sheet" data-stop><h2>Bydliště</h2>${homeForm()}${changesNote()}<div class="footer-actions"><button class="btn" data-a="saveHome">Uložit</button></div></div></div>`;
  },
  saveHome: () => { if (syncHome() === false) return; closeModal(); render(); },
  reset: () => { if (confirm(`Smazat účet a všechna data rodiny v tomto zařízení i na našem serveru? Nejde to vrátit.${S.premium && BILLING.native ? '\n\nPředplatné se tím nezruší. Zrušte ho v nastavení předplatných App Store nebo Google Play.' : ''}`)) { DAILY.disable(); SYNC.forget(); OFFLINE.clear(); offlineMemo.clear(); store.clear(); S = blank(); ui.step = 0; go('login'); } },
  playPause: () => playPause(),
  rate: (el) => rate(el),
  prevSeg: () => jump(-1),
  nextSeg: () => jump(1),
  toggleText: () => document.getElementById('ptext').classList.toggle('hide'),
  readVoice: () => setReadSelf(false),
  readSelf: () => setReadSelf(true),
  bgOn: () => setBackground(true),
  bgOff: () => setBackground(false),
  closePlayer,
};

function applyTheme() {
  const h = new Date().getHours();
  const dark = S.theme === 'dark' || (S.theme !== 'light' && (h >= 19 || h < 7));
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name=theme-color]').content = dark ? '#1C1E33' : '#F7F5FC';
}

function go(screen) { ui.screen = screen; render(); window.scrollTo(0, 0); }

function render() {
  if ((ui.screen === 'lib' || ui.screen === 'settings' || ui.screen === 'history') && !S.family.children.length) { ui.screen = 'onb'; ui.step = 0; }
  const keep = [...document.querySelectorAll('.shelf-row[data-k]')].map((r) => [r.dataset.k, r.scrollLeft]);
  // otevřený přehrávač je uvnitř $app: překreslení obrazovky pod ním (cena, stav předplatného, pohádka dne)
  // ho nesmí smazat, jinak pohádka hraje dál bez ovládání
  const player = document.getElementById('player');
  $app.innerHTML = screens[ui.screen]();
  if (player) $app.appendChild(player);
  keep.forEach(([k, x]) => { const r = $app.querySelector(`.shelf-row[data-k="${k}"]`); if (r) r.scrollLeft = x; });
  if (ui.screen === 'lib') { markOffline(); saveTitles(); }
  if (ui.screen === 'settings') offlineStats();
  // formulář bydliště může být i v modalu – překreslit ho s novými daty
  if ($modal.querySelector('#town') && ui.screen !== 'onb') actions.editHome();
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]');
  if (!el) return;
  if (el.dataset.a === 'closeModal' && el.classList.contains('overlay') && e.target !== el) return;
  e.preventDefault();
  actions[el.dataset.a]?.(el, e);
});
// připojení se změnilo → knihovna ukáže nebo schová upozornění a zešedlé pohádky
['online', 'offline'].forEach((ev) => window.addEventListener(ev, () => { if (ui.screen === 'lib') render(); }));
// tým v administraci zveřejnil novou verzi pohádek (catalog.js) → knihovna a historie se překreslí
// a když přibyly pohádky, které tu minule nebyly, krátce to oznámí (klepnutí otevře poličku Ještě neslyšené)
window.addEventListener('ospalek:stories', (e) => {
  if (ui.screen === 'lib' || ui.screen === 'history') render();
  const n = (e.detail && e.detail.fresh || []).length;
  if (!n || ui.screen === 'login' || ui.screen === 'onb') return;
  document.querySelector('.fresh-toast')?.remove();
  const t = document.createElement('button');
  t.className = 'fresh-toast';
  t.dataset.a = 'shelf';
  t.dataset.id = 'unheard';
  t.textContent = n === 1 ? 'Přibyla nová pohádka ›' : `Přibyl${n < 5 ? 'y' : 'o'} ${n} ${n < 5 ? 'nové pohádky' : 'nových pohádek'} ›`;
  document.body.append(t);
  setTimeout(() => t.classList.add('out'), 7000);
  setTimeout(() => t.remove(), 7600);
  t.addEventListener('click', () => t.remove());
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'town') { const i = document.getElementById('inTown'); if (!i.value || i.dataset.auto) { i.value = inTownGuess(e.target.value); i.dataset.auto = '1'; } }
  if (e.target.id === 'inTown') delete e.target.dataset.auto;
});


// ---------- systémové Zpět (Android: gesto nebo tlačítko) ----------
// MainActivity se zeptá window.ospalekBack(): true = aplikace krok zpět obsloužila (zavřela okno,
// přehrávač, poličku…), false = jsme na hlavní obrazovce a Android aplikaci odsune do pozadí.
window.ospalekBack = () => {
  try {
    if ($modal.innerHTML) { closeModal(); return true; }
    if (document.getElementById('player')) { closePlayer(); return true; }
    if (ui.screen === 'lib' && ui.shelf) { actions.shelfBack(); return true; }
    if (ui.screen === 'settings' || ui.screen === 'history') { ui.shelf = null; go('lib'); return true; }
    if (ui.screen === 'onb' && ui.step > 0) { actions.prev(); return true; }
  } catch (e) { /* zpět nesmí aplikaci shodit */ }
  return false;
};

// Klepnutí na upozornění otevře aplikaci s ?pohadka=<id> (nebo pošle zprávu už otevřenému oknu)
function openFromNotice(id) {
  if (!id || !S.onboarded || !S.family.children.length) return;
  closePlayer(); closeModal();
  if (ui.screen !== 'lib') go('lib');
  const st = STORIES.find((s) => s.id === id);
  if (st) actions.open({ dataset: { id } });
}
navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data && e.data.open) openFromNotice(e.data.open); });

render();
// v aplikaci: stav předplatného z obchodu má přednost před uloženým
// Na webu se předplatné koupit nedá. Odemknutí naoko zůstává jen pro vývoj na localhostu; dřív odemčené pohádky na webu se zamknou.
if (!BILLING.native && !WEB_DEMO && S.premium && !codeOn()) { S.premium = false; store.set(S); }
// odemčení kódem platí vedle předplatného z obchodu; po vypršení kódu rozhoduje jen obchod
const billingChecked = BILLING.status().then((v) => { if (v === null) return; const p = v || codeOn(); if (p !== S.premium) { S.premium = p; save(); render(); } }).catch(() => {});
checkTrial(false);
pruneOffline();
const refreshDaily = () => DAILY.refresh(() => { if (['lib', 'settings'].includes(ui.screen) && !document.getElementById('player') && !$modal.innerHTML) render(); });
refreshDaily();
// návrat do aplikace (třeba druhý den večer): nová pohádka dne
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { refreshDaily(); if (S.premium) checkTrial(false); if (ui.screen === 'lib' && !document.getElementById('player')) render(); } });
DAILY.check(S.notify === true);
(() => {
  const q = new URLSearchParams(location.search);
  const id = q.get('pohadka');
  if (!id) return;
  q.delete('pohadka');
  history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
  openFromNotice(id);
})();
// až po ověření předplatného: to může knihovnu překreslit a otevřený přehrávač by zmizel
Promise.race([billingChecked, new Promise((r) => setTimeout(r, 4000))]).then(() => { if (!document.getElementById('player')) resumeAfterReload(); });
