// Service worker webové aplikace: aby se Ospalek otevřel i bez internetu.
// - kód aplikace (HTML, JS, CSS, JSON): nejdřív síť, bez sítě poslední uložená verze → aktualizace přijdou hned
// - obrázky a písmo: z cache, chybějící se stáhnou a uloží
// - nahrávky vět (.mp3): z cache AUDIO, chybějící se stáhnou a uloží → co jednou hrálo, hraje i offline
// Požadavky na jiné servery (hlas, databáze, mapy) se nechávají být.
// Názvy cache musí sedět s offline.js. Po novém namluvení společných vět zvyš číslo v AUDIO.

const APP = 'ospalek-app-1';
const AUDIO = 'ospalek-hlas-1';
const SHELL = [
  './', 'index.html', 'styles.css', 'fonts/fonts.css',
  'fonts/fredoka-latin.woff2', 'fonts/fredoka-latin-ext.woff2', 'fonts/nunito-latin.woff2', 'fonts/nunito-latin-ext.woff2',
  'stories.cs.js', 'recordings.js', 'audio.js', 'voice-lines.js', 'voice-player.js', 'offline.js', 'sync.js', 'app.js',
  'manifest.webmanifest', 'icon-192.png', 'icon-512.png', '../gate.js', '../config.js', '../audio/hlas/jana/index.json',
  '../brand/maskot-3d/web/ospalek-mark.webp', '../brand/maskot-3d/web/ospalek-hlava.webp', '../brand/maskot-3d/web/ospalek-spi.webp',
  '../brand/maskot-3d/web/ospalek-vyprava.webp', '../brand/maskot-3d/web/ospalek-mark-64.png', '../brand/maskot-3d/web/ospalek-mark.png',
  '../brand/ikony/kat-auto.webp', '../brand/ikony/kat-dobro.webp', '../brand/ikony/kat-noc.webp', '../brand/ikony/kat-zivot.webp',
  '../covers/drak.jpg', '../covers/hadanky.jpg', '../covers/hvezdicka.jpg', '../covers/hvezdicka-f.jpg', '../covers/lednice.jpg',
  '../covers/vyprava.jpg', '../covers/vyprava-f.jpg', '../covers/zubar.jpg', '../covers/zubar-f.jpg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ospalek-') && k !== APP && k !== AUDIO).map((k) => caches.delete(k))))
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
