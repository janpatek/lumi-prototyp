// Poslech bez internetu: úložiště v zařízení.
// - Věty se jmény rodiny (z tts-workeru) leží v IndexedDB „ospalek“ / „hlas“, klíč = nálada|text.
//   Jednou stažená věta zůstane i po zavření aplikace; mažou se při změně rodiny (prune) a se všemi daty.
// - Společné nahrávky, obálky, písmo a samotná aplikace leží na webu v Cache Storage (spravuje sw.js).
//   V mobilní aplikaci (Capacitor) jsou tyhle soubory přibalené, service worker tam není potřeba.
// Názvy cache musí sedět se sw.js. Po novém namluvení společných vět zvyš číslo v AUDIO (i v sw.js),
// jinak by zařízení dál hrála staré nahrávky.

const OFFLINE = (() => {
  const NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const AUDIO = 'ospalek-hlas-1';
  const APP = 'ospalek-app-1';
  const hasCaches = 'caches' in window;

  if (!NATIVE && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    // požádat prohlížeč, ať stažené pohádky nemaže, když dochází místo
    navigator.storage && navigator.storage.persist && navigator.storage.persist().catch(() => {});
  }

  let dbp = null;
  const db = () => (dbp = dbp || new Promise((res, rej) => {
    const r = indexedDB.open('ospalek', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('hlas');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = (mode, fn) => db().then((d) => new Promise((res, rej) => {
    const t = d.transaction('hlas', mode);
    const q = fn(t.objectStore('hlas'));
    t.oncomplete = () => res(q && q.result);
    t.onerror = () => rej(t.error);
  }));

  const abs = (u) => new URL(u, location.href).href;
  const cacheFor = (u) => (/\.mp3(\?|$)/.test(u) ? AUDIO : APP);

  return {
    NATIVE,
    // věty rodiny
    get: (id) => tx('readonly', (s) => s.get(id)).catch(() => undefined),
    put: (id, buf) => tx('readwrite', (s) => s.put(buf, id)).catch(() => {}),
    keys: () => tx('readonly', (s) => s.getAllKeys()).then((k) => new Set(k)).catch(() => new Set()),
    remove: (ids) => (ids.length ? tx('readwrite', (s) => { ids.forEach((id) => s.delete(id)); }).catch(() => {}) : Promise.resolve()),
    // soubory aplikace a společné nahrávky
    async hasFile(u) {
      if (NATIVE) return true;
      if (!hasCaches) return false;
      return !!(await caches.match(abs(u)).catch(() => null));
    },
    async saveFile(u) {
      if (NATIVE || !hasCaches) return;
      const c = await caches.open(cacheFor(u));
      if (!(await c.match(abs(u)))) await c.add(abs(u));
    },
    // „Smazat stažené“ a „Smazat všechna data“
    async clear() {
      await tx('readwrite', (s) => { s.clear(); }).catch(() => {});
      if (hasCaches) await caches.delete(AUDIO).catch(() => {});
    },
  };
})();
