// Ospalek – katalog pohádek z administrace (Supabase, tabulka story_catalog).
// Pohádky zabalené v aplikaci (stories.cs.js) jsou záloha. Když tým v administraci pohádku přejmenuje, smaže
// nebo přidá, zveřejní se nová verze katalogu a aplikace ji tady převezme:
//  – hned při startu z uložené kopie v zařízení (funguje i bez internetu),
//  – a na pozadí si stáhne novější verzi. Pak vyšle událost „ospalek:stories“ a knihovna se překreslí.
// Pohádky v katalogu jsou šablony ve stejném tvaru jako ve stories.cs.js (titleSrc, textSrc = zdroj funkce).
// Zapisovat do katalogu smí jen tým s ověřením kódem (role Vlastník nebo Obsah), hlídá to databáze.
// Lokální zkouška: ?db=http://localhost:54321 (supabase/dev-server.mjs).
// Nové pohádky z webu: aplikace si při startu (mobil) a po návratu z pozadí (web i mobil) stáhne aktuální
// stories.cs.js z ospalek.cz a přidá pohádky, které ještě nezná – bez nové verze aplikace v obchodě.
// O pohádkách, které tu minule nebyly, dá vědět událostí „ospalek:stories“ s detail.fresh (seznam id).

const CATALOG = (() => {
  const C = window.OSPALEK_CONFIG || {};
  const dev = new URLSearchParams(location.search).get('db');
  const devOk = dev && /^http:\/\/localhost(:\d+)?$/.test(dev);
  const URL_ = devOk ? dev : C.supabaseUrl;
  const KEY_ = devOk ? 'dev' : C.supabaseAnonKey;
  const CKEY = 'ospalek.catalog.v1' + (devOk ? '.dev' : '');
  const BUNDLED = window.STORIES.slice();
  let version = 0, at = null, lastCat = null;

  const compile = (src) => new Function('cap', 'listCz', `"use strict"; return (${src}\n);`)(cap, listCz);
  // jedna pohádka z katalogu → stejný tvar jako ve stories.cs.js; když se šablona nedá přeložit, vrátí null
  function build(s) {
    try {
      const title = compile(s.titleSrc), text = compile(s.textSrc);
      if (typeof title !== 'function' || typeof text !== 'function') return null;
      const ages = Array.isArray(s.ages) && s.ages.length === 2 ? s.ages.map(Number) : [2, 9];
      const cover = { ...(s.cover || {}) };
      if (!cover.imgF) delete cover.imgF;
      return { id: String(s.id), free: !!s.free, cats: Array.isArray(s.cats) ? s.cats.map(String) : [], ages, mood: s.mood || 'lullaby', cover, title, text };
    } catch (e) {
      return null;
    }
  }
  // katalog + pohádky, které přibyly v nové verzi aplikace a tým o nich ještě nerozhodl
  function apply(cat) {
    if (!cat || !Array.isArray(cat.stories) || !cat.stories.length) return false;
    const byId = new Map(BUNDLED.map((s) => [s.id, s]));
    const list = [];
    cat.stories.forEach((s) => {
      const st = build(s) || byId.get(s.id); // rozbitá šablona: radši verze z aplikace než nic
      if (st && !list.some((x) => x.id === st.id)) list.push(st);
    });
    const gone = new Set([...(cat.deleted || []), ...list.map((s) => s.id)]);
    BUNDLED.forEach((s) => { if (!gone.has(s.id)) list.push(s); });
    if (!list.length) return false;
    window.STORIES = list;
    version = cat.version || 0; at = cat.at || null; lastCat = cat;
    return true;
  }
  const rebuild = () => { if (!lastCat || !apply(lastCat)) window.STORIES = BUNDLED.slice(); };

  // které pohádky už rodina v knihovně viděla; nové ohlásit (poprvé se jen zapamatují)
  const KKEY = 'ospalek.known.v1';
  function changed() {
    let known = null;
    try { known = JSON.parse(localStorage.getItem(KKEY)); } catch (e) {}
    const ids = window.STORIES.map((s) => s.id);
    const fresh = Array.isArray(known) ? ids.filter((id) => !known.includes(id)) : [];
    try { localStorage.setItem(KKEY, JSON.stringify([...new Set([...(known || []), ...ids])])); } catch (e) {}
    dispatchEvent(new CustomEvent('ospalek:stories', { detail: { fresh } }));
  }

  // pohádky ze stories.cs.js stažené z webu; přidají se jen ty, které aplikace nemá
  const SKEY = 'ospalek.stories.v1';
  const SRC = REMOTE.NATIVE ? REMOTE.SITE + 'app/stories.cs.js' : 'stories.cs.js';
  function addFrom(src) {
    const w = { CATEGORIES: [] };
    new Function('window', '"use strict";\n' + src)(w);
    if (!Array.isArray(w.STORIES)) return 0;
    let n = 0;
    w.STORIES.forEach((s) => {
      if (!s || !s.id || typeof s.title !== 'function' || typeof s.text !== 'function' || BUNDLED.some((b) => b.id === s.id)) return;
      // obálky pohádek přidaných po vydání nejsou v mobilní aplikaci, berou se z webu
      if (REMOTE.NATIVE && s.cover) s.cover = { ...s.cover, ...(s.cover.img ? { img: REMOTE.siteUrl(s.cover.img) } : {}), ...(s.cover.imgF ? { imgF: REMOTE.siteUrl(s.cover.imgF) } : {}) };
      BUNDLED.push(s);
      n++;
    });
    w.CATEGORIES.forEach((k) => { if (k && k.id && !window.CATEGORIES.some((x) => x.id === k.id)) window.CATEGORIES.push(k); });
    return n;
  }
  let checked = 0;
  async function checkStories() {
    if (!navigator.onLine || Date.now() - checked < 5 * 60 * 1000) return;
    checked = Date.now();
    try {
      const r = await fetch(SRC, { cache: 'no-cache' });
      if (!r.ok) return;
      const src = await r.text();
      if (REMOTE.NATIVE) try { localStorage.setItem(SKEY, src); } catch (e) {}
      if (addFrom(src)) { rebuild(); changed(); }
    } catch (e) { /* příště znovu */ }
  }

  // 1) hned: pohádky z webu stažené minule (mobil) a uložená kopie katalogu
  if (REMOTE.NATIVE) try { const src = localStorage.getItem(SKEY); if (src) addFrom(src); } catch (e) {}
  try { apply(JSON.parse(localStorage.getItem(CKEY))); } catch (e) {}
  if (!lastCat) window.STORIES = BUNDLED.slice();

  // 2) na pozadí: novější verze ze serveru
  async function refresh(full) {
    if (!URL_ || !KEY_ || !navigator.onLine) return false;
    try {
      const r = await fetch(`${URL_}/rest/v1/rpc/app_catalog`, { method: 'POST', headers: { apikey: KEY_, 'Content-Type': 'application/json' }, body: JSON.stringify({ since: full ? 0 : version }) });
      if (!r.ok) return false;
      const cat = await r.json();
      if (!cat) {
        // v databázi žádný katalog není (zatím nic nezveřejněno) → pohádky z aplikace
        if (!version) return false;
        try { localStorage.removeItem(CKEY); } catch (e) {}
        window.STORIES = BUNDLED.slice(); version = 0; at = null; lastCat = null;
        changed();
        return true;
      }
      // stejné číslo, ale jiná verze (databáze založená znovu) → stáhnout celý katalog
      if (!cat.stories) return !full && version && cat.at !== at ? refresh(true) : false;
      if (!apply(cat)) return false;
      try { localStorage.setItem(CKEY, JSON.stringify(cat)); } catch (e) {}
      changed();
      return true;
    } catch (e) {
      return false;
    }
  }
  addEventListener('online', () => { refresh(); checkStories(); });
  // aplikace vytažená z pozadí (telefon) se zeptá znovu
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { refresh(); checkStories(); } });
  // po startu: ohlásit pohádky, které přibyly od minula (i z nové verze webu), a na mobilu zkusit web
  addEventListener('load', () => { changed(); if (REMOTE.NATIVE) checkStories(); else checked = Date.now(); });

  return { refresh, get version() { return version; } };
})();
CATALOG.refresh();
