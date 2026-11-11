// Ovládání pohádky mimo aplikaci: zamčená obrazovka, oznámení a tlačítka na sluchátkách.
// Android (Capacitor): vlastní doplněk Prehravac (PrehravacService.java) drží pohádku při zhasnutém displeji
// a ukazuje obálku s tlačítky předchozí / přehrát-pozastavit / další.
// iPhone a web: navigator.mediaSession – WebKit z něj sám vyplní Právě hraje na zamčené obrazovce
// a tlačítka pošle sem; hraní po zamčení zajistí režim „audio“ v Info.plist a audioSession níže.
// app.js volá MEDIA.update(…) při každé změně přehrávání a MEDIA.stop() po zavření přehrávače;
// stisknutá tlačítka přicházejí do MEDIA.onAction(fn) jako 'play' | 'pause' | 'toggle' | 'next' | 'prev' | 'stop'.

const MEDIA = (() => {
  const C = window.Capacitor;
  const plugin = C && C.isNativePlatform && C.isNativePlatform() && C.getPlatform() === 'android' && C.Plugins && C.Plugins.Prehravac;
  // WebKit (iPhone, Safari): zvuk stránky jako přehrávání, ne „zvuky na pozadí“ – hraje i s tichým režimem
  // a po zamčení telefonu (v aplikaci s režimem pozadí audio)
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* starší WebKit */ }
  const ms = !plugin && 'mediaSession' in navigator ? navigator.mediaSession : null;
  let handler = () => {};
  let sentArt = null; // obálka, kterou už Android má
  let last = '';
  const arts = new Map();

  // obálka jako data URL (Android ani WebKit ji nenačtou samy z adresy uvnitř aplikace)
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
  const action = (a, fn) => { try { ms.setActionHandler(a, fn); } catch (e) { /* prohlížeč akci nezná */ } };
  if (ms) [['play', 'play'], ['pause', 'pause'], ['stop', 'stop']].forEach(([a, b]) => action(a, () => handler(b)));

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
      // obálka: adresa (web, WebKit v aplikaci) a záložně data URL, když adresu načíst neumí
      const art = cover ? await artwork(cover) : null;
      const pics = cover ? [{ src: new URL(cover, location.href).href, sizes: '573x768', type: 'image/jpeg' }] : [];
      if (art) pics.push({ src: art, sizes: '573x768', type: 'image/jpeg' });
      ms.metadata = new MediaMetadata({ title, artist: subtitle, album: 'Ospalek', artwork: pics });
      ms.playbackState = playing ? 'playing' : 'paused';
      // šipky jen tam, kde je kam přepnout; posouvání o sekundy pohádka nemá
      action('nexttrack', hasNext ? () => handler('next') : null);
      action('previoustrack', hasPrev ? () => handler('prev') : null);
      ['seekbackward', 'seekforward', 'seekto'].forEach((a) => action(a, null));
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
