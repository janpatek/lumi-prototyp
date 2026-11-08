// Rozstříhá namluvenou dávku na věty a uloží je do audio/hlas/<hlas>/<klíč>.mp3 + index.json.
//   node tools/hlas/cut.mjs <dávka> <nahrávka.mp3> [začátky.json]
// <dávka> je název z plan.mjs (např. hvezdicka-spolecne). Hranice vět hledá v tichu:
//  - bez začátků: vybere pauzy, které nejlíp sedí na odhad konce vět podle počtu znaků,
//  - se začátky (pole sekund, jedna na větu, z časování slov): střih v tichu nejblíž každému začátku.
// Nakonec zkontroluje tempo každé věty; když nějaká vybočuje, střih je špatně a index.json se nezmění.
// Celá dávka se nejdřív srovná na stejnou hlasitost (-19 LUFS), aby věty z různých dávek seděly k sobě.
// Potřebuje ffmpeg: proměnná FFMPEG, jinak `ffmpeg` z PATH.
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync, spawnSync } from 'child_process';
import { ROOT, CLIPS, readManifest, writeManifest } from './lib.mjs';

const FF = process.env.FFMPEG || 'ffmpeg';
const [name, take, anchorsFile] = process.argv.slice(2);
if (!name || !take) { console.log('Použití: node tools/hlas/cut.mjs <dávka> <nahrávka.mp3> [začátky.json]'); process.exit(1); }
const batch = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/hlas/davky', name + '.json'), 'utf8'));
const lines = batch.lines;
const anchors = anchorsFile ? JSON.parse(fs.readFileSync(anchorsFile, 'utf8')) : null;
if (anchors && anchors.length !== lines.length) throw new Error(`Začátků je ${anchors.length}, vět ${lines.length}.`);

const ff = (args) => execFileSync(FF, ['-hide_banner', '-nostats', '-y', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 });
// výpis ffmpegu (jde na stderr) – pro detekci ticha a délku
const ffLog = (args) => spawnSync(FF, ['-hide_banner', '-nostats', ...args], { encoding: 'utf8', maxBuffer: 1 << 26 }).stderr;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hlas-'));
const wav = path.join(tmp, 'take.wav');
ff(['-i', take, '-af', 'loudnorm=I=-19:TP=-2:LRA=9', '-ar', '44100', '-ac', '1', wav]);

// ticha: [začátek, konec]
function silences(db, min) {
  const log = ffLog(['-i', wav, '-af', `silencedetect=n=${db}dB:d=${min}`, '-f', 'null', '-']);
  const out = [];
  let s0 = null;
  for (const l of String(log).split('\n')) {
    const a = l.match(/silence_start: ([\d.]+)/); if (a) s0 = +a[1];
    const b = l.match(/silence_end: ([\d.]+)/); if (b) { out.push([Math.max(0, s0 ?? 0), +b[1]]); s0 = null; }
  }
  if (s0 !== null) out.push([s0, total]);
  return out;
}
const durLine = ffLog(['-i', wav]).match(/Duration: (\d+):(\d+):([\d.]+)/);
const total = +durLine[1] * 3600 + +durLine[2] * 60 + +durLine[3];
const sil = silences(-42, 0.18);

// nejtišší 20ms okno v úseku (pro věty, které vypravěčka spojila bez pauzy)
let pcm = null;
function quietest(a, b) {
  if (!pcm) {
    const raw = execFileSync(FF, ['-v', 'error', '-i', wav, '-f', 's16le', '-ac', '1', '-ar', '44100', '-'], { maxBuffer: 1 << 28 });
    pcm = new Int16Array(raw.buffer, raw.byteOffset, raw.length >> 1);
  }
  const win = 882, step = 220;
  let best = Infinity, at = a;
  for (let i = Math.max(0, Math.floor(a * 44100)); i + win < Math.min(pcm.length, b * 44100); i += step) {
    let e = 0;
    for (let k = i; k < i + win; k++) e += pcm[k] * pcm[k];
    if (e < best) { best = e; at = (i + win / 2) / 44100; }
  }
  return at;
}

// začátek a konec řeči v nahrávce
const head0 = () => (sil[0] && sil[0][0] <= 0.05 ? sil[0][1] : 0);
const tail0 = () => (sil.length && sil[sil.length - 1][1] >= total - 0.05 ? sil[sil.length - 1][0] : total);

// Vybere N-1 tich jako hranice vět: dlouhé ticho je dobré, a mělo by ležet tam, kam podle počtu
// znaků věta zhruba skončí (tempo vypravěčky je v jedné dávce stálé). Dynamické programování.
function align(cands, lines, start, end) {
  const n = lines.length - 1;
  if (cands.length < n) throw new Error(`V nahrávce je jen ${cands.length} pauz na ${n} hranic mezi větami.`);
  const w = lines.map((l) => l.t.replace(/[^\p{L}\p{N}]/gu, '').length + 4);
  const sum = w.reduce((a, b) => a + b, 0);
  let acc = 0;
  const exp = w.slice(0, -1).map((x) => start + ((acc += x) / sum) * (end - start));
  const span = end - start;
  const cost = (i, j) => Math.abs((cands[j][0] + cands[j][1]) / 2 - exp[i]) / span * 40 - (cands[j][1] - cands[j][0]) * 6;
  // dp[i][j] = nejlepší cena, když hranice i je ticho j
  const dp = exp.map(() => cands.map(() => Infinity));
  const from = exp.map(() => cands.map(() => -1));
  for (let j = 0; j < cands.length; j++) dp[0][j] = cost(0, j);
  for (let i = 1; i < n; i++) {
    let best = Infinity, bj = -1;
    for (let j = i; j < cands.length; j++) {
      if (dp[i - 1][j - 1] < best) { best = dp[i - 1][j - 1]; bj = j - 1; }
      dp[i][j] = best + cost(i, j);
      from[i][j] = bj;
    }
  }
  let j = dp[n - 1].indexOf(Math.min(...dp[n - 1]));
  const out = [];
  for (let i = n - 1; i >= 0; i--) { out.unshift(cands[j]); j = from[i][j]; }
  return out;
}

// hranice mezi větami = ticho
let gaps;
const inner = sil.filter(([a, b]) => a > 0.05 && b < total - 0.05);
if (anchors) {
  // i krátké nádechy mezi větami (vypravěčka je někdy spojí skoro bez pauzy)
  const fine = silences(-36, 0.05).filter(([a, b]) => a > 0.05 && b < total - 0.05);
  gaps = anchors.slice(1).map((t, k) => {
    const cand = fine.filter(([a, b]) => b > t - 0.5 && a < t + 0.25);
    if (!cand.length) {
      // věty spojené bez pauzy: střih v nejtišším místě mezi slovy
      const c = quietest(t - 0.25, t + 0.15);
      console.warn(`Pozor: věta ${k + 2} („${lines[k + 1].t.slice(0, 40)}…“) navazuje bez pauzy, střih v nejtišším místě ${c.toFixed(2)} s.`);
      return [c - 0.005, c + 0.005];
    }
    return cand.sort((x, y) => (Math.abs(x[1] - t) - (x[1] - x[0])) - (Math.abs(y[1] - t) - (y[1] - y[0])))[0];
  });
} else {
  gaps = align(inner, lines, head0(), tail0());
}

const head = sil[0] && sil[0][0] <= 0.05 ? sil[0][1] : 0;
const tail = sil.length && sil[sil.length - 1][1] >= total - 0.05 ? sil[sil.length - 1][0] : total;

const m = readManifest();
const rates = [];
fs.mkdirSync(CLIPS, { recursive: true });
lines.forEach((l, k) => {
  // kousek ticha na obou koncích, aby se neuřízl nádech ani doznění
  // (u krátké pauzy nesmí okraj sáhnout do sousední věty)
  const from = k === 0 ? Math.max(0, head - 0.05) : Math.max(gaps[k - 1][0], gaps[k - 1][1] - 0.05);
  const to = k === lines.length - 1 ? Math.min(total, tail + 0.08) : Math.min(gaps[k][1], gaps[k][0] + 0.08);
  const d = +(to - from).toFixed(3);
  if (d < 0.3) throw new Error(`Věta ${k + 1} („${l.t.slice(0, 40)}…“) vyšla jen ${d} s – začátky vět nesedí.`);
  ff(['-ss', from.toFixed(3), '-t', d.toFixed(3), '-i', wav, '-af', `afade=t=in:d=0.02,afade=t=out:st=${(d - 0.06).toFixed(3)}:d=0.06`, '-c:a', 'libmp3lame', '-b:a', '96k', path.join(CLIPS, l.key + '.mp3')]);
  m.clips[l.key] = { d };
  rates.push(l.t.replace(/[^\p{L}\p{N}]/gu, '').length / Math.max(0.3, to - from - 0.13));
  console.log(`${String(k + 1).padStart(2)} ${from.toFixed(2)}–${to.toFixed(2)}  ${l.t.slice(0, 70)}`);
});
// kontrola: věta mluvená výrazně rychleji/pomaleji než ostatní = nejspíš špatně umístěný střih
const med = [...rates].sort((a, b) => a - b)[rates.length >> 1];
const odd = rates.map((r, k) => [k, r / med]).filter(([k, x]) => (lines[k].t.length > 20 && (x < 0.5 || x > 1.8)) || x < 0.3 || x > 2.5);
if (odd.length) {
  console.error('Podezřelé střihy (tempo věty mimo normál) – nic se neuložilo do index.json:');
  odd.forEach(([k, x]) => console.error(`  ${k + 1}: ${x.toFixed(2)}× – ${lines[k].t.slice(0, 60)}`));
  process.exit(2);
}
writeManifest(m);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`Hotovo: ${lines.length} vět → ${path.relative(ROOT, CLIPS)}`);
