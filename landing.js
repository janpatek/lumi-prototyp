// ===== Nastavení landing page – vše, co se bude měnit, je tady =====
// appName: název aplikace. Doplní se do všech prvků s atributem data-app-name a do titulku stránky.
// tryUrl: kam vedou hlavní tlačítka „Vyzkoušet“ (zatím webový prototyp aplikace).
// appStoreUrl / googlePlayUrl: odkazy do obchodů. Dokud jsou prázdné, tlačítka vedou na # a ukazují štítek „Již brzy“.
const LANDING = {
  appName: 'Ospalek',
  tryUrl: 'app/',
  appStoreUrl: '',
  googlePlayUrl: '',
};

// Název aplikace
document.querySelectorAll('[data-app-name]').forEach((el) => { el.textContent = LANDING.appName; });
document.title = document.title.replace(/^[^–]+/, LANDING.appName + ' ');

// Tlačítka „Vyzkoušet“ a obchody
document.querySelectorAll('[data-try]').forEach((a) => { a.href = LANDING.tryUrl; });
document.querySelectorAll('[data-store]').forEach((a) => {
  const url = LANDING[a.dataset.store + 'Url'];
  if (url) {
    a.href = url;
    a.classList.remove('is-soon');
    a.removeAttribute('aria-disabled');
  } else {
    a.addEventListener('click', (e) => e.preventDefault());
  }
});

// Telefon: obchod pro jeho systém dáme dopředu, ten druhý na mobilu schováme (CSS .is-other).
// iPad se hlásí jako Mac, proto ho nepoznáme a ukážeme oba.
const PLATFORM = /iPhone|iPod/.test(navigator.userAgent) ? 'appStore' : /Android/.test(navigator.userAgent) ? 'googlePlay' : '';
if (PLATFORM) {
  document.querySelectorAll('.stores').forEach((box) => {
    box.querySelectorAll('[data-store]').forEach((a) => {
      if (a.dataset.store === PLATFORM) box.prepend(a);
      else a.classList.add('is-other');
    });
  });
}

// ===== Pohádka na jméno: skloňování (zjednodušená verze z aplikace, app.js) =====
const SOFT = 'žščřcjďťň';
function decline(name, gender) {
  const n = name.trim();
  const f = (gen, dat, acc, voc) => ({ nom: n, gen, dat, acc, voc });
  const last = n.slice(-1).toLowerCase();
  const stem = n.slice(0, -1);
  if (gender === 'f') {
    if (last === 'a') {
      const s = stem.slice(-1).toLowerCase();
      if (SOFT.includes(s)) return f(stem + 'i', stem + 'e', stem + 'u', stem + 'o');
      const dat = { k: stem.slice(0, -1) + 'ce', h: stem.slice(0, -1) + 'ze', g: stem.slice(0, -1) + 'ze', r: stem.slice(0, -1) + 'ře' }[s]
        || ('lsz'.includes(s) ? stem + 'e' : stem + 'ě');
      return f(stem + 'y', dat, stem + 'u', stem + 'o');
    }
    if (last === 'e') return f(n, stem + 'i', stem + 'i', n);
    return f(n, n, n, n);
  }
  if (last === 'a') {
    const soft = SOFT.includes(stem.slice(-1).toLowerCase());
    return f(stem + (soft ? 'i' : 'y'), stem + 'ovi', stem + 'u', stem + 'o');
  }
  if (last === 'í') return f(n + 'ho', n + 'mu', n + 'ho', n);
  if (last === 'o') return f(stem + 'a', stem + 'ovi', stem + 'a', n);
  let base = n;
  if (/ek$/i.test(n)) base = n.slice(0, -2) + 'k';
  if (/^(pavel|karel)$/i.test(n)) base = n.slice(0, -2) + 'l';
  const b = base.slice(-1).toLowerCase();
  if (SOFT.includes(b) || b === 'x') return f(base + 'e', base + 'ovi', base + 'e', base + 'i');
  let voc = base + 'e';
  if ('khg'.includes(b) || /ch$/i.test(base)) voc = base + 'u';
  else if (/[^aeiouyáéíóúůý]r$/i.test(base)) voc = base.slice(0, -1) + 'ře';
  return f(base + 'a', base + 'ovi', base + 'a', voc);
}
// „v Benešově“, „ve Zlíně“ – stejný odhad jako v aplikaci
function inTownGuess(town) {
  const t = town.trim();
  const special = { praha: 'v Praze', brno: 'v Brně', plzeň: 'v Plzni', olomouc: 'v Olomouci', liberec: 'v Liberci', ostrava: 'v Ostravě', 'české budějovice': 'v Českých Budějovicích', 'hradec králové': 'v Hradci Králové', bratislava: 'v Bratislavě', košice: 'v Košicích', kladno: 'na Kladně' };
  if (special[t.toLowerCase()]) return special[t.toLowerCase()];
  // „ve“ před v/f a před shlukem souhlásek na začátku (ve Zlíně, ve Strakonicích)
  const v = /^[vf]|^[szšžcčř][^aeiouyáéíóúůýě]/i.test(t) ? 've ' : 'v ';
  if (/ov$|ín$|ýn$/.test(t)) return v + t + 'ě';
  if (/ice$/.test(t)) return v + t.slice(0, -1) + 'ích';
  if (/any$/.test(t)) return v + t.slice(0, -1) + 'ech';
  if (/[dtnvbpm]a$/.test(t)) return v + t.slice(0, -1) + 'ě';
  return 've městě ' + t;
}
// jména na -a a -e bývají holčičí (Eliška, Ema, Julie), výjimky opraví přepínač
const MALE_A = /^(jirka|honza|míša|sáša|nikita|ilja|kuba|jarda|franta|tonda|pepa|vojta|mira|láďa|péťa)$/i;
const guessGender = (n) => (/[ae]$/i.test(n) && !MALE_A.test(n) ? 'f' : 'm');

const DEFAULT_NAME = 'Toník';
const DEFAULT_TOWN = 'v Benešově';
const kid = { name: DEFAULT_NAME, gender: 'm', manual: false, town: DEFAULT_TOWN };
const nameInput = document.getElementById('kid-name');
const townInput = document.getElementById('kid-town');
const genderBtns = document.querySelectorAll('[data-gender]');

function render() {
  const forms = { ...decline(kid.name, kid.gender), town: kid.town };
  const g = (m, f) => (kid.gender === 'f' ? f : m);
  // šablony: {nom} {gen} {dat} {acc} {voc}, slovesa {g:bydlel|bydlela}
  document.querySelectorAll('[data-tpl]').forEach((el) => {
    el.textContent = '';
    el.dataset.tpl.split(/(\{[^}]+\})/).forEach((part) => {
      const m = part.match(/^\{(\w+)(?::([^|}]*)\|([^}]*))?\}$/);
      if (!m) { el.append(part); return; }
      if (m[1] === 'g') { el.append(g(m[2], m[3])); return; }
      const s = document.createElement('span');
      s.className = 'kid';
      s.textContent = forms[m[1]];
      el.append(s);
    });
  });
  document.querySelectorAll('[data-img-f]').forEach((img) => {
    const src = kid.gender === 'f' ? img.dataset.imgF : img.dataset.imgM;
    if (!img.src.endsWith(src)) img.src = src;
  });
  genderBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.gender === kid.gender)));
}

if (nameInput) {
  nameInput.addEventListener('input', () => {
    const v = nameInput.value.replace(/[^\p{L} '-]/gu, '').trim().slice(0, 20);
    const name = v ? v.charAt(0).toUpperCase() + v.slice(1) : DEFAULT_NAME;
    kid.name = name;
    if (!kid.manual) kid.gender = v ? guessGender(name) : 'm';
    document.body.classList.toggle('has-name', !!v);
    render();
  });
  genderBtns.forEach((b) => b.addEventListener('click', () => { kid.gender = b.dataset.gender; kid.manual = true; render(); }));
}
if (townInput) {
  townInput.addEventListener('input', () => {
    const v = townInput.value.replace(/[^\p{L} .'-]/gu, '').trim().slice(0, 30);
    kid.town = v ? inTownGuess(v.charAt(0).toUpperCase() + v.slice(1)) : DEFAULT_TOWN;
    render();
  });
}
render();

// ===== Lepicí lišta s výzvou na mobilu: ukáže se, když hlavní tlačítko zmizí z obrazovky =====
const sticky = document.getElementById('sticky-cta');
const platformUrl = PLATFORM && LANDING[PLATFORM + 'Url'];
if (sticky && platformUrl) {
  // aplikace už je v obchodě: lišta nabídne rovnou stažení
  const a = sticky.querySelector('a');
  a.removeAttribute('data-try');
  a.href = platformUrl;
  a.textContent = PLATFORM === 'appStore' ? 'Stáhnout v App Store' : 'Stáhnout na Google Play';
}
const heroCta = document.getElementById('hero-cta');
const endCta = document.getElementById('end');
if (sticky && heroCta) {
  const onScreen = (el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; };
  const update = () => sticky.classList.toggle('show', !onScreen(heroCta) && !(endCta && onScreen(endCta)));
  addEventListener('scroll', update, { passive: true });
  addEventListener('resize', update);
  update();
}

// ===== Audio ukázka =====
const audio = document.getElementById('sample-audio');
const playBtn = document.getElementById('sample-play');
const bar = document.getElementById('sample-bar');
const time = document.getElementById('sample-time');
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

if (audio && playBtn) {
  playBtn.addEventListener('click', () => (audio.paused ? audio.play() : audio.pause()));
  audio.addEventListener('play', () => { playBtn.classList.add('playing'); playBtn.setAttribute('aria-label', 'Pozastavit ukázku'); });
  audio.addEventListener('pause', () => { playBtn.classList.remove('playing'); playBtn.setAttribute('aria-label', 'Přehrát ukázku'); });
  audio.addEventListener('timeupdate', () => {
    if (!audio.duration) return;
    bar.style.width = (audio.currentTime / audio.duration) * 100 + '%';
    time.textContent = `${fmt(audio.currentTime)} / ${fmt(audio.duration)}`;
  });
  audio.addEventListener('ended', () => { bar.style.width = '0%'; });
  document.getElementById('sample-track').addEventListener('click', (e) => {
    if (!audio.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
  });
}
