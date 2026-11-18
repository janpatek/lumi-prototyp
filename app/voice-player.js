// Přehrávač skládaného hlasu: věty odstavce se naplánují v Web Audio za sebe s přesnými mezerami,
// takže mezi nahrávkami není žádné zadrhnutí. Hlas má vlastní stopu (uzel voice), hudba a efekty
// zůstávají ve svých stopách v audio.js – nic se nemíchá do jednoho souboru.
// Nahrávky vět: audio/hlas/jana/<klíč>.mp3 + index.json (vyrábí tools/hlas). Chybějící věty umí
// dotáhnout přes tts-worker, pokud ho aplikace má nastavený. Kde věta leží (v aplikaci, v zařízení,
// nebo se stáhne z ospalek.cz), rozhoduje remote.js.

(function () {
  const BASE = '../audio/hlas/jana/';
  // mezera mezi větami v odstavci; nahrávky mají navíc na koncích ~0,13 s vlastního ticha
  const GAP = 0.3;
  let manifest = null;
  const ready = REMOTE.index(BASE + 'index.json')
    .then((m) => (manifest = m))
    .catch(() => null);
  const buffers = new Map(); // klíč věty → Promise<AudioBuffer>, nejstarší první
  const MAX_CLIPS = 40;

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

  // Načítání věty nesmí viset donekonečna: bez časového limitu by pohádka uprostřed tiše stála
  // (hudba hraje dál, hlas ne), když se síť zadrhne nebo Worker neodpoví.
  const LOAD_LIMIT = 20000;
  const timeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('Hlas se načítá moc dlouho.')), ms))]);

  // AudioBuffer jedné věty; bez nahrávky ji obstará fallback(text) → URL (tts-worker)
  function clip(line, fallback) {
    if (!buffers.has(line.key)) {
      const own = has(line);
      const src = own ? REMOTE.clip(line.key) : fallback ? fallback(line.t).then((url) => ({ url, local: false })) : Promise.reject(new Error('Věta zatím není namluvená.'));
      const p = timeout(src
        .then((s) => fetch(s.url).then((r) => {
          // v aplikaci pro iOS vrací Capacitor vlastní soubory .mp3 se stavem 0 (bez HTTP hlavičky), data ale dorazí
          if (!r.ok && !(s.local && r.status === 0)) throw new Error('Nahrávku se nepodařilo načíst.');
          return r.arrayBuffer();
        }).then((b) => {
          // věta stažená z webu se uloží do zařízení, příště hraje i bez internetu (kopie: dekodér buffer vyprázdní)
          if (s.store) REMOTE.save(line.key, b.slice(0)).catch(() => {});
          return b;
        }))
        .then((b) => ctx().decodeAudioData(b))
        .then((b) => (own ? b : tidy(b))), LOAD_LIMIT);
      p.catch(() => buffers.delete(line.key)); // chybu příště zkusit znovu
      buffers.set(line.key, p);
      // Dekódovaná věta zabírá ~0,2 MB za sekundu. Bez limitu by dlouhá pohádka (nebo několik za sebou)
      // nafoukla paměť WebView na stovky MB a Android by ji na slabším telefonu zabil – aplikace spadla.
      // Drží se jen posledních MAX_CLIPS vět (aktuální a příští odstavec se vejdou vždycky).
      while (buffers.size > MAX_CLIPS) buffers.delete(buffers.keys().next().value);
    } else {
      // znovu použitá věta je zase „nejčerstvější“
      const p = buffers.get(line.key);
      buffers.delete(line.key);
      buffers.set(line.key, p);
    }
    return buffers.get(line.key);
  }

  window.voiceLines = {
    ready,
    // pro stahování na cestu (offline.js): má věta společnou nahrávku a kde leží
    has,
    url: (line) => BASE + line.key + '.mp3',
    key: (url) => (url.startsWith(BASE) ? url.slice(BASE.length, -4) : null),
    // kolik vět pohádky ještě nemá nahrávku
    missing: (plan) => lines(plan).filter((l) => !has(l)).length,
    // délka odstavce v sekundách (z rejstříku; věty bez nahrávky odhadem podle délky textu) – čas v přehrávači
    seconds: (para) => (para ? para.lines.reduce((a, l) => a + (has(l) && manifest.clips[l.key].d ? manifest.clips[l.key].d : l.t.length / 14), 0) + GAP * Math.max(0, para.lines.length - 1) : 0),
    prefetch(para, fallback, fx) {
      para && para.lines.forEach((l) => clip(l, fallback).catch(() => {}));
      (fx || []).forEach((f) => ambience.fxBuffer(f.fx).catch(() => {}));
    },
    // stejné rozhraní jako speak() v app.js: zavolá onend, vrací funkci pro zastavení.
    // fx: efekty odstavce [{ line, kdy, fx }] (audio.js storyFx): pred = efekt, pak věta;
    // po = po větě; spolu = tiše pod začátkem věty. soft = hlasitost efektů (uspávanky tišeji).
    speak(para, onend, { fallback, onerror, fx = [], soft = 1 } = {}) {
      let stopped = false;
      const srcs = [];
      let timer = null;
      // jeden tichý pokus navíc (nepovedené věty se z mezipaměti smazaly, načtou se znovu)
      const load = () => Promise.all(para.lines.map((l) => clip(l, fallback)));
      // efekt, který se nenačte, se vynechá (pohádka kvůli němu nečeká ani nespadne)
      const fxLoad = Promise.all(fx.map((f) => ambience.fxBuffer(f.fx).then((buf) => ({ ...f, buf })).catch(() => null)));
      Promise.all([load().catch(() => new Promise((r) => setTimeout(r, 1500)).then(() => (stopped ? [] : load()))), fxLoad]).then(([bufs, fxs]) => {
        if (stopped) return;
        const c = ctx();
        let t = c.currentTime + 0.05;
        const lead = (b) => Math.min(b.duration, 1.6);
        const at = (k, kdy) => fxs.filter((f) => f && f.line === k && f.kdy === kdy);
        bufs.forEach((b, k) => {
          at(k, 'pred').forEach((f) => { srcs.push(ambience.playFx(f.buf, t, { soft, duckAt: t + lead(f.buf) + 0.2 })); t += lead(f.buf) + 0.2; });
          at(k, 'spolu').forEach((f) => srcs.push(ambience.playFx(f.buf, t, { soft: soft * 0.6, duckAt: t + 0.3 })));
          const s = c.createBufferSource();
          s.buffer = b;
          s.connect(ambience.voice);
          s.start(t);
          srcs.push(s);
          t += b.duration;
          at(k, 'po').forEach((f) => { t += 0.15; srcs.push(ambience.playFx(f.buf, t, { soft })); t += lead(f.buf); });
          if (k < bufs.length - 1) t += GAP;
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
