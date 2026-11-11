// Ospalek – co se stahuje z webu až podle potřeby.
// Web (ospalek.cz): vše leží vedle aplikace, service worker si stažené pamatuje (sw.js). Tady se nic nemění.
// Mobilní aplikace (Capacitor) má přibalené jen pohádky zdarma (seznam vět v audio/hlas/jana/bundled.json,
// vyrábí mobile/scripts/copy-web.mjs). Ostatní věty se stáhnou z ospalek.cz při prvním poslechu nebo
// tlačítkem „Stáhnout na cestu“ a uloží se natrvalo do zařízení (Capacitor Filesystem, složka hlas/).
// Stejně tak se z webu dotahuje rejstřík nahrávek a kulis, aby nové pohádky hrály bez nové verze aplikace.

const REMOTE = (() => {
  const NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const SITE = 'https://ospalek.cz/';
  const FS = NATIVE && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem;
  const DIR = 'DATA';
  const okLocal = (r) => r.ok || r.status === 0; // Capacitor na iOS vrací vlastní soubory se stavem 0

  // věty přibalené v aplikaci (jen mobil); na webu null = všechno je „vedle“
  const bundled = NATIVE
    ? fetch('../audio/hlas/jana/bundled.json').then((r) => (okLocal(r) ? r.json() : null)).then((a) => (a ? new Set(a) : null)).catch(() => null)
    : Promise.resolve(null);

  // ---------- věty uložené v zařízení (jen mobil) ----------
  let saved = null; // Promise<Set<klíč>>
  let base = null; // Promise<URL složky hlas/ pro WebView>
  const listSaved = () => (saved = saved || (FS
    ? FS.readdir({ path: 'hlas', directory: DIR })
      .then((r) => new Set((r.files || []).map((f) => (typeof f === 'string' ? f : f.name)).filter((n) => n.endsWith('.mp3')).map((n) => n.slice(0, -4))))
      .catch(() => new Set())
    : Promise.resolve(new Set())));
  const dirUrl = () => (base = base || FS.getUri({ path: 'hlas', directory: DIR }).then((r) => window.Capacitor.convertFileSrc(r.uri).replace(/\/?$/, '/')));
  function b64(buf) {
    const u = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  }
  async function save(key, buf) {
    if (!FS) return;
    const set = await listSaved();
    if (set.has(key)) return;
    await FS.writeFile({ path: `hlas/${key}.mp3`, data: b64(buf), directory: DIR, recursive: true });
    set.add(key);
  }

  // kde leží společná věta: { url, local, store } – store = po stažení uložit do zařízení
  async function clip(key) {
    const rel = `../audio/hlas/jana/${key}.mp3`;
    const b = await bundled;
    if (!NATIVE || !b || b.has(key)) return { url: rel, local: true, store: false };
    if (FS && (await listSaved()).has(key)) return { url: (await dirUrl()) + key + '.mp3', local: true, store: false };
    return { url: `${SITE}audio/hlas/jana/${key}.mp3`, local: false, store: !!FS };
  }

  // stáhne větu do zařízení (Stáhnout na cestu); na webu to dělá service worker přes offline.js
  async function fetchClip(key) {
    const c = await clip(key);
    if (c.local) return;
    const r = await fetch(c.url);
    if (!r.ok) throw new Error('Nahrávku se nepodařilo stáhnout.');
    await save(key, await r.arrayBuffer());
  }
  const hasClip = async (key) => (await clip(key)).local;

  // rejstřík (index.json) z aplikace, na mobilu doplněný o novější z webu
  async function index(rel) {
    const local = await fetch(rel).then((r) => (okLocal(r) ? r.json() : null)).catch(() => null);
    if (!NATIVE || !navigator.onLine) return local;
    const fresh = await fetch(SITE + rel.replace(/^\.\.\//, ''), { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!fresh) return local;
    if (!local) return fresh;
    return { ...local, ...fresh, clips: { ...local.clips, ...fresh.clips } };
  }

  async function clear() {
    if (!FS) return;
    await FS.rmdir({ path: 'hlas', directory: DIR, recursive: true }).catch(() => {});
    saved = Promise.resolve(new Set());
  }

  // adresa souboru, který v aplikaci nemusí být (obálka nové pohádky, kulisa): na mobilu z webu
  const siteUrl = (rel) => SITE + rel.replace(/^(\.\.\/)+/, '');

  return { NATIVE, SITE, okLocal, clip, save, fetchClip, hasClip, index, clear, siteUrl };
})();
