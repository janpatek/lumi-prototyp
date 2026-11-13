// Ovládání pohádky mimo aplikaci: zamčená obrazovka, oznámení a tlačítka na sluchátkách.
// Aplikace pro Android a iPhone (Capacitor): vlastní doplněk Prehravac – na Androidu PrehravacService.java
// (služba v popředí drží pohádku při zhasnutém displeji), na iPhonu PrehravacPlugin.swift (Právě hraje,
// tlačítka, přerušení hovorem). Ukazuje obálku s tlačítky předchozí / přehrát-pozastavit / další.
// Web: navigator.mediaSession – prohlížeč z něj sám vyplní ovládání a tlačítka pošle sem.
// (Na iPhonu jen jako záloha: WebKit z ní pro Web Audio ukáže jen název, bez obálky a tlačítek.)
// app.js volá MEDIA.update(…) při každé změně přehrávání a MEDIA.stop() po zavření přehrávače;
// stisknutá tlačítka přicházejí do MEDIA.onAction(fn) jako 'play' | 'pause' | 'toggle' | 'next' | 'prev' | 'stop'.

const MEDIA = (() => {
  const C = window.Capacitor;
  const plugin = C && C.isNativePlatform && C.isNativePlatform() && ['android', 'ios'].includes(C.getPlatform()) && C.Plugins && C.Plugins.Prehravac;
  // WebKit (iPhone, Safari): zvuk stránky jako přehrávání, ne „zvuky na pozadí“ – hraje i s tichým režimem
  // a po zamčení telefonu (v aplikaci s režimem pozadí audio v Info.plist)
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* starší WebKit */ }
  const ios = !!plugin && C.getPlatform() === 'ios';
  // Na iPhonu se mediaSession vyplní i vedle doplňku: WebKit si pro hrající Web Audio založí vlastní
  // Právě hraje, a když ho iOS zvolí (hlavně v prvních vteřinách), ukazoval by jen „localhost“.
  // S metadaty ukáže aspoň správný název a jeho tlačítka přijdou sem stejně jako od doplňku.
  const ms = (!plugin || ios) && 'mediaSession' in navigator ? navigator.mediaSession : null;
  let handler = () => {};
  let sentArt = null; // obálka, kterou už doplněk má
  let sentCover; // iPhone: obálka které pohádky se naposledy poslala
  let last = '';
  let gen = 0; // stop() zneplatní aktualizace, které ještě čekají na obálku
  const arts = new Map();

  // obálka jako data URL (doplněk ani WebKit ji nenačtou samy z adresy uvnitř aplikace)
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

  function session({ title, subtitle, cover, playing, hasPrev, hasNext }, art) {
    if (!ms || !window.MediaMetadata) return;
    // obálka: adresa (web, WebKit v aplikaci) a záložně data URL, když adresu načíst neumí
    const pics = cover ? [{ src: new URL(cover, location.href).href, sizes: '573x768', type: 'image/jpeg' }] : [];
    if (art) pics.push({ src: art, sizes: '573x768', type: 'image/jpeg' });
    ms.metadata = new MediaMetadata({ title, artist: subtitle, album: 'Ospalek', artwork: pics });
    ms.playbackState = playing ? 'playing' : 'paused';
    // šipky jen tam, kde je kam přepnout; posouvání o sekundy pohádka nemá
    action('nexttrack', hasNext ? () => handler('next') : null);
    action('previoustrack', hasPrev ? () => handler('prev') : null);
    ['seekbackward', 'seekforward', 'seekto'].forEach((a) => action(a, null));
  }

  async function update({ title, subtitle = 'Ospalek', cover, playing, hasPrev, hasNext }) {
    const st = { title, subtitle, cover, playing, hasPrev, hasNext };
    const key = JSON.stringify([title, subtitle, cover, playing, hasPrev, hasNext]);
    if (key === last) return;
    last = key;
    const my = gen;
    const msg = { title, subtitle, playing: !!playing, hasPrev: !!hasPrev, hasNext: !!hasNext };
    if (ios) {
      // iPhone: název a tlačítka hned, obálka až bude načtená. Kdyby se čekalo na obálku, iOS by
      // mezitím ukázal Právě hraje od WebKitu („localhost“). Jiná pohádka = stará obálka pryč.
      if (cover !== sentCover) { msg.artwork = ''; sentArt = null; sentCover = cover; }
      plugin.update(msg).catch(() => {});
      session(st, null);
      const art = cover ? await artwork(cover) : null;
      if (my !== gen || key !== last || !art || art === sentArt) return;
      sentArt = art;
      plugin.update({ ...msg, artwork: art }).catch(() => {});
      session(st, art);
    } else if (plugin) {
      const art = cover ? await artwork(cover) : null;
      if (my !== gen || key !== last) return; // pohádka se mezitím zavřela nebo přišel novější stav
      if (art && art !== sentArt) { msg.artwork = art; sentArt = art; }
      plugin.update(msg).catch(() => {});
    } else if (ms) {
      const art = cover ? await artwork(cover) : null;
      session(st, art);
    }
  }

  function stop() {
    gen++;
    last = '';
    sentArt = null;
    sentCover = undefined;
    if (plugin) plugin.stop().catch(() => {});
    if (ms) { ms.metadata = null; ms.playbackState = 'none'; }
  }

  return { native: !!plugin, update, stop, onAction: (fn) => { handler = fn; } };
})();
