// Service worker webové aplikace: aby se Ospalek otevřel i bez internetu.
// - kód aplikace (HTML, JS, CSS, JSON): nejdřív síť, bez sítě poslední uložená verze → aktualizace přijdou hned
// - obrázky a písmo: z cache, chybějící se stáhnou a uloží
// - nahrávky vět (.mp3): z cache AUDIO, chybějící se stáhnou a uloží → co jednou hrálo, hraje i offline
// Požadavky na jiné servery (hlas, databáze, mapy) se nechávají být.
// Večerní upozornění (push-worker): zpráva nese nadpis, text se zástupným {pohadka} a id pohádky dne.
// Název pohádky se jménem dítěte si aplikace ukládá do cache META (daily.js), tady se jen doplní.
// Názvy cache musí sedět s offline.js. Po novém namluvení společných vět zvyš číslo v AUDIO.

const APP = 'ospalek-app-1';
const AUDIO = 'ospalek-hlas-1';
const META = 'ospalek-meta';
const SHELL = [
  './', 'index.html', 'styles.css', 'fonts/fonts.css',
  'fonts/fredoka-latin.woff2', 'fonts/fredoka-latin-ext.woff2', 'fonts/nunito-latin.woff2', 'fonts/nunito-latin-ext.woff2',
  'stories.cs.js', 'remote.js', 'catalog.js', 'recordings.js', 'audio.js', 'voice-lines.js', 'voice-player.js', 'offline.js', 'sync.js', 'daily.js', 'billing.js', 'media.js', 'app.js',
  'manifest.webmanifest', 'icon-192.png', 'icon-512.png', '../gate.js', '../config.js', '../audio/hlas/jana/index.json',
  '../brand/maskot-3d/web/ospalek-mark.webp', '../brand/maskot-3d/web/ospalek-hlava.webp', '../brand/maskot-3d/web/ospalek-spi.webp',
  '../brand/maskot-3d/web/ospalek-vyprava.webp', '../brand/maskot-3d/web/ospalek-mark-64.png', '../brand/maskot-3d/web/ospalek-mark.png',
  '../brand/ikony/kat-auto.webp', '../brand/ikony/kat-dobro.webp', '../brand/ikony/kat-noc.webp', '../brand/ikony/kat-zivot.webp',
  '../brand/hodnoceni/srdce.webp', '../brand/hodnoceni/hvezda.webp', '../brand/hodnoceni/mracek.webp',
  '../covers/drak.jpg', '../covers/hadanky.jpg', '../covers/hvezdicka.jpg', '../covers/hvezdicka-f.jpg', '../covers/lednice.jpg',
  '../covers/vyprava.jpg', '../covers/vyprava-f.jpg', '../covers/zubar.jpg', '../covers/zubar-f.jpg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ospalek-') && ![APP, AUDIO, META].includes(k)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function cacheFirst(req, name) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(name)).put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(APP)).put(req, res.clone());
    return res;
  } catch (err) {
    // ?v=13 apod.: bez sítě stačí jakákoli uložená verze souboru
    const hit = (await caches.match(req)) || (await caches.match(req, { ignoreSearch: true }));
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const page = await caches.match('index.html', { ignoreSearch: true });
      if (page) return page;
    }
    throw err;
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || req.headers.has('range')) return;
  if (/\.mp3$/.test(url.pathname)) return e.respondWith(cacheFirst(req, AUDIO));
  if (/\.(webp|png|jpe?g|svg|woff2)$/.test(url.pathname)) return e.respondWith(cacheFirst(req, APP));
  e.respondWith(networkFirst(req));
});

// ---------- Večerní upozornění ----------
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data && e.data.text() }; }
  e.waitUntil((async () => {
    const titles = await caches.open(META).then((c) => c.match(new URL('titulky.json', self.registration.scope).href)).then((r) => (r ? r.json() : {})).catch(() => ({}));
    const name = d.story && titles[d.story];
    // bez uloženého názvu (aplikace dlouho neotevřená) zůstane věta bez něj: „Čeká na vás pohádka na dnešní večer.“
    const body = String(d.body || 'Čeká na vás pohádka dne.').replace(/[„"]?\{pohadka\}[“"]?/g, name ? `„${name}“` : 'na dnešní večer');
    await self.registration.showNotification(d.title || 'Je čas na pohádku', {
      body, lang: 'cs', icon: 'icon-192.png', badge: 'icon-192.png', tag: 'pohadka-dne', renotify: true,
      data: { story: d.story || null, kind: d.kind || 'daily' },
    });
  })());
});

// klepnutí na upozornění: otevřít aplikaci rovnou na pohádce dne (otevřené okno jen přepnout)
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const story = e.notification.data && e.notification.data.story;
  const url = new URL(story ? `./?pohadka=${encodeURIComponent(story)}` : './', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((w) => w.url.startsWith(self.registration.scope));
    if (win) { await win.focus(); win.postMessage({ open: story }); return; }
    await self.clients.openWindow(url);
  })());
});
