// Namluví věty přes tts-worker (ElevenLabs) po jedné – úplně stejně, jak je aplikace dotahuje pro rodiny.
// Společné i osobní věty tak mají stejný hlas, model, stabilitu a značku nálady, a na spojích není znát střih.
//
//   ZNOVU=1 node tools/hlas/plan.mjs spolecne                 (a případně rodina tools/hlas/rodiny/<rodina>.json)
//   node tools/hlas/namluvit.mjs odhad tools/hlas/davky/*-spolecne.json …
//   node tools/hlas/namluvit.mjs nahrat tools/hlas/davky/*-spolecne.json …
//
// nahrat: surové MP3 z Workeru jdou do tools/hlas/nahravky/el/<klíč>.mp3 (při přerušení se pokračuje, nic se
// neplatí dvakrát – Worker má navíc vlastní mezipaměť), pak se ořízne ticho na krajích (0,05 / 0,08 s),
// srovná hlasitost na −19 LUFS a uloží do audio/hlas/jana/. index.json obsahuje jen věty z tohoto běhu,
// staré nahrávky, které v něm nejsou, se smažou.
// Worker: proměnná TTS_URL, výchozí ostrý ospalek-tts. Klíč ElevenLabs zůstává jen ve Workeru.
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { CLIPS, ROOT, MOOD_TAG, readManifest, writeManifest } from './lib.mjs';

const [mode, ...files] = process.argv.slice(2);
const TTS = process.env.TTS_URL || 'https://ospalek-tts.jan-patek.workers.dev';
const FF = process.env.FFMPEG || 'ffmpeg';
const RAW = path.join(ROOT, 'tools/hlas/nahravky/el');

const lines = new Map();
for (const f of files) {
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  d.lines.forEach((l) => lines.has(l.key) || lines.set(l.key, { t: l.t, key: l.key, mood: d.mood || 'lullaby' }));
}
const all = [...lines.values()];
const chars = all.reduce((a, l) => a + l.t.length + (MOOD_TAG[l.mood] || '').length + 1, 0);
console.log(`${all.length} vět, ${chars} znaků včetně značek nálady.`);
if (mode === 'odhad' || !all.length) process.exit(0);
if (mode !== 'nahrat') { console.log('Použití: node tools/hlas/namluvit.mjs odhad|nahrat <davky/*.json>'); process.exit(1); }

fs.mkdirSync(RAW, { recursive: true });
const stats = { edge: 0, r2: 0, miss: 0, local: 0 };
async function fetchOne(l) {
  const out = path.join(RAW, l.key + '.mp3');
  if (fs.existsSync(out)) { stats.local++; return; }
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(TTS + '/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5174' },
      body: JSON.stringify({ text: l.t, voice: 'jana', mood: l.mood }),
    });
    if (r.ok) {
      fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
      stats[r.headers.get('x-ospalek-cache') || 'miss']++;
      return;
    }
    const err = await r.text();
    if (attempt >= 3 || r.status === 403 || r.status === 413) throw new Error(`${r.status} ${err} – „${l.t}“`);
    await new Promise((res) => setTimeout(res, 2000 * attempt));
  }
}
const queue = [...all];
let done = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (queue.length) {
    await fetchOne(queue.shift());
    if (++done % 25 === 0) console.log(`  ${done}/${all.length}`);
  }
}));
console.log(`Staženo: nové ${stats.miss}, z mezipaměti ${stats.edge + stats.r2}, už lokálně ${stats.local}.`);

// okraje a hlasitost jako v cut.mjs: ticho na krajích max. 0,05 / 0,08 s, −19 LUFS (dvouprůchodově, lineárně)
const TRIM = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse';
// ffmpeg píše měření i chyby na stderr
function ff(args) {
  const r = spawnSync(FF, ['-hide_banner', '-nostats', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('ffmpeg: ' + (r.stderr || '').slice(-400));
  return r.stderr;
}
const m = readManifest();
const clips = {};
for (const l of all) {
  const src = path.join(RAW, l.key + '.mp3');
  const r = ff(['-i', src, '-af', `${TRIM},loudnorm=I=-19:TP=-2:LRA=9:print_format=json`, '-f', 'null', '-']);
  const j = JSON.parse(r.match(/\{[^{}]*"input_i"[^{}]*\}/)[0]);
  const ln = `loudnorm=I=-19:TP=-2:LRA=9:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`;
  const out = path.join(CLIPS, l.key + '.mp3');
  ff(['-y', '-i', src, '-af', `${TRIM},${ln}`, '-ar', '44100', '-ac', '1', '-b:a', '128k', out]);
  const probe = spawnSync(FF, ['-hide_banner', '-i', out, '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const t = [...probe.matchAll(/time=(\d+):(\d+):([\d.]+)/g)].pop();
  clips[l.key] = { d: t ? Math.round((+t[1] * 3600 + +t[2] * 60 + +t[3]) * 1000) / 1000 : 0 };
}
for (const f of fs.readdirSync(CLIPS)) if (f.endsWith('.mp3') && !clips[f.slice(0, -4)]) fs.unlinkSync(path.join(CLIPS, f));
writeManifest({ ...m, source: 'tts-worker (ElevenLabs API, po větách)', model: 'eleven_v4', clips });
console.log(`Hotovo: ${Object.keys(clips).length} vět v audio/hlas/jana/.`);

