// Přehrávač skládaného hlasu: věty odstavce se naplánují v Web Audio za sebe s přesnými mezerami,
// takže mezi nahrávkami není žádné zadrhnutí. Hlas má vlastní stopu (uzel voice), hudba a efekty
// zůstávají ve svých stopách v audio.js – nic se nemíchá do jednoho souboru.
// Nahrávky vět: audio/hlas/jana/<klíč>.mp3 + index.json (vyrábí tools/hlas). Chybějící věty umí
// dotáhnout přes tts-worker, pokud ho aplikace má nastavený.

(function () {
  const BASE = '../audio/hlas/jana/';
  // mezera mezi větami v odstavci; nahrávky mají navíc na koncích ~0,13 s vlastního ticha
  const GAP = 0.3;
  let manifest = null;
  const ready = fetch(BASE + 'index.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((m) => (manifest = m))
    .catch(() => null);
  const buffers = new Map();

  const has = (line) => !!(manifest && manifest.clips[line.key]);
  const lines = (plan) => plan.flatMap((p) => p.lines);

  function ctx() {
    ambience.ensure();
    if (!ambience.voice) {
      ambience.voice = ambience.ctx.createGain();
      ambience.voice.connect(ambience.master);
    }
    return ambience.ctx;
  }

  // Věta z tts-workeru je surová: ticho na krajích a jiná hlasitost. Upraví se stejně jako hotové
  // nahrávky z tools/hlas/cut.mjs (okraje 0,05 / 0,08 s, hlasitost řeči jako medián nahrávek).
  const TARGET_DB = -19.6;
  function tidy(buf) {
    const c = ctx(), d = buf.getChannelData(0), sr = buf.sampleRate, win = Math.round(sr * 0.02);
    const frames = [];
    for (let i = 0; i + win <= d.length; i += win) {
      let e = 0;
      for (let k = i; k < i + win; k++) e += d[k] * d[k];
      frames.push(e / win);
    }
    const loud = frames.map((e) => 10 * Math.log10(e + 1e-12) > -45);
    const first = loud.indexOf(true), last = loud.lastIndexOf(true);
    if (first < 0) return buf;
    const voiced = frames.filter((_, i) => loud[i]);
    const gain = 10 ** ((TARGET_DB - 10 * Math.log10(voiced.reduce((a, b) => a + b, 0) / voiced.length)) / 20);
    const from = Math.max(0, first * win - Math.round(sr * 0.05));
    const to = Math.min(d.length, (last + 1) * win + Math.round(sr * 0.08));
    const out = c.createBuffer(buf.numberOfChannels, to - from, sr);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const src = buf.getChannelData(ch), dst = out.getChannelData(ch);
      for (let i = 0; i < to - from; i++) dst[i] = Math.max(-1, Math.min(1, src[from + i] * gain));
    }
    return out;
  }

  // AudioBuffer jedné věty; bez nahrávky ji obstará fallback(text) → URL (tts-worker)
  function clip(line, fallback) {
    if (!buffers.has(line.key)) {
      const own = has(line);
      const url = own ? Promise.resolve(BASE + line.key + '.mp3') : fallback ? fallback(line.t) : Promise.reject(new Error('Věta zatím není namluvená.'));
      const p = url
        .then((u) => fetch(u))
        // v aplikaci pro iOS vrací Capacitor vlastní soubory .mp3 se stavem 0 (bez HTTP hlavičky), data ale dorazí
        .then((r) => { if (!r.ok && !(own && r.status === 0)) throw new Error('Nahrávku se nepodařilo načíst.'); return r.arrayBuffer(); })
        .then((b) => ctx().decodeAudioData(b))
        .then((b) => (own ? b : tidy(b)));
      p.catch(() => buffers.delete(line.key)); // chybu příště zkusit znovu
      buffers.set(line.key, p);
    }
    return buffers.get(line.key);
  }

  window.voiceLines = {
    ready,
    // pro stahování na cestu (offline.js): má věta společnou nahrávku a kde leží
    has,
    url: (line) => BASE + line.key + '.mp3',
    // kolik vět pohádky ještě nemá nahrávku
    missing: (plan) => lines(plan).filter((l) => !has(l)).length,
    prefetch(para, fallback) { para && para.lines.forEach((l) => clip(l, fallback).catch(() => {})); },
    // stejné rozhraní jako speak() v app.js: zavolá onend, vrací funkci pro zastavení
    speak(para, onend, { fallback, onerror } = {}) {
      let stopped = false;
      const srcs = [];
      let timer = null;
      Promise.all(para.lines.map((l) => clip(l, fallback))).then((bufs) => {
        if (stopped) return;
        const c = ctx();
        let t = c.currentTime + 0.05;
        bufs.forEach((b, k) => {
          const s = c.createBufferSource();
          s.buffer = b;
          s.connect(ambience.voice);
          s.start(t);
          srcs.push(s);
          t += b.duration + (k < bufs.length - 1 ? GAP : 0);
        });
        timer = setTimeout(() => { if (!stopped) onend(); }, (t - c.currentTime) * 1000);
      }).catch((e) => { if (!stopped) onerror ? onerror(e) : onend(); });
      return () => {
        stopped = true;
        clearTimeout(timer);
        srcs.forEach((s) => { try { s.stop(); } catch (e) {} });
      };
    },
  };
})();
