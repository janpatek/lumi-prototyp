// Poslech bez internetu: úložiště v zařízení.
// - Věty se jmény rodiny (z tts-workeru) leží v IndexedDB „ospalek“ / „hlas“, klíč = nálada|text.
//   V aplikaci pro iPhone místo toho v souborech (Capacitor Filesystem, složka rodina/, název = otisk klíče):
//   IndexedDB ve WKWebView po zamčení telefonu přestane odpovídat a pohádka by se na pozadí nepřipravila.
//   Jednou stažená věta zůstane i po zavření aplikace; mažou se při změně rodiny (prune) a se všemi daty.
// - Společné nahrávky, obálky, písmo a samotná aplikace leží na webu v Cache Storage (spravuje sw.js).
//   V mobilní aplikaci (Capacitor) je přibalená aplikace, obálky, kulisy a věty pohádek zdarma; ostatní
//   společné věty se stahují z ospalek.cz do složky hlas/ v zařízení (remote.js). Service worker tam není.
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

  // Na iPhonu (WKWebView) se spojení s IndexedDB po pobytu aplikace na pozadí umí tiše zaseknout:
  // transakce nikdy neskončí a příprava pohádky stála na 0 %. Každá operace má proto časový limit;
  // po něm (nebo po zavření spojení systémem) se otevře nové spojení a operace se jednou zopakuje.
  const IDB_LIMIT = 5000;
  let dbp = null;
  const db = () => {
    if (dbp) return dbp;
    const p = new Promise((res, rej) => {
      const r = indexedDB.open('ospalek', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('hlas');
      r.onsuccess = () => {
        const d = r.result;
        d.onclose = () => { if (dbp === p) dbp = null; };
        d.onversionchange = () => { d.close(); if (dbp === p) dbp = null; };
        res(d);
      };
      r.onerror = () => rej(r.error);
    });
    dbp = p;
    return p;
  };
  const once = (mode, fn) => {
    const conn = db();
    let timer;
    return Promise.race([
      conn.then((d) => new Promise((res, rej) => {
        const t = d.transaction('hlas', mode);
        const q = fn(t.objectStore('hlas'));
        t.oncomplete = () => res(q && q.result);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error || new Error('IndexedDB: transakce zrušena'));
      })),
      new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error('IndexedDB neodpovídá'), { stuck: true })), IDB_LIMIT); }),
    ]).catch((e) => {
      // zaseknuté nebo zavřené spojení zahodit, příště se otevře nové
      if (dbp === conn) dbp = null;
      conn.then((d) => { try { d.close(); } catch (x) { /* už zavřené */ } }).catch(() => {});
      throw e;
    }).finally(() => clearTimeout(timer));
  };
  const tx = (mode, fn) => once(mode, fn).catch(() => once(mode, fn));

  // ---------- věty rodiny v souborech (iPhone) ----------
  const C = window.Capacitor;
  const FS = NATIVE && C.getPlatform && C.getPlatform() === 'ios' && C.Plugins && C.Plugins.Filesystem;
  const DIR = 'DATA';
  const FAM = 'rodina';
  // otisk klíče (cyrb53) jako název souboru – klíč je celá věta s diakritikou
  const keyOf = (id) => {
    if (!FS) return id;
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < id.length; i++) {
      const ch = id.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  };
  let famSaved = null; // Promise<Set<otisk>>
  let famBase = null;
  const famList = () => (famSaved = famSaved || FS.readdir({ path: FAM, directory: DIR })
    .then((r) => new Set((r.files || []).map((f) => (typeof f === 'string' ? f : f.name)).filter((n) => n.endsWith('.mp3')).map((n) => n.slice(0, -4))))
    .catch(() => new Set()));
  const famUrl = () => (famBase = famBase || FS.getUri({ path: FAM, directory: DIR }).then((r) => C.convertFileSrc(r.uri).replace(/\/?$/, '/')));
  function b64(buf) {
    const u = new Uint8Array(buf);
    let out = '';
    for (let i = 0; i < u.length; i += 0x8000) out += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(out);
  }
  const fam = FS && {
    async get(id) {
      const k = keyOf(id);
      if (!(await famList()).has(k)) return undefined;
      const r = await fetch((await famUrl()) + k + '.mp3');
      if (!r.ok && r.status !== 0) return undefined; // Capacitor na iOS vrací vlastní soubory se stavem 0
      const b = await r.arrayBuffer();
      return b.byteLength ? b : undefined;
    },
    async put(id, buf) {
      const k = keyOf(id);
      const set = await famList();
      if (set.has(k)) return;
      await FS.writeFile({ path: `${FAM}/${k}.mp3`, data: b64(buf), directory: DIR, recursive: true });
      set.add(k);
    },
    keys: async () => new Set(await famList()),
    async remove(ks) {
      const set = await famList();
      for (const k of ks) {
        await FS.deleteFile({ path: `${FAM}/${k}.mp3`, directory: DIR }).catch(() => {});
        set.delete(k);
      }
    },
    async clear() {
      await FS.rmdir({ path: FAM, directory: DIR, recursive: true }).catch(() => {});
      famSaved = Promise.resolve(new Set());
    },
  };

  const abs = (u) => new URL(u, location.href).href;
  const cacheFor = (u) => (/\.mp3(\?|$)/.test(u) ? AUDIO : APP);

  return {
    NATIVE,
    // věty rodiny; keys() a remove() pracují s klíči z keyOf(nálada|text)
    keyOf,
    get: (id) => (fam ? fam.get(id).catch(() => undefined) : tx('readonly', (s) => s.get(id)).catch(() => undefined)),
    put: (id, buf) => (fam ? fam.put(id, buf).catch(() => {}) : tx('readwrite', (s) => s.put(buf, id)).catch(() => {})),
    keys: () => (fam ? fam.keys().catch(() => new Set()) : tx('readonly', (s) => s.getAllKeys()).then((k) => new Set(k)).catch(() => new Set())),
    remove: (ids) => (!ids.length ? Promise.resolve() : fam ? fam.remove(ids).catch(() => {}) : tx('readwrite', (s) => { ids.forEach((id) => s.delete(id)); }).catch(() => {})),
    // soubory aplikace a společné nahrávky
    // v mobilní aplikaci: věty, které nejsou přibalené, se stahují do zařízení (remote.js); obálky a kulisy
    // jsou přibalené, obálky novějších pohádek (z webu) bez internetu nahradí barevná záloha
    async hasFile(u) {
      if (NATIVE) {
        const k = window.voiceLines && voiceLines.key(u);
        return k ? REMOTE.hasClip(k) : true;
      }
      if (!hasCaches) return false;
      return !!(await caches.match(abs(u)).catch(() => null));
    },
    async saveFile(u) {
      if (NATIVE) {
        const k = window.voiceLines && voiceLines.key(u);
        if (k) await REMOTE.fetchClip(k);
        return;
      }
      if (!hasCaches) return;
      const c = await caches.open(cacheFor(u));
      if (!(await c.match(abs(u)))) await c.add(abs(u));
    },
    // „Smazat stažené“ a „Smazat všechna data“
    async clear() {
      if (fam) await fam.clear();
      else await tx('readwrite', (s) => { s.clear(); }).catch(() => {});
      if (hasCaches) await caches.delete(AUDIO).catch(() => {});
      await REMOTE.clear();
    },
  };
})();
