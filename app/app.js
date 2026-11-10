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
const LS_KEY = 'lumi.v1'; // klíč z doby pracovního názvu, ať se neztratí uložené rodiny
const store = {
  get() { try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch (e) { return null; } },
  set(v) { try { localStorage.setItem(LS_KEY, JSON.stringify(v)); } catch (e) { /* prototyp běží i bez úložiště */ } },
  clear() { try { localStorage.removeItem(LS_KEY); } catch (e) {} },
};
const blank = () => ({ user: null, onboarded: false, premium: false, heroIds: [], family: { children: [], parents: [], home: { town: '', inTown: '', near: [], attr: [], nearOpts: [], attrOpts: [] } } });
let S = store.get() || blank();
if (!S.heroIds) S.heroIds = S.heroId ? [S.heroId] : []; // starší uložená data měla jen jednoho hrdinu
let ui = { screen: S.user ? (S.onboarded ? 'lib' : 'onb') : 'login', step: 0, cat: 'all', ageOnly: false };
const save = () => { store.set(S); SYNC.family(S); }; // SYNC: app/sync.js, odešle do databáze, je-li nastavená
const $app = document.getElementById('app');
const $modal = document.getElementById('modal');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const uid = () => Math.random().toString(36).slice(2, 9);

// ---------- Značka: ikony, maskot, barvy kategorií ----------
const ico = (d, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const I = {
  gear: ico('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  close: ico('<path d="M6 6l12 12M18 6L6 18"/>'),
  lock: ico('<rect x="5" y="11" width="14" height="10" rx="3"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  book: ico('<path d="M4 5a2 2 0 0 1 2-2h5v17H6a2 2 0 0 0-2 2zM20 5a2 2 0 0 0-2-2h-5v17h5a2 2 0 0 1 2 2z"/>'),
  home: ico('<path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z"/>'),
  star: ico('<path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8 6.6 19.7l1.1-6.1L3.2 9.4l6.1-.8z"/>'),
  music: ico('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>'),
  mic: ico('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
  replay: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg>',
};
const MASCOT = { mark: '../brand/maskot-3d/web/ospalek-mark.webp', head: '../brand/maskot-3d/web/ospalek-hlava.webp', sleep: '../brand/maskot-3d/web/ospalek-spi.webp', trip: '../brand/maskot-3d/web/ospalek-vyprava.webp' };
// každá kategorie má svou pastelovou barvu (brand manuál)
const CAT_COLOR = { noc: 'var(--lavender)', auto: 'var(--sky)', dobro: 'var(--peach)', zivot: 'var(--mint)' };
const catColor = (st) => CAT_COLOR[st.cats[0]] || 'var(--lavender)';
// plyšové ikonky kategorií (brand/ikony)
const catIcon = (id, cls = 'cat-ico') => (CAT_COLOR[id] ? `<img class="${cls}" src="../brand/ikony/kat-${id}.webp" alt="">` : '');
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
  const sel = S.family.children.filter((k) => S.heroIds.includes(k.id));
  return sel.length ? sel : S.family.children.slice(0, 1);
};
const minutes = (segs) => Math.max(1, Math.round(segs.reduce((a, s) => a + s.t.split(/\s+/).length / 2 + (s.pause || 0) + 1, 0) / 60));
const coverImg = (st, ks) => (ks.every((k) => k.gender === 'f') && st.cover.imgF) || st.cover.img;
const unlocked = (st) => st.free || S.premium;
const yrs = (n) => `${n} ${n >= 2 && n <= 4 ? 'roky' : 'let'}`;

// ---------- Obrazovky ----------
const screens = {
  login: () => `
    <div class="login">
      <div class="logo"><img src="${MASCOT.mark}" alt=""><h1 class="wordmark">${APP_NAME}</h1></div>
      <p class="tag">Pohádky, kde je hrdinou tvoje dítě.</p>
      ${SHOW_APPLE ? `<button class="btn apple" data-a="apple">${APPLE_SVG} Pokračovat přes Apple</button>` : ''}
      <button class="btn white" data-a="google">${GOOGLE_SVG} Pokračovat přes Google</button>
      <button class="btn ghost" data-a="guest">Vyzkoušet bez přihlášení</button>
      <p class="fine">Prototyp: přihlášení je zatím jen simulované.</p>
    </div>`,

  onb: () => {
    const steps = [stepKids, stepParents, stepHome];
    return `
      <div class="step-label">Krok ${ui.step + 1} ze 3</div>
      <div class="progress"><div style="width:${((ui.step + 1) / 3) * 100}%"></div></div>
      ${steps[ui.step]()}`;
  },

  lib: () => {
    const hs = heroes();
    const c = ctx(hs);
    const list = STORIES.filter((s) => (ui.cat === 'all' || s.cats.includes(ui.cat)) && (!ui.ageOnly || hs.every((k) => k.age >= s.ages[0] && k.age <= s.ages[1])));
    return `
      <div class="top">
        <h1>Pohádky pro ${esc(c.h.acc)}</h1>
        <button class="icon-btn" data-a="settings" aria-label="Nastavení">${I.gear}</button>
      </div>
      ${S.family.children.length > 1 ? `
        <div class="section-t">Hlavní hrdinové <span class="hint">– vyber jednoho nebo víc</span></div>
        <div class="chips">${S.family.children.map((k) => `<button class="chip ${hs.includes(k) ? 'on' : ''}" data-a="hero" data-id="${k.id}" aria-pressed="${hs.includes(k)}">${hs.includes(k) ? '✓ ' : ''}${esc(k.forms.nom)}</button>`).join('')}</div>` : ''}
      <div class="section-t">Kategorie</div>
      <div class="hscroll">
        ${CATEGORIES.map((k) => `<button class="chip ${ui.cat === k.id ? 'on' : ''}" data-a="cat" data-id="${k.id}">${catIcon(k.id)}${k.label}</button>`).join('')}
        <button class="chip ${ui.ageOnly ? 'on' : ''}" data-a="age">${hs.length === 1 ? `Pro ${hs[0].age}leté` : 'Podle věku'}</button>
      </div>
      ${S.premium ? '' : `<button class="promo" data-a="paywall"><img src="${MASCOT.mark}" alt=""><div><b>Odemkni všechny pohádky</b><span>7 dní zdarma, pak 129 Kč měsíčně</span></div></button>`}
      ${SYNC.on && S.analytics === undefined ? `<div class="person" style="margin-bottom:12px"><div class="nm"><b>Pomůžeš nám zlepšovat pohádky?</b><span>Uvidíme, které pohádky posloucháte a jak dlouho. Bez souhlasu jen anonymně. Změníš to kdykoli v nastavení.</span></div><button class="btn small" data-a="analytics" data-v="1">Ano</button><button class="btn small ghost" data-a="analytics" data-v="0">Ne, díky</button></div>` : ''}
      <div class="grid">
        ${list.map((s) => {
          const segs = s.text(c);
          return `
          <button class="card" data-a="open" data-id="${s.id}">
            <div class="cover" style="--g1:${s.cover.g1};--g2:${s.cover.g2}">
              ${s.cover.img ? `<img src="${coverImg(s, hs)}" alt="" loading="lazy">` : s.cover.emoji}
              ${s.free && !S.premium ? '<span class="badge free">Zdarma</span>' : ''}
              ${unlocked(s) ? '' : `<span class="badge lock">${I.lock}Zamčeno</span>`}
            </div>
            <h3>${esc(s.title(c))}</h3>
            <div class="meta">${catIcon(s.cats[0], 'cat-ico sm')}${minutes(segs)} min · ${s.ages[0]}–${s.ages[1]} let</div>
          </button>`;
        }).join('') || `<div class="empty"><img src="${MASCOT.trip}" alt="">V téhle kategorii zatím nic není.</div>`}
      </div>`;
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
    <div class="section-t">Předplatné</div>
    <div class="person"><div class="av ${S.premium ? 'honey' : ''}">${S.premium ? I.star : I.lock}</div><div class="nm"><b>${S.premium ? `${APP_NAME} Plus${BILLING.native ? '' : ' (demo)'}` : 'Zdarma – 3 pohádky'}</b><span>${S.user ? esc(S.user.email) : 'Nepřihlášeno'}</span></div>
      ${S.premium ? `<button class="btn small ghost" data-a="unsub">${BILLING.native ? 'Spravovat' : 'Zrušit'}</button>` : '<button class="btn small" data-a="paywall">Odemknout</button>'}</div>
    ${SYNC.on ? `<div class="section-t">Statistiky</div>
    <div class="person"><div class="nm"><b>Sdílet statistiky poslechu</b><span>${S.analytics ? 'Zapnuto: vidíme, které pohádky vaše rodina poslouchá a jak dlouho.' : 'Vypnuto: poslechy posíláme jen anonymně, bez vazby na vaši rodinu.'}</span></div><button class="btn small ${S.analytics ? 'ghost' : ''}" data-a="analytics" data-v="${S.analytics ? 0 : 1}">${S.analytics ? 'Vypnout' : 'Zapnout'}</button></div>` : ''}
    <p class="note" style="margin-top:6px"><a href="../obchodni-podminky/" target="_blank" rel="noopener">Obchodní podmínky</a> · <a href="../ochrana-osobnich-udaju/" target="_blank" rel="noopener">Ochrana osobních údajů</a></p>
    <div class="section-t">Vzhled</div>
    <div class="seg">${[['auto', 'Podle času'], ['light', 'Den'], ['dark', 'Noc']].map(([v, l]) => `<button data-a="theme" data-v="${v}" class="${(S.theme || 'auto') === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    <p class="note" style="margin-top:6px">Podle času: od 19 do 7 hodin je zapnutý noční režim.</p>
    <div class="footer-actions"><button class="btn ghost" data-a="reset">Smazat všechna data a začít znovu</button></div>`,
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
    <button class="add" data-a="addPerson" data-kind="${kind}">+ Přidat ${kind === 'child' ? 'dítě' : 'rodiče nebo prarodiče'}</button>`;
}

const stepKids = () => `
  <img class="onb-mascot" src="${MASCOT.head}" alt="">
  <h1>Kdo bude hlavní hrdina?</h1>
  <p class="lead">Přidej své děti. Pohádky budou o nich – s jejich jménem, oblíbeným jídlem i zvířátkem.</p>
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
    <button class="btn" data-a="finish">Hotovo – jdeme na pohádky</button>
    <button class="link" data-a="prev">Zpět</button>
  </div>`;

function homeForm() {
  const h = S.family.home;
  const chips = (opts, sel, kind) => opts.map((o, i) => `<button class="chip ${sel.includes(o) ? 'on' : ''}" data-a="toggleSpot" data-kind="${kind}" data-i="${i}">${esc(o)}</button>`).join('');
  return `
    <label for="town">Obec nebo město</label>
    <div class="row"><input id="town" placeholder="např. Benešov" value="${esc(h.town)}" autocomplete="address-level2"><button class="btn small" style="flex:0 0 auto" data-a="findSpots">Najít okolí</button></div>
    <label for="inTown">Jak doma říkáte: „bydlíme …“</label>
    <input id="inTown" placeholder="v Benešově" value="${esc(h.inTown)}">
    <div id="spotsMsg" class="note" style="margin-top:8px"></div>
    ${h.nearOpts.length ? `<div class="section-t">Obce v okolí</div><div class="chips">${chips(h.nearOpts, h.near, 'near')}</div>` : ''}
    ${h.attrOpts.length ? `<div class="section-t">Výletní místa</div><div class="chips">${chips(h.attrOpts, h.attr, 'attr')}</div>` : ''}
    <label for="addSpot">Přidat vlastní oblíbené místo</label>
    <div class="row"><input id="addSpot" placeholder="např. Zoo Dvůr Králové"><button class="btn small ghost" style="flex:0 0 auto" data-a="addSpot">Přidat</button></div>`;
}

// ---------- Okolí z OpenStreetMap ----------
async function findSpots() {
  const town = document.getElementById('town').value.trim();
  const msg = document.getElementById('spotsMsg');
  if (!town) { msg.textContent = 'Nejdřív napiš obec.'; return; }
  syncHome();
  msg.textContent = 'Hledám místa v okolí…';
  try {
    const g = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=cz,sk&accept-language=cs&q=${encodeURIComponent(town)}`).then((r) => r.json());
    if (!g.length) throw new Error('Obec jsme nenašli. Zkus jiný název.');
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
    document.getElementById('spotsMsg').textContent = towns.length || attrs.length ? 'Vybraná místa se objeví v pohádkách. Klepnutím je zapneš nebo vypneš.' : 'V okolí jsme nic nenašli. Přidej místa ručně.';
  } catch (e) {
    msg.innerHTML = `<span class="err">${esc(e.message || 'Hledání se nepovedlo.')} Místa můžeš přidat i ručně.</span>`;
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
  if (t.value.trim() !== h.town) { h.town = t.value.trim(); if (!i.value.trim() || i.dataset.auto) i.value = inTownGuess(h.town); }
  h.inTown = i.value.trim() || inTownGuess(h.town);
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
        <input id="pName" value="${esc(p.forms.nom)}" placeholder="např. Toník, Ema, Kubík">
        <label>Je to</label>
        <div class="seg" id="gSeg"><button data-a="gender" data-v="m" class="${p.gender !== 'f' ? 'on' : ''}">Kluk</button><button data-a="gender" data-v="f" class="${p.gender === 'f' ? 'on' : ''}">Holka</button></div>
        <div class="row">
          <div><label for="pAge">Věk</label><select id="pAge">${[2, 3, 4, 5, 6, 7, 8, 9, 10].map((a) => `<option ${a === p.age ? 'selected' : ''}>${a}</option>`).join('')}</select></div>
        </div>
        <label for="pFood">Oblíbené jídlo</label>
        <input id="pFood" value="${esc(p.food || '')}" placeholder="např. palačinky">
        <label for="pAnimal">Oblíbené zvíře</label>
        <input id="pAnimal" value="${esc(p.animal || '')}" placeholder="např. liška">
      ` : `
        <label>Kdo to je</label>
        <div class="seg" id="rSeg">${Object.entries(ROLES).map(([k, r]) => `<button data-a="role" data-v="${k}" class="${p.role === k ? 'on' : ''}">${r.label}</button>`).join('')}</div>
                <label for="pName">Jméno (nepovinné)</label>
        <input id="pName" value="${esc(p.name ? p.forms.nom : '')}" placeholder="např. Petra">
        <p class="note">V pohádce pak zazní třeba „maminka Petra“. Bez jména jen „maminka“.</p>
      `}
      <details><summary>Skloňování jména (zkontroluj)</summary>
        <div class="cases">${CASES.map(([k, l]) => `<div><label for="c_${k}">${l}</label><input id="c_${k}" value="${esc(p.forms[k])}"></div>`).join('')}</div>
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
  const name = document.getElementById('pName').value.trim();
  const isChild = ui.edit.kind === 'child';
  if (isChild && !name) { document.getElementById('pName').focus(); return; }
  const forms = {};
  CASES.forEach(([k]) => { forms[k] = document.getElementById('c_' + k).value.trim() || name; });
  const arr = isChild ? S.family.children : S.family.parents;
  let p = arr.find((x) => x.id === ui.edit.id);
  if (!p) { p = { id: uid() }; arr.push(p); }
  if (isChild) Object.assign(p, { forms, gender: ui.edit.gender || 'm', age: +document.getElementById('pAge').value, food: document.getElementById('pFood').value.trim(), animal: document.getElementById('pAnimal').value.trim() });
  else Object.assign(p, { forms, role: ui.edit.role, name: !!name });
  if (!S.heroIds.length && isChild) S.heroIds = [p.id];
  save(); closeModal(); render();
}

// ---------- Předplatné ----------
function paywall() {
  $modal.innerHTML = `
    <div class="overlay" data-a="closeModal"><div class="sheet" data-stop>
      <img class="sheet-mascot" src="${MASCOT.mark}" alt="">
      <h2 style="text-align:center">${APP_NAME} Plus</h2>
      <p class="lead" style="text-align:center">Celá knihovna pohádek pro všechny tvoje děti.</p>
      <ul class="perks">
        <li>Všechny pohádky a pravidelně nové</li>
        <li>Pohádky na dobrou noc, do auta i ze života</li>
        <li>Pro všechny děti v rodině</li>
        <li>Brzy i poslech offline a časovač usínání</li>
      </ul>
      <div class="plans">
        <div class="plan on"><div><b>Měsíčně</b><small>129 Kč / měsíc · zrušit můžeš kdykoli</small></div></div>
      </div>
      <button class="btn" data-a="subscribe">Vyzkoušet 7 dní zdarma</button>
      <p class="fine" style="text-align:center">Po 7 dnech 129 Kč měsíčně, dokud předplatné nezrušíš. Pohádky se odemknou hned, proto po zaplacení nelze od smlouvy odstoupit do 14 dnů. Pokračováním souhlasíš s <a href="../obchodni-podminky/" target="_blank" rel="noopener">obchodními podmínkami</a>.</p>
      ${BILLING.native ? '<p class="fine" style="text-align:center">Platbu vyřizuje App Store nebo Google Play. Zrušit můžeš kdykoli v nastavení předplatných svého účtu, nejpozději 24 hodin před koncem období. <a href="#" data-a="restore">Obnovit nákupy</a></p>' : '<p class="fine" style="text-align:center">Na webu se nic neplatí: předplatné se kupuje v mobilní aplikaci. Tady se pohádky pro vyzkoušení jen odemknou.</p>'}
    </div></div>`;
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
function cloudClip(text, mood) {
  const id = (mood || '') + '|' + text;
  if (!cloudClips.has(id)) {
    const p = fetch(TTS_URL + '/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice: 'jana', ...(mood ? { mood } : {}) }) })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Hlas se nepodařilo načíst.');
        return URL.createObjectURL(await r.blob());
      });
    p.catch(() => cloudClips.delete(id)); // chybu příště zkusit znovu
    cloudClips.set(id, p);
  }
  return cloudClips.get(id);
}
// Vypravěčka pohádek. Výběr hlasu v přehrávači není, hlas (ElevenLabs „Jana“) určuje tts-worker.
const NARRATOR = 'teta Terezka';
const voiceFail = (e) => `${e.message} Teta Terezka se teď nenačetla, zatím čte náhradní hlas.`;
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

function openPlayer(st) {
  const c = ctx(heroes());
  // nahrávky z ElevenLabs existují jen pro rodinu, pro kterou byly vygenerované
  const rec = RECORDINGS[st.id] && RECORDINGS[st.id].hero === c.H ? RECORDINGS[st.id] : null;
  const segs = st.text(c);
  // skládaný hlas (voice-player.js): jde, když jsou namluvené všechny věty, nebo chybějící dotáhne tts-worker
  const plan = VOICE_LINES.planStory(segs);
  const linesOk = voiceLines.missing(plan) === 0 || !!TTS_URL;
  P = { st, segs, plan, i: 0, playing: false, stop: null, showText: true, rec, voice: linesOk ? 'lines' : rec ? rec.voices[0].id : TTS_URL ? 'cloud' : 'browser', audio: null };
  // jeden přehrávač vytvořený při kliknutí – iOS pak pustí i další odstavce bez dalšího klepnutí
  if (TTS_URL) P.cloudEl = new Audio();
  $app.insertAdjacentHTML('beforeend', `
    <div class="player" id="player" style="--c:${catColor(st)}">
      <div class="inner">
        <div class="bar"><button class="icon-btn" data-a="closePlayer" aria-label="Zavřít">${I.close}</button><button class="icon-btn" data-a="toggleText" aria-label="Text">${I.book}</button></div>
        <div class="pcover">${st.cover.img ? `<img src="${coverImg(st, heroes())}" alt="">` : st.cover.emoji}</div>
        <h2>${esc(st.title(c))}</h2>
        <p class="narrator">${I.mic} Čte ${NARRATOR}</p>
        <div class="ptext" id="ptext">${P.segs.map((s, i) => `<p data-i="${i}">${esc(s.t)}</p>`).join('')}</div>
        <div class="waiting" id="waiting"></div>
        <div class="controls">
          <button class="skip" data-a="prevSeg" aria-label="Předchozí">${I.prev}</button>
          <button class="play" data-a="playPause" id="playBtn" aria-label="Přehrát">${I.play}</button>
          <button class="skip" data-a="nextSeg" aria-label="Další">${I.next}</button>
        </div>
        <div class="mix">${I.music} Hudba <input type="range" id="musicVol" min="0" max="1" step="0.05" value="${ambience.musicVol ?? 0.5}"></div>
        <div class="voicewarn" id="voicewarn">${linesOk || rec || TTS_URL ? '' : csVoice ? 'Ukázkový hlas prohlížeče. Ve finální verzi čte realistický hlas (ElevenLabs).' : 'Prohlížeč nemá český hlas – text se jen zvýrazňuje. Ve finální verzi čte hlas ElevenLabs.'}</div>
      </div>
    </div>`);
  document.getElementById('musicVol').addEventListener('input', (e) => ambience.setMusicVolume(+e.target.value));
  highlight();
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
  b.innerHTML = P.playing ? I.pause : I.play;
  b.setAttribute('aria-label', P.playing ? 'Pozastavit' : 'Přehrát');
}

function playSeg() {
  if (!P) return;
  P.stop && P.stop();
  document.getElementById('waiting').textContent = '';
  if (P.i >= P.segs.length) return theEnd();
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
    P.stop = waitAnswer(seg.pause, go);
  };
  const delay = setTimeout(() => {
    P.stop = lines
      ? voiceLines.speak(P.plan[P.i], after, { fallback, onerror: (e) => {
        P.cloudFailed = true;
        document.getElementById('voicewarn').textContent = voiceFail(e);
        P.stop = speak(seg.t, after);
      } })
      : (cloud ? cloudSpeak : speak)(seg.t, after);
  }, seg.sfx ? 700 : 150);
  P.stop = () => clearTimeout(delay);
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
      P.stop = waitAnswer(prev.pause, () => { P.waiting = false; P.audio.play(); });
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
  if (P.playing) {
    P.playing = false;
    stopVoice();
    ambience.stopMusic(true);
    highlight();
  } else {
    P.playing = true;
    if (P.i >= P.segs.length) P.i = 0;
    if (!P.sync || P.sync.done) P.sync = SYNC.playStart(P.st, S);
    ambience.startMusic(P.st.mood);
    document.querySelector('.the-end')?.remove();
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
  P.playing = false;
  SYNC.playEnd(P.sync, true);
  ambience.stopMusic(false); // pomalé ztlumení
  const bedtime = P.st.cats.includes('noc');
  document.getElementById('ptext').insertAdjacentHTML('beforeend', `<div class="the-end"><img src="${bedtime ? MASCOT.sleep : MASCOT.head}" alt=""><h2>${bedtime ? 'Dobrou noc' : 'Konec'}</h2></div>`);
  scrollInText(document.querySelector('.the-end'), false);
  document.getElementById('playBtn').innerHTML = I.replay;
}

function closePlayer() {
  if (P) { SYNC.playEnd(P.sync, false, P.i / P.segs.length); stopVoice(); P = null; }
  ambience.stopMusic(true);
  document.getElementById('player')?.remove();
}

// ---------- Akce ----------
const closeModal = () => { $modal.innerHTML = ''; ui.edit = null; };
const actions = {
  google: () => { S.user = { email: 'rodina@example.com', provider: 'google' }; save(); go(S.onboarded ? 'lib' : 'onb'); },
  apple: () => { S.user = { email: 'rodina@example.com', provider: 'apple' }; save(); go(S.onboarded ? 'lib' : 'onb'); },
  guest: () => { S.user = { email: 'host', provider: 'guest' }; save(); go('onb'); },
  next: () => { ui.step++; render(); },
  prev: () => { syncHome(); ui.step--; render(); },
  finish: () => { syncHome(); S.onboarded = true; save(); go('lib'); },
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
    h[kind] = h[kind].includes(name) ? h[kind].filter((x) => x !== name) : [...h[kind], name];
    save(); render();
  },
  addSpot: () => {
    syncHome();
    const v = document.getElementById('addSpot').value.trim();
    if (!v) return;
    const h = S.family.home; h.attrOpts = [v, ...h.attrOpts.filter((x) => x !== v)]; h.attr = [v, ...h.attr.filter((x) => x !== v)];
    save(); render();
  },
  hero: (el) => {
    // přepínání hrdinů – aspoň jeden musí zůstat vybraný
    const ids = heroes().map((k) => k.id);
    const id = el.dataset.id;
    S.heroIds = ids.includes(id) ? (ids.length > 1 ? ids.filter((x) => x !== id) : ids) : [...ids, id];
    save(); render();
  },
  cat: (el) => { ui.cat = el.dataset.id; render(); },
  age: () => { ui.ageOnly = !ui.ageOnly; render(); },
  open: (el) => { const st = STORIES.find((s) => s.id === el.dataset.id); unlocked(st) ? openPlayer(st) : paywall(); },
  paywall,
  subscribe: async (el) => {
    // web: jen simulace (platí se jen v mobilní aplikaci přes App Store a Google Play, app/billing.js)
    if (!BILLING.native) { S.premium = true; save(); closeModal(); render(); return; }
    el.disabled = true;
    try {
      if (await BILLING.buy()) { S.premium = true; save(); closeModal(); render(); } else el.disabled = false;
    } catch (e) { el.disabled = false; el.insertAdjacentHTML('afterend', `<p class="fine err" style="text-align:center">Nákup se nepovedl. ${esc(e && e.message || '')}</p>`); }
  },
  restore: async () => { const v = await BILLING.restore().catch(() => null); if (v !== null) { S.premium = v; save(); } closeModal(); render(); },
  unsub: () => { if (BILLING.native) { BILLING.manage(); return; } S.premium = false; save(); render(); },
  settings: () => go('settings'),
  // souhlas se statistikami poslechu (sync.js); vypnutí v databázi anonymizuje dosavadní poslechy
  analytics: (el) => { S.analytics = el.dataset.v === '1'; save(); render(); },
  theme: (el) => { S.theme = el.dataset.v === 'auto' ? null : el.dataset.v; save(); applyTheme(); render(); },
  back: () => go('lib'),
  editHome: () => {
    $modal.innerHTML = `<div class="overlay" data-a="closeModal"><div class="sheet" data-stop><h2>Bydliště</h2>${homeForm()}<div class="footer-actions"><button class="btn" data-a="saveHome">Uložit</button></div></div></div>`;
  },
  saveHome: () => { syncHome(); closeModal(); render(); },
  reset: () => { if (confirm('Opravdu smazat všechna data rodiny?')) { SYNC.forget(); store.clear(); S = blank(); ui.step = 0; go('login'); } },
  playPause: () => playPause(),
  prevSeg: () => jump(-1),
  nextSeg: () => jump(1),
  toggleText: () => document.getElementById('ptext').classList.toggle('hide'),
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
  if ((ui.screen === 'lib' || ui.screen === 'settings') && !S.family.children.length) { ui.screen = 'onb'; ui.step = 0; }
  $app.innerHTML = screens[ui.screen]();
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
document.addEventListener('input', (e) => {
  if (e.target.id === 'town') { const i = document.getElementById('inTown'); if (!i.value || i.dataset.auto) { i.value = inTownGuess(e.target.value); i.dataset.auto = '1'; } }
  if (e.target.id === 'inTown') delete e.target.dataset.auto;
});

// Přihlášení přes Apple: na iOS povinné vedle Google (App Review 4.8). Na Androidu ho nenabízíme.
const SHOW_APPLE = !(window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() === 'android');
const APPLE_SVG = '<svg width="18" height="22" viewBox="0 0 814 1000" aria-hidden="true"><path fill="currentColor" d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"/></svg>';
const GOOGLE_SVG = '<svg width="20" height="20" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

render();
// v aplikaci: stav předplatného z obchodu (RevenueCat) má přednost před uloženým
BILLING.status().then((v) => { if (v !== null && v !== S.premium) { S.premium = v; save(); render(); } });
