// Ovládání pohádky mimo aplikaci: zamčená obrazovka, oznámení a tlačítka na sluchátkách.
// Android (Capacitor): vlastní doplněk Prehravac (mobile/android/…/PrehravacService.java) drží pohádku
// při zhasnutém displeji a ukazuje obálku s tlačítky předchozí / přehrát-pozastavit / další.
// Jinde (web, iOS) se jen vyplní navigator.mediaSession, pokud ho prohlížeč má.
// app.js volá MEDIA.update(…) při každé změně přehrávání a MEDIA.stop() po zavření přehrávače;
// stisknutá tlačítka přicházejí do MEDIA.onAction(fn) jako 'play' | 'pause' | 'next' | 'prev' | 'stop'.

const MEDIA = (() => {
  const C = window.Capacitor;
  const plugin = C && C.isNativePlatform && C.isNativePlatform() && C.getPlatform && C.getPlatform() === 'android' && C.Plugins && C.Plugins.Prehravac;
  const ms = !plugin && 'mediaSession' in navigator ? navigator.mediaSession : null;
  let handler = () => {};
  let sentArt = null; // obálka, kterou už Android má
  let last = '';
  const arts = new Map();

  // obálka jako data URL (Android ji nenačte sám z adresy uvnitř aplikace)
  function artwork(url) {
    if (!arts.has(url)) {
      arts.set(url, fetch(url)
        .then((r) => (r.ok || r.status === 0 ? r.blob() : null))
        .then((b) => b && new Promise((res) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = () => res(null); f.readAsDataURL(b); }))
        .catch(() => null));
    }
    return arts.get(url);
  }

  if (plugin) plugin.addListener('action', (e) => handler(e && e.action));
  if (ms) {
    [['play', 'play'], ['pause', 'pause'], ['nexttrack', 'next'], ['previoustrack', 'prev'], ['stop', 'stop']].forEach(([a, b]) => {
      try { ms.setActionHandler(a, () => handler(b)); } catch (e) { /* prohlížeč akci nezná */ }
    });
  }

  async function update({ title, subtitle = 'Ospalek', cover, playing, hasPrev, hasNext }) {
    const key = JSON.stringify([title, subtitle, cover, playing, hasPrev, hasNext]);
    if (key === last) return;
    last = key;
    if (plugin) {
      const art = cover ? await artwork(cover) : null;
      const msg = { title, subtitle, playing: !!playing, hasPrev: !!hasPrev, hasNext: !!hasNext };
      if (art && art !== sentArt) { msg.artwork = art; sentArt = art; }
      plugin.update(msg).catch(() => {});
    } else if (ms && window.MediaMetadata) {
      ms.metadata = new MediaMetadata({ title, artist: subtitle, album: 'Ospalek', artwork: cover ? [{ src: new URL(cover, location.href).href, sizes: '573x768', type: 'image/jpeg' }] : [] });
      ms.playbackState = playing ? 'playing' : 'paused';
    }
  }

  function stop() {
    last = '';
    sentArt = null;
    if (plugin) plugin.stop().catch(() => {});
    else if (ms) { ms.metadata = null; ms.playbackState = 'none'; }
  }

  return { native: !!plugin, update, stop, onAction: (fn) => { handler = fn; } };
})();
