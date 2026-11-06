// Lumi – webový prototyp. Bez buildu, data jen v localStorage tohoto prohlížeče.
// (cap a listCz pochází ze stories.cs.js)

const LS_KEY = 'lumi.v1';
const store = {
  get() { try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch (e) { return null; } },
  set(v) { try { localStorage.setItem(LS_KEY, JSON.stringify(v)); } catch (e) { /* prototyp běží i bez úložiště */ } },
  clear() { try { localStorage.removeItem(LS_KEY); } catch (e) {} },
};
const blank = () => ({ user: null, onboarded: false, premium: false, heroIds: [], family: { children: [], parents: [], home: { town: '', inTown: '', near: [], attr: [], nearOpts: [], attrOpts: [] } } });
let S = store.get() || blank();
if (!S.heroIds) S.heroIds = S.heroId ? [S.heroId] : []; // starší uložená data měla jen jednoho hrdinu
let ui = { screen: S.user ? (S.onboarded ? 'lib' : 'onb') : 'login', step: 0, cat: 'all', ageOnly: false, plan: 'year' };
const save = () => store.set(S);
const $app = document.getElementById('app');
const $modal = document.getElementById('modal');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const uid = () => Math.random().toString(36).slice(2, 9);

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
  mama: { label: 'Maminka', g: 'f', av: '👩', forms: { nom: 'maminka', gen: 'maminky', dat: 'mamince', acc: 'maminku', voc: 'maminko', ins: 'maminkou' } },
  tata: { label: 'Tatínek', g: 'm', av: '👨', forms: { nom: 'tatínek', gen: 'tatínka', dat: 'tatínkovi', acc: 'tatínka', voc: 'tatínku', ins: 'tatínkem' } },
  babi: { label: 'Babička', g: 'f', av: '👵', forms: { nom: 'babička', gen: 'babičky', dat: 'babičce', acc: 'babičku', voc: 'babičko', ins: 'babičkou' } },
  deda: { label: 'Dědeček', g: 'm', av: '👴', forms: { nom: 'dědeček', gen: 'dědečka', dat: 'dědečkovi', acc: 'dědečka', voc: 'dědečku', ins: 'dědečkem' } },
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

// ---------- Obrazovky ----------
const screens = {
  login: () => `
    <div class="login">
      <div class="logo">🌙</div>
      <h1>Lumi</h1>
      <p class="tag">Pohádky, ve kterých hrají hlavní roli vaše děti.</p>
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
        <h1>Pohádky pro ${esc(c.h.acc)} ✨</h1>
        <button class="icon-btn" data-a="settings" aria-label="Nastavení">⚙️</button>
      </div>
      ${S.family.children.length > 1 ? `
        <div class="section-t">Hlavní hrdinové <span class="hint">– vyberte jednoho nebo víc</span></div>
        <div class="chips">${S.family.children.map((k) => `<button class="chip ${hs.includes(k) ? 'on' : ''}" data-a="hero" data-id="${k.id}" aria-pressed="${hs.includes(k)}">${hs.includes(k) ? '✓ ' : ''}${k.gender === 'f' ? '👧' : '👦'} ${esc(k.forms.nom)}</button>`).join('')}</div>` : ''}
      <div class="section-t">Kategorie</div>
      <div class="hscroll">
        ${CATEGORIES.map((k) => `<button class="chip ${ui.cat === k.id ? 'on' : ''}" data-a="cat" data-id="${k.id}">${k.label}</button>`).join('')}
        <button class="chip ${ui.ageOnly ? 'on' : ''}" data-a="age">🎂 ${hs.length === 1 ? `Pro ${hs[0].age} let` : 'Podle věku'}</button>
      </div>
      ${S.premium ? '' : `<button class="promo" data-a="paywall"><span style="font-size:32px">🔓</span><div><b>Odemkněte všechny pohádky</b><span>7 dní zdarma, pak od 58 Kč měsíčně</span></div></button>`}
      <div class="grid">
        ${list.map((s) => {
          const segs = s.text(c);
          return `
          <button class="card" data-a="open" data-id="${s.id}">
            <div class="cover" style="--g1:${s.cover.g1};--g2:${s.cover.g2}">
              ${s.cover.img ? `<img src="${coverImg(s, hs)}" alt="" loading="lazy">` : s.cover.emoji}
              ${s.free && !S.premium ? '<span class="badge free">ZDARMA</span>' : ''}
              ${unlocked(s) ? '' : '<span class="badge lock">🔒</span>'}
              <span class="badge dur">⏱ ${minutes(segs)} min</span>
            </div>
            <h3>${esc(s.title(c))}</h3>
            <div class="meta">${s.ages[0]}–${s.ages[1]} let</div>
          </button>`;
        }).join('') || '<p class="empty">V téhle kategorii zatím nic není.</p>'}
      </div>`;
  },

  settings: () => `
    <div class="top">
      <h1>Rodina a nastavení</h1>
      <button class="icon-btn" data-a="back" aria-label="Zpět">✕</button>
    </div>
    <div class="section-t">Děti</div>${peopleList('child')}
    <div class="section-t">Rodiče a blízcí</div>${peopleList('parent')}
    <div class="section-t">Bydliště</div>
    <div class="person"><div class="av">🏡</div><div class="nm"><b>${esc(S.family.home.town || 'Nevyplněno')}</b><span>${esc([...S.family.home.near, ...S.family.home.attr].join(', ') || 'Bez míst v okolí')}</span></div><button class="btn small ghost" data-a="editHome">Upravit</button></div>
    <div class="section-t">Předplatné</div>
    <div class="person"><div class="av">${S.premium ? '⭐' : '🔒'}</div><div class="nm"><b>${S.premium ? 'Lumi Plus (demo)' : 'Zdarma – 3 pohádky'}</b><span>${S.user ? esc(S.user.email) : 'Nepřihlášeno'}</span></div>
      ${S.premium ? '<button class="btn small ghost" data-a="unsub">Zrušit</button>' : '<button class="btn small" data-a="paywall">Odemknout</button>'}</div>
    <div class="footer-actions"><button class="btn ghost" data-a="reset">Smazat všechna data a začít znovu</button></div>`,
};

function peopleList(kind) {
  const arr = kind === 'child' ? S.family.children : S.family.parents;
  return `<div class="people">${arr.map((p) => `
    <div class="person">
      <div class="av">${kind === 'child' ? (p.gender === 'f' ? '👧' : '👦') : ROLES[p.role].av}</div>
      <div class="nm"><b>${esc(kind === 'child' ? p.forms.nom : ROLES[p.role].label + (p.name ? ' ' + p.forms.nom : ''))}</b>
      <span>${kind === 'child' ? `${p.age} let · ${esc(p.food || '—')} · ${esc(p.animal || '—')}` : 'v pohádkách: „' + esc(ROLES[p.role].forms.nom + (p.name ? ' ' + p.forms.nom : '')) + '“'}</span></div>
      <button class="btn small ghost" data-a="editPerson" data-kind="${kind}" data-id="${p.id}">Upravit</button>
    </div>`).join('')}</div>
    <button class="add" data-a="addPerson" data-kind="${kind}">+ Přidat ${kind === 'child' ? 'dítě' : 'rodiče nebo prarodiče'}</button>`;
}

const stepKids = () => `
  <h1>Kdo bude hlavní hrdina?</h1>
  <p class="lead">Přidejte své děti. Pohádky budou o nich – s jejich jménem, oblíbeným jídlem a zvířátkem.</p>
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
  <p class="lead">Pohádky se pak budou odehrávat v místech, která děti znají. Stačí obec, přesnou adresu nepotřebujeme.</p>
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
    <label for="inTown">Jak řeknete „bydlíme …“</label>
    <input id="inTown" placeholder="v Benešově" value="${esc(h.inTown)}">
    <div id="spotsMsg" class="note" style="margin-top:8px"></div>
    ${h.nearOpts.length ? `<div class="section-t">Obce v okolí</div><div class="chips">${chips(h.nearOpts, h.near, 'near')}</div>` : ''}
    ${h.attrOpts.length ? `<div class="section-t">Výletní místa</div><div class="chips">${chips(h.attrOpts, h.attr, 'attr')}</div>` : ''}
    <label for="addSpot">Přidat vlastní oblíbené místo</label>
    <div class="row"><input id="addSpot" placeholder="např. ZOO Dvůr Králové"><button class="btn small ghost" style="flex:0 0 auto" data-a="addSpot">Přidat</button></div>`;
}

// ---------- Okolí z OpenStreetMap ----------
async function findSpots() {
  const town = document.getElementById('town').value.trim();
  const msg = document.getElementById('spotsMsg');
  if (!town) { msg.textContent = 'Nejdřív napište obec.'; return; }
  syncHome();
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
    document.getElementById('spotsMsg').textContent = towns.length || attrs.length ? 'Vybraná místa se objeví v pohádkách. Klepnutím je zapnete nebo vypnete.' : 'V okolí jsme nic nenašli – přidejte místa ručně.';
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
        <label for="pName">Jak mu/jí doma říkáte?</label>
        <input id="pName" value="${esc(p.forms.nom)}" placeholder="např. Toník, Ema, Kubík">
        <label>Je to</label>
        <div class="seg" id="gSeg"><button data-a="gender" data-v="m" class="${p.gender !== 'f' ? 'on' : ''}">👦 Kluk</button><button data-a="gender" data-v="f" class="${p.gender === 'f' ? 'on' : ''}">👧 Holka</button></div>
        <div class="row">
          <div><label for="pAge">Věk</label><select id="pAge">${[2, 3, 4, 5, 6, 7, 8, 9, 10].map((a) => `<option ${a === p.age ? 'selected' : ''}>${a}</option>`).join('')}</select></div>
        </div>
        <label for="pFood">Oblíbené jídlo</label>
        <input id="pFood" value="${esc(p.food || '')}" placeholder="např. palačinky">
        <label for="pAnimal">Oblíbené zvíře</label>
        <input id="pAnimal" value="${esc(p.animal || '')}" placeholder="např. liška">
      ` : `
        <label>Kdo to je</label>
        <div class="seg" id="rSeg">${Object.entries(ROLES).map(([k, r]) => `<button data-a="role" data-v="${k}" class="${p.role === k ? 'on' : ''}">${r.av}</button>`).join('')}</div>
        <div class="note" id="roleLabel" style="margin-top:6px">${ROLES[p.role].label}</div>
        <label for="pName">Jméno (nepovinné)</label>
        <input id="pName" value="${esc(p.name ? p.forms.nom : '')}" placeholder="např. Petra">
        <p class="note">V pohádce pak zazní třeba „maminka Petra“. Bez jména jen „maminka“.</p>
      `}
      <details><summary>Skloňování jména (zkontrolujte)</summary>
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
      <div style="font-size:48px;text-align:center">⭐</div>
      <h2 style="text-align:center">Lumi Plus</h2>
      <p class="lead" style="text-align:center">Celá knihovna pohádek pro všechny vaše děti.</p>
      <ul class="perks">
        <li>Všechny pohádky a každý měsíc nové</li>
        <li>Pohádky na dobrou noc, do auta i ze života</li>
        <li>Pro všechny děti v rodině</li>
        <li>Poslech offline a časovač usínání</li>
      </ul>
      <div class="plans">
        <button class="plan ${ui.plan === 'year' ? 'on' : ''}" data-a="plan" data-v="year"><div><b>Ročně</b><span class="save">−41 %</span><small>699 Kč / rok · 58 Kč měsíčně</small></div><span>${ui.plan === 'year' ? '●' : '○'}</span></button>
        <button class="plan ${ui.plan === 'month' ? 'on' : ''}" data-a="plan" data-v="month"><div><b>Měsíčně</b><small>99 Kč / měsíc</small></div><span>${ui.plan === 'month' ? '●' : '○'}</span></button>
      </div>
      <button class="btn" data-a="subscribe">Vyzkoušet 7 dní zdarma</button>
      <p class="fine" style="text-align:center">Prototyp: žádná platba neproběhne, pohádky se jen odemknou.</p>
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

function openPlayer(st) {
  const c = ctx(heroes());
  // nahrávky z ElevenLabs existují jen pro rodinu, pro kterou byly vygenerované
  const rec = RECORDINGS[st.id] && RECORDINGS[st.id].hero === c.H ? RECORDINGS[st.id] : null;
  P = { st, segs: st.text(c), i: 0, playing: false, stop: null, showText: true, rec, voice: rec ? rec.voices[0].id : 'browser', audio: null };
  $app.insertAdjacentHTML('beforeend', `
    <div class="player" id="player" style="--g1:${st.cover.g1}">
      <div class="inner">
        <div class="bar"><button class="icon-btn" data-a="closePlayer" aria-label="Zavřít">✕</button><button class="icon-btn" data-a="toggleText" aria-label="Text">📖</button></div>
        <div class="pcover">${st.cover.img ? `<img src="${coverImg(st, heroes())}" alt="">` : st.cover.emoji}</div>
        <h2>${esc(st.title(c))}</h2>
        ${rec ? `<div class="chips voices">${rec.voices.map((v) => `<button class="chip ${P.voice === v.id ? 'on' : ''}" data-a="setVoice" data-v="${v.id}">🎙️ ${v.name}</button>`).join('')}<button class="chip" data-a="setVoice" data-v="browser">🤖 Prohlížeč</button></div>` : ''}
        <div class="ptext" id="ptext">${P.segs.map((s, i) => `<p data-i="${i}">${esc(s.t)}</p>`).join('')}</div>
        <div class="waiting" id="waiting"></div>
        <div class="controls">
          <button class="skip" data-a="prevSeg" aria-label="Předchozí">⏮</button>
          <button class="play" data-a="playPause" id="playBtn" aria-label="Přehrát">▶</button>
          <button class="skip" data-a="nextSeg" aria-label="Další">⏭</button>
        </div>
        <div class="mix">🎵 Hudba <input type="range" id="musicVol" min="0" max="1" step="0.05" value="${ambience.musicVol ?? 0.5}"></div>
        <div class="voicewarn" id="voicewarn">${rec ? 'Realistický hlas ElevenLabs – ukázka nahraná pro tuto rodinu.' : csVoice ? 'Ukázkový hlas prohlížeče. Ve finální verzi čte realistický hlas (ElevenLabs).' : 'Prohlížeč nemá český hlas – text se jen zvýrazňuje. Ve finální verzi čte hlas ElevenLabs.'}</div>
      </div>
    </div>`);
  document.getElementById('musicVol').addEventListener('input', (e) => ambience.setMusicVolume(+e.target.value));
  highlight();
}

function highlight() {
  document.querySelectorAll('#ptext p').forEach((p) => {
    const i = +p.dataset.i;
    p.className = i === P.i ? 'now' : i < P.i ? 'done' : '';
    if (i === P.i) p.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  document.getElementById('playBtn').textContent = P.playing ? '⏸' : '▶';
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
  const delay = setTimeout(() => {
    P.stop = speak(seg.t, () => {
      if (!seg.pause) return setTimeout(go, 500);
      P.stop = waitAnswer(seg.pause, go);
    });
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
}
function setVoice(el) {
  const wasPlaying = P.playing;
  stopVoice();
  P.voice = el.dataset.v;
  el.parentNode.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el));
  document.getElementById('voicewarn').textContent = recVoice() ? 'Realistický hlas ElevenLabs – ukázka nahraná pro tuto rodinu.' : 'Ukázkový hlas prohlížeče pro srovnání.';
  if (wasPlaying) recVoice() ? playRec() : playSeg();
}

// pauza na odpověď u hádanek – vrací funkci, která odpočet zruší
function waitAnswer(sec, done) {
  let left = sec;
  const w = document.getElementById('waiting');
  w.textContent = `🤔 Čas na odpověď… ${left}`;
  const iv = setInterval(() => { left--; w.textContent = left > 0 ? `🤔 Čas na odpověď… ${left}` : ''; if (left <= 0) { clearInterval(iv); done(); } }, 1000);
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
  ambience.stopMusic(false); // pomalé ztlumení
  const bedtime = P.st.cats.includes('noc');
  document.getElementById('ptext').insertAdjacentHTML('beforeend', `<div class="the-end"><div>${bedtime ? '😴' : '🎉'}</div><h2>${bedtime ? 'Dobrou noc' : 'Konec'}</h2></div>`);
  document.querySelector('.the-end').scrollIntoView({ behavior: 'smooth' });
  document.getElementById('playBtn').textContent = '↻';
}

function closePlayer() {
  if (P) { stopVoice(); P = null; }
  ambience.stopMusic(true);
  document.getElementById('player')?.remove();
}

// ---------- Akce ----------
const closeModal = () => { $modal.innerHTML = ''; ui.edit = null; };
const actions = {
  google: () => { S.user = { email: 'rodina@example.com', provider: 'google' }; save(); go(S.onboarded ? 'lib' : 'onb'); },
  guest: () => { S.user = { email: 'host', provider: 'guest' }; save(); go('onb'); },
  next: () => { ui.step++; render(); },
  prev: () => { syncHome(); ui.step--; render(); },
  finish: () => { syncHome(); S.onboarded = true; save(); go('lib'); },
  addPerson: (el) => personSheet(el.dataset.kind),
  editPerson: (el) => personSheet(el.dataset.kind, el.dataset.id),
  gender: (el) => { ui.edit.gender = el.dataset.v; el.parentNode.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el)); refreshCases(); },
  role: (el) => { ui.edit.role = el.dataset.v; el.parentNode.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el)); document.getElementById('roleLabel').textContent = ROLES[el.dataset.v].label; refreshCases(); },
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
  plan: (el) => { ui.plan = el.dataset.v; paywall(); },
  subscribe: () => { S.premium = true; save(); closeModal(); render(); },
  unsub: () => { S.premium = false; save(); render(); },
  settings: () => go('settings'),
  back: () => go('lib'),
  editHome: () => {
    $modal.innerHTML = `<div class="overlay" data-a="closeModal"><div class="sheet" data-stop><h2>Bydliště</h2>${homeForm()}<div class="footer-actions"><button class="btn" data-a="saveHome">Uložit</button></div></div></div>`;
  },
  saveHome: () => { syncHome(); closeModal(); render(); },
  reset: () => { if (confirm('Opravdu smazat všechna data rodiny?')) { store.clear(); S = blank(); ui.step = 0; go('login'); } },
  playPause: () => playPause(),
  prevSeg: () => jump(-1),
  nextSeg: () => jump(1),
  toggleText: () => document.getElementById('ptext').classList.toggle('hide'),
  closePlayer,
  setVoice,
};

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

const GOOGLE_SVG = '<svg width="20" height="20" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

render();
