// Podkladová hudba a zvukové efekty syntetizované přímo v prohlížeči (Web Audio API).
// V produkci nahradí nahrané / vygenerované stopy (ElevenLabs Music, licencovaná hudba).

const MOODS = {
  // akordy jako MIDI noty, arp = kolik tónů hrací skříňky na takt
  lullaby: { bpm: 54, arp: 4, octave: 24, chords: [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]] },
  adventure: { bpm: 88, arp: 8, octave: 12, chords: [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]] },
  road: { bpm: 100, arp: 8, octave: 12, bass: true, chords: [[62, 66, 69], [57, 61, 64], [59, 62, 66], [55, 59, 62]] },
};
const hz = (m) => 440 * 2 ** ((m - 69) / 12);

class Ambience {
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.music = this.ctx.createGain();
      this.music.gain.value = 0;
      this.lp = this.ctx.createBiquadFilter();
      this.lp.type = 'lowpass';
      this.lp.frequency.value = 1400;
      this.lp.connect(this.music);
      this.music.connect(this.master);
      this.fx = this.ctx.createGain();
      this.fx.gain.value = 0.5;
      this.fx.connect(this.master);
      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.musicVol = 0.5;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
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
    this.musicVol = v;
    if (this.ctx && this.timer) this.music.gain.setTargetAtTime(v * 0.35, this.ctx.currentTime, 0.2);
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
    o.connect(g).connect(this.fx);
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
    s.connect(f).connect(g).connect(this.fx);
    s.start(t);
    s.stop(t + dur);
  }

  sfx(name) {
    this.ensure();
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
