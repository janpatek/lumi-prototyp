// Zvuk v pozadí pohádky a zvukové efekty (Web Audio API). Podrobně tools/pozadi/README.md.
// - hudba: knihovna stylů (audio/hudba/, 5 skladeb po 2–3 min na styl), skladby hrají za sebou
//   s prolnutím, každá rozdělená na části po 30 s (kvůli paměti telefonu),
// - kulisa: smyčka ruchů prostředí (audio/pozadi/), během pohádky se může měnit podle děje,
// - efekty: krátké zvuky na místech děje (audio/efekty/), časuje je přehrávač hlasu (voice-player.js).
// Plán pohádky (styl, kulisy, efekty) je v audio/pozadi/index.json (tools/pozadi/zvuky.mjs build).
// Pohádka bez plánu dostane hudbu podle mood a efekty podle starých značek sfx.
// Zvuk v pozadí jde vypnout („Bez hudby“), volba i hlasitost se pamatují v localStorage.
// Pod hlasem se pozadí ztlumí (duck), v pauzách na odpověď a na konci se zase zesílí.

const BED = '../audio/pozadi/';
const HUDBA = '../audio/hudba/';
const EFX = '../audio/efekty/';
const MIX = { hudba: 0.8, kulisa: 0.55 }; // poměr stop; soubory mají stejnou hlasitost
const FX_LEVEL = 0.9; // efekty vůči hlasu (efekty i věty mají srovnanou hlasitost)
const PART_XF = 0.08; // prolnutí částí skladby (s)
const TRACK_XF = 2; // prolnutí skladeb (s)
const KUL_XF = 3; // prolnutí kulis při změně prostředí (s)
const STYLE_BY_MOOD = { lullaby: 'ukolebavka', adventure: 'les', road: 'auto' };
// staré značky sfx v textech pohádek → efekt z knihovny
const LEGACY_SFX = { sparkle: 'trpyt', magic: 'kouzlo', ding: 'cink', birds: 'ptaci-zpev', wind: 'vitr', owl: 'sova', paper: 'papir', horn: 'auto-troubeni', car: 'auto-start' };
const BED_LEVEL = 0.5; // celková hlasitost při posuvníku na 1
const DUCK = 0.5; // kolikrát tišeji pod hlasem
const PREF = 'ospalek-pozadi';
const pref = (() => { try { return JSON.parse(localStorage.getItem(PREF)) || {}; } catch (e) { return {}; } })();
const savePref = () => { try { localStorage.setItem(PREF, JSON.stringify(pref)); } catch (e) {} };
// v aplikaci pro iOS vrací Capacitor vlastní soubory se stavem 0 (bez HTTP hlavičky), data ale dorazí
const okLocal = (r) => r.ok || r.status === 0;
// rejstřík smyček; v mobilní aplikaci doplněný z ospalek.cz, aby kulisu měly i pohádky přidané po vydání
const bedIndex = REMOTE.index(BED + 'index.json').catch(() => null);

const MOODS = {
  // akordy jako MIDI noty, arp = kolik tónů hrací skříňky na takt
  lullaby: { bpm: 54, arp: 4, octave: 24, chords: [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]] },
  adventure: { bpm: 88, arp: 8, octave: 12, chords: [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]] },
  road: { bpm: 100, arp: 8, octave: 12, bass: true, chords: [[62, 66, 69], [57, 61, 64], [59, 62, 66], [55, 59, 62]] },
};
const hz = (m) => 440 * 2 ** ((m - 69) / 12);

class Ambience {
  constructor() {
    this.musicVol = pref.vol ?? 0.5;
    this.bedOn = pref.on !== false;
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      // pozadí (smyčky i syntetizovaná hudba) jde přes duck → master
      this.duckG = this.ctx.createGain();
      this.duckG.connect(this.master);
      this.bedBus = this.ctx.createGain();
      this.bedBus.gain.value = this.musicVol * BED_LEVEL;
      this.bedBus.connect(this.duckG);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = MIX.hudba;
      this.musicBus.connect(this.bedBus);
      this.kulBus = this.ctx.createGain();
      this.kulBus.gain.value = MIX.kulisa;
      this.kulBus.connect(this.bedBus);
      this.bedBufs = new Map();
      this.fxBufs = new Map();
      this.fxLast = {};
      this.musPos = {};
      this.music = this.ctx.createGain();
      this.music.gain.value = 0;
      this.lp = this.ctx.createBiquadFilter();
      this.lp.type = 'lowpass';
      this.lp.frequency.value = 1400;
      this.lp.connect(this.music);
      this.music.connect(this.duckG);
      this.fx = this.ctx.createGain();
      this.fx.gain.value = FX_LEVEL;
      this.fx.connect(this.master);
      this.synthFx = this.ctx.createGain(); // syntetizované efekty (záloha) jsou hlasitější než soubory
      this.synthFx.gain.value = 0.5 / FX_LEVEL;
      this.synthFx.connect(this.fx);
      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    // 'interrupted': WebKit po hovoru nebo budíku, kontext se musí znovu rozběhnout
    if (this.ctx.state === 'suspended' || this.ctx.state === 'interrupted') this.ctx.resume();
  }

  startMusic(mood) {
    this.ensure();
    this.stopMusic(true);
    this.mood = MOODS[mood] || MOODS.lullaby;
    this.bar = 0;
    this.nextBar = this.ctx.currentTime + 0.1;
    const g = this.music.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setValueAtTime(0, this.ctx.currentTime);
    g.linearRampToValueAtTime(this.musicVol * 0.35, this.ctx.currentTime + 3);
    this.timer = setInterval(() => this.schedule(), 200);
  }

  schedule() {
    const barLen = (60 / this.mood.bpm) * 4;
    while (this.nextBar < this.ctx.currentTime + 1) {
      const chord = this.mood.chords[this.bar % this.mood.chords.length];
      chord.forEach((n) => this.pad(n, this.nextBar, barLen));
      const step = barLen / this.mood.arp;
      for (let i = 0; i < this.mood.arp; i++) {
        const n = chord[[0, 1, 2, 1][i % 4]] + this.mood.octave;
        this.bell(n, this.nextBar + i * step, this.mood.arp > 4 ? 0.04 : 0.06);
      }
      if (this.mood.bass) for (let i = 0; i < 4; i++) this.pluck(chord[0] - 24, this.nextBar + i * (barLen / 4));
      this.nextBar += barLen;
      this.bar++;
    }
  }

  pad(note, t, dur) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = hz(note);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + dur * 0.3);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.6);
    o.connect(g).connect(this.lp);
    o.start(t);
    o.stop(t + dur + 0.7);
  }

  bell(note, t, vol) {
    [1, 2.01].forEach((mult, i) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.frequency.value = hz(note) * mult;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol / (i + 1), t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
      o.connect(g).connect(this.music);
      o.start(t);
      o.stop(t + 1.5);
    });
  }

  pluck(note, t) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.value = hz(note);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(this.music);
    o.start(t);
    o.stop(t + 0.4);
  }

  setMusicVolume(v) {
    this.musicVol = pref.vol = v;
    savePref();
    if (!this.ctx) return;
    this.bedBus.gain.setTargetAtTime(v * BED_LEVEL, this.ctx.currentTime, 0.2);
    if (this.timer) this.music.gain.setTargetAtTime(v * 0.35, this.ctx.currentTime, 0.2);
  }

  // --- zvuk v pozadí pohádky ---
  // Soubor (část skladby, kulisa, efekt) jako AudioBuffer. V mobilní aplikaci se, co v ní není,
  // vezme z ospalek.cz a uloží do zařízení (remote.js). Dekódované zvuky zabírají hodně paměti
  // (30 s stereo ~10 MB), drží se proto jen posledních pár, jinak by Android zabil WebView.
  buffer(rel, cache = this.bedBufs, max = 6) {
    if (!cache.has(rel)) {
      const p = REMOTE.asset(rel).then((b) => this.ctx.decodeAudioData(b));
      p.catch(() => cache.delete(rel));
      cache.set(rel, p);
      while (cache.size > max) cache.delete(cache.keys().next().value);
    } else {
      const p = cache.get(rel);
      cache.delete(rel);
      cache.set(rel, p);
    }
    return cache.get(rel);
  }

  // plán zvuků pohádky: styl hudby, kulisy podle odstavců, efekty (tools/pozadi/pohadky.json)
  plan(st) {
    return bedIndex.then((ix) => {
      if (!ix) return null;
      const p = ix.pohadky && ix.pohadky[st.id];
      const styl = (p && p.styl) || STYLE_BY_MOOD[st.mood] || 'ukolebavka';
      // kulisy: [{ od, clip }]; pohádka bez plánu může mít starou smyčku z clips
      let kul = [];
      if (p) kul = (typeof p.kulisa === 'string' ? [{ od: 0, id: p.kulisa }] : p.kulisa || []).map((k) => ({ od: k.od, clip: (k.id && ix.kulisy && ix.kulisy[k.id]) || null }));
      else if (ix.clips && ix.clips[st.id] && ix.clips[st.id].kulisa) kul = [{ od: 0, clip: ix.clips[st.id].kulisa }];
      return { ix, styl: ix.hudba && ix.hudba[styl] ? styl : null, kul, fx: p ? p.fx : null };
    }).catch(() => null);
  }

  // části skladby n ve stylu: soubor a délka těla (bez přesahů)
  parts(ix, styl, n) { return ix.hudba[styl][n].map((body, k) => ({ rel: `${HUDBA}${styl}-${n}-${k + 1}.mp3`, body })); }

  // pořadí skladeb stylu pro jednu pohádku (náhodné, aby každá pohádka nezačínala stejně);
  // pozice se pamatuje, po pauze hudba pokračuje tam, kde přestala
  position(st, pl) {
    let pos = this.musPos[st.id];
    if (!pos || pos.styl !== pl.styl) {
      const order = Object.keys(pl.ix.hudba[pl.styl]);
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      pos = this.musPos[st.id] = { styl: pl.styl, order, ti: 0, k: 0 };
    }
    return pos;
  }

  // začátek hudby a první kulisa (načíst dopředu, aby po stisku Přehrát hrály hned)
  firstFiles(st, pl) {
    const out = [];
    if (pl.styl) { const pos = this.position(st, pl); out.push(this.parts(pl.ix, pl.styl, pos.order[pos.ti])[pos.k].rel); }
    if (pl.kul[0] && pl.kul[0].clip) out.push(BED + pl.kul[0].clip.file);
    return out;
  }

  preloadBackground(st) {
    this.ensure();
    if (!this.bedOn) return;
    this.plan(st).then((pl) => pl && this.firstFiles(st, pl).forEach((f) => this.buffer(f).catch(() => {})));
  }

  // pro přípravu před Přehrát; chyba nevadí, pohádka pak hraje bez pozadí nebo se syntetizovanou hudbou
  bedsReady(st) {
    this.ensure();
    return this.plan(st).then((pl) => (pl && this.bedOn ? Promise.all(this.firstFiles(st, pl).map((f) => this.buffer(f))) : null)).catch(() => null);
  }

  // soubory pohádky pro stažení: kulisy a efekty, s music: true i celá hudba stylu (Stáhnout na cestu)
  async storyFiles(st, { music = false } = {}) {
    const pl = await this.plan(st);
    if (!pl) return [];
    const out = new Set();
    pl.kul.forEach((k) => k.clip && out.add(BED + k.clip.file));
    new Set((pl.fx || []).map((f) => f.fx)).forEach((id) => Object.keys(pl.ix.fx[id] || {}).forEach((v) => out.add(`${EFX}${id}-${v}.mp3`)));
    if (music && pl.styl) Object.keys(pl.ix.hudba[pl.styl]).forEach((n) => this.parts(pl.ix, pl.styl, n).forEach((p) => out.add(p.rel)));
    return [...out];
  }

  // i = odstavec, od kterého se hraje (kvůli kulise)
  startBackground(st, i = 0) {
    this.ensure();
    this.stopBackground(true);
    this.duck(false);
    if (!this.bedOn) return;
    const c = this.ctx;
    const sess = (this.bed = { st, musG: c.createGain(), kulG: c.createGain(), srcs: new Set(), sched: [], timer: null, kul: null, kulFile: undefined });
    const t0 = c.currentTime + 0.05;
    [[sess.musG, this.musicBus], [sess.kulG, this.kulBus]].forEach(([g, bus]) => {
      g.connect(bus);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(1, t0 + 2.5);
    });
    this.plan(st).then((pl) => {
      if (this.bed !== sess) return;
      sess.pl = pl;
      if (pl && pl.styl) {
        sess.pos = this.position(st, pl);
        sess.nextT = t0;
        this.queuePart(sess);
        sess.timer = setInterval(() => this.queuePart(sess), 1000);
      } else {
        this.startMusic(st.mood); // knihovna hudby není k dispozici: syntetizovaná podle nálady
        this.bedSynth = true;
      }
      if (pl) this.scene(i);
    });
  }

  // naplánuje další část skladby, když se blíží konec té, co hraje
  queuePart(sess) {
    if (this.bed !== sess || sess.loading || this.ctx.currentTime < sess.nextT - 8) return;
    const { pl, pos } = sess;
    const parts = this.parts(pl.ix, pl.styl, pos.order[pos.ti]);
    const part = parts[pos.k];
    const at = { ti: pos.ti, k: pos.k };
    sess.loading = true;
    this.buffer(part.rel).then((buf) => {
      sess.loading = false;
      if (this.bed !== sess) return;
      sess.fails = 0;
      const c = this.ctx, pad = pl.ix.pad || 0.5;
      // první část skladby se prolne s doznívající předchozí (skladby mají náběh a doznění)
      let when = sess.nextT - (at.k === 0 && sess.sched.length ? TRACK_XF : 0);
      when = Math.max(c.currentTime + PART_XF, when);
      const s = c.createBufferSource();
      s.buffer = buf;
      const g = c.createGain();
      // části na sebe navazují s krátkým prolnutím přesahu (pad), posun dekodéru MP3 tak nevadí
      const a = when - PART_XF / 2, b = when + part.body + PART_XF / 2;
      g.gain.setValueAtTime(0, a);
      g.gain.linearRampToValueAtTime(1, a + PART_XF);
      g.gain.setValueAtTime(1, b - PART_XF);
      g.gain.linearRampToValueAtTime(0, b);
      s.connect(g).connect(sess.musG);
      s.start(a, Math.max(0, pad - PART_XF / 2), part.body + PART_XF);
      sess.srcs.add(s);
      s.onended = () => sess.srcs.delete(s);
      sess.sched.push({ ...at, start: when, end: when + part.body });
      if (sess.sched.length > 4) sess.sched.shift();
      sess.nextT = when + part.body;
      pos.k++;
      if (pos.k >= parts.length) { pos.k = 0; pos.ti = (pos.ti + 1) % pos.order.length; }
      this.buffer(this.parts(pl.ix, pl.styl, pos.order[pos.ti])[pos.k].rel).catch(() => {}); // další dopředu
    }).catch(() => {
      sess.loading = false;
      // část se nenačetla (bez internetu): zkusit další skladbu, po několika chybách hudbu nechat být
      if (++sess.fails > 3 || this.bed !== sess) { clearInterval(sess.timer); return; }
      pos.k = 0;
      pos.ti = (pos.ti + 1) % pos.order.length;
    });
  }

  // kulisa podle odstavce i (plán může prostředí během pohádky měnit; mění se prolnutím)
  scene(i) {
    const sess = this.bed;
    if (!sess || !sess.pl || !this.ctx) return;
    let cur = null;
    sess.pl.kul.forEach((k) => { if (k.od <= i) cur = k.clip; });
    const file = cur ? cur.file : null;
    if (file === sess.kulFile) return;
    const first = sess.kulFile === undefined;
    sess.kulFile = file;
    const c = this.ctx;
    if (sess.kul) {
      const { s, g } = sess.kul, t = c.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + KUL_XF);
      try { s.stop(t + KUL_XF + 0.1); } catch (e) {}
      sess.kul = null;
    }
    if (!cur) return;
    const pad = sess.pl.ix.pad || 0.5;
    this.buffer(BED + cur.file).then((buf) => {
      if (this.bed !== sess || sess.kulFile !== file) return;
      // smyčka mezi okraji: soubor má před tělem jeho konec a za ním začátek, takže
      // posun dekodéru MP3 (ticho kodéru) nevadí a smyčka navazuje bez mezery
      const s = c.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.loopStart = pad;
      s.loopEnd = pad + cur.body;
      const g = c.createGain();
      const t = c.currentTime + 0.05;
      g.gain.setValueAtTime(first ? 1 : 0, t);
      if (!first) g.gain.linearRampToValueAtTime(1, t + KUL_XF);
      s.connect(g).connect(sess.kulG);
      s.start(t, pad + Math.random() * cur.body * 0.9); // smyčka nezačíná pokaždé stejně
      sess.srcs.add(s);
      sess.kul = { s, g };
    }).catch(() => {});
  }

  stopBackground(now) {
    this.stopMusic(now);
    this.bedSynth = false;
    const sess = this.bed;
    this.bed = null;
    if (!sess || !this.ctx) return;
    clearInterval(sess.timer);
    const t = this.ctx.currentTime, fade = now ? 0.15 : 4;
    [sess.musG, sess.kulG].forEach((g) => {
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + fade);
    });
    sess.srcs.forEach((s) => { try { s.stop(t + fade + 0.05); } catch (e) {} });
    // po pauze hudba pokračuje částí skladby, která právě hrála (ne až těmi naplánovanými dopředu)
    const playing = sess.sched.find((p) => p.start <= t && t < p.end) || sess.sched[0];
    if (sess.pos && playing) { sess.pos.ti = playing.ti; sess.pos.k = playing.k; }
    setTimeout(() => { sess.musG.disconnect(); sess.kulG.disconnect(); }, (fade + 0.2) * 1000);
  }

  // „Bez hudby“: vypne hudbu a kulisy (efekty v textu hrají dál) a zapamatuje si to
  setBackgroundOn(on) {
    this.bedOn = pref.on = on;
    savePref();
  }

  // --- efekty z knihovny (audio/efekty) ---
  // efekty odstavců pohádky: pro každý odstavec [{ line, kdy, fx }] (line = věta odstavce)
  async storyFx(st, segs, plan) {
    const pl = await this.plan(st);
    const out = segs.map(() => []);
    // věta, ke které efekt patří; úryvek přes dvě věty („Cink. Cink.“): pred → první, po → poslední
    const lineOf = (i, at, kdy) => {
      const lines = (plan && plan[i] && plan[i].lines) || [];
      let k = lines.findIndex((l) => l.t.includes(at));
      if (k < 0) {
        const parts = at.split(/(?<=[.!?…“])\s+/);
        const part = kdy === 'po' ? parts[parts.length - 1] : parts[0];
        k = kdy === 'po' ? lines.map((l) => l.t.includes(part)).lastIndexOf(true) : lines.findIndex((l) => l.t.includes(part));
      }
      if (k < 0) { const w = at.split(/\s+/).slice(0, 2).join(' '); k = lines.findIndex((l) => l.t.includes(w)); }
      return Math.max(0, k);
    };
    if (pl && pl.fx) {
      pl.fx.forEach((f) => {
        // úryvek v odstavci p; když se text pohádky mezitím změnil, hledá se v celé pohádce
        let i = segs[f.p] && segs[f.p].t.includes(f.at) ? f.p : segs.findIndex((s) => s.t.includes(f.at));
        if (i < 0) return;
        if (pl.ix.fx[f.fx]) out[i].push({ line: lineOf(i, f.at, f.kdy), kdy: f.kdy, fx: f.fx });
      });
    } else {
      // pohádka bez plánu (třeba nová z administrace): staré značky sfx → efekt z knihovny
      segs.forEach((s, i) => { const id = s.sfx && LEGACY_SFX[s.sfx]; if (id && pl && pl.ix.fx && pl.ix.fx[id]) out[i].push({ line: 0, kdy: 'pred', fx: id }); });
    }
    return out;
  }

  // AudioBuffer náhodné varianty efektu (ne stejné jako minule)
  fxBuffer(id) {
    this.ensure();
    return bedIndex.then((ix) => {
      const vs = Object.keys((ix && ix.fx && ix.fx[id]) || {});
      if (!vs.length) throw new Error('Efekt chybí.');
      const last = this.fxLast[id];
      const pick = vs.length > 1 ? vs.filter((v) => v !== last) : vs;
      const v = pick[Math.floor(Math.random() * pick.length)];
      this.fxLast[id] = v;
      return this.buffer(`${EFX}${id}-${v}.mp3`, this.fxBufs, 24);
    });
  }

  // přehraje efekt v čase when; soft = tišeji (pod hlasem, uspávanky); duckAt = od kdy mluví hlas
  playFx(buf, when, { soft = 1, duckAt } = {}) {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = buf;
    const g = c.createGain();
    g.gain.setValueAtTime(soft, when);
    // delší efekt (déšť, vlak) pod hlasem ztišit, ať nepřehluší vyprávění
    if (duckAt && duckAt < when + buf.duration) {
      g.gain.setValueAtTime(soft, Math.max(when, duckAt - 0.2));
      g.gain.linearRampToValueAtTime(soft * 0.4, Math.max(when, duckAt - 0.2) + 0.4);
    }
    s.connect(g).connect(this.fx);
    s.start(when);
    return s;
  }

  // pod hlasem ztišit, v pauzách zesílit (rychlý nástup, pomalý návrat)
  duck(on) {
    if (!this.ctx) return;
    this.duckG.gain.setTargetAtTime(on ? DUCK : 1, this.ctx.currentTime, on ? 0.15 : 0.8);
  }

  stopMusic(now) {
    clearInterval(this.timer);
    this.timer = null;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.music.gain.cancelScheduledValues(t);
    this.music.gain.setValueAtTime(this.music.gain.value, t);
    this.music.gain.linearRampToValueAtTime(0, t + (now ? 0.05 : 4));
  }

  // --- efekty ---
  tone(freq, t, dur, { type = 'sine', vol = 0.2, to } = {}) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.synthFx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noiseBurst(t, dur, { freq = 800, type = 'lowpass', vol = 0.3, to } = {}) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + dur * 0.3);
    g.gain.linearRampToValueAtTime(0, t + dur);
    s.connect(f).connect(g).connect(this.synthFx);
    s.start(t);
    s.stop(t + dur);
  }

  // efekt hned (hlas jiný než skládaný): id z knihovny, nebo stará značka sfx; když se soubor
  // nenačte, zahraje se syntetizovaná náhrada staré značky
  sfx(name, opts) {
    this.ensure();
    const id = LEGACY_SFX[name] || name;
    this.fxBuffer(id).then((buf) => this.playFx(buf, this.ctx.currentTime + 0.05, opts)).catch(() => LEGACY_SFX[name] && this.sfxSynth(name));
  }

  sfxSynth(name) {
    const t = this.ctx.currentTime + 0.05;
    const r = Math.random;
    switch (name) {
      case 'sparkle':
        for (let i = 0; i < 8; i++) this.tone(2000 + r() * 2500, t + i * 0.08, 0.4, { vol: 0.08 });
        break;
      case 'magic':
        this.tone(300, t, 1.2, { to: 1800, vol: 0.12, type: 'triangle' });
        for (let i = 0; i < 6; i++) this.tone(1500 + i * 300, t + 0.4 + i * 0.1, 0.5, { vol: 0.06 });
        break;
      case 'ding':
        this.tone(1318, t, 1.2, { vol: 0.15 });
        this.tone(1976, t + 0.12, 1.2, { vol: 0.1 });
        break;
      case 'car':
        this.noiseBurst(t, 2.2, { freq: 180, vol: 0.5 });
        this.tone(55, t, 2.2, { type: 'sawtooth', vol: 0.06, to: 90 });
        break;
      case 'horn':
        [0, 0.3].forEach((d) => { this.tone(440, t + d, 0.22, { type: 'square', vol: 0.06 }); this.tone(554, t + d, 0.22, { type: 'square', vol: 0.05 }); });
        break;
      case 'birds':
        for (let i = 0; i < 6; i++) { const s = t + i * 0.25 + r() * 0.1; this.tone(2600 + r() * 800, s, 0.12, { to: 3800, vol: 0.06 }); }
        break;
      case 'owl':
        this.tone(420, t, 0.35, { to: 380, vol: 0.15 });
        this.tone(420, t + 0.6, 0.9, { to: 360, vol: 0.15 });
        break;
      case 'paper':
        for (let i = 0; i < 5; i++) this.noiseBurst(t + i * 0.09, 0.08, { freq: 3000, type: 'bandpass', vol: 0.4 });
        break;
      case 'wind':
        this.noiseBurst(t, 3, { freq: 300, to: 1200, vol: 0.25 });
        break;
    }
  }
}

window.ambience = new Ambience();
