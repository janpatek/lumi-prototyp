// Poslechová kontrola: složí pohádku pro rodinu do jednoho MP3 se stejnými mezerami jako přehrávač
// (jen hlas – hudba a efekty hrají v aplikaci ze svých stop).
//   node tools/hlas/slozit.mjs <rodina.json> <id pohádky> [výstup.mp3]   (jinak do tools/hlas/ukazky/)
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { loadApp, readManifest, CLIPS, ROOT } from './lib.mjs';

const FF = process.env.FFMPEG || 'ffmpeg';
const [file, id, outArg] = process.argv.slice(2);
const app = loadApp();
const fam = JSON.parse(fs.readFileSync(file, 'utf8'));
const family = { ...fam, children: fam.children.map((k) => app.person(k.name, k.gender, k)), parents: fam.parents.map((p) => ({ ...p, forms: app.person(p.name || '', p.role === 'mama' || p.role === 'babi' ? 'f' : 'm').forms })) };
const st = app.stories.find((s) => s.id === id);
const plan = app.render(st, family, fam.heroes || [0]);
const have = readManifest().clips;
const missing = plan.flatMap((p) => p.lines).filter((l) => !have[l.key]);
if (missing.length) { console.error('Chybí nahrávky vět:\n' + missing.map((l) => '  ' + l.t).join('\n')); process.exit(1); }

// stejné mezery jako app/voice-player.js (GAP) a app.js (pauza mezi odstavci)
const GAP = 0.3, PARA = 0.65;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slozit-'));
// ticho ve stejném formátu jako nahrávky vět (concat neumí míchat formáty)
const sil = (d) => { const f = path.join(tmp, `ticho-${d}.mp3`); if (!fs.existsSync(f)) execFileSync(FF, ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', String(d), '-c:a', 'libmp3lame', '-b:a', '96k', f]); return f; };
const list = [];
plan.forEach((p, i) => {
  p.lines.forEach((l, k) => { list.push(path.join(CLIPS, l.key + '.mp3')); if (k < p.lines.length - 1) list.push(sil(GAP)); });
  if (i < plan.length - 1) list.push(sil(PARA));
});
const listFile = path.join(tmp, 'seznam.txt');
fs.writeFileSync(listFile, list.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
const out = outArg || path.join(ROOT, 'tools/hlas/ukazky', `${id}-${path.basename(file, '.json')}.mp3`);
execFileSync(FF, ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-ar', '44100', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '128k', out]);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${out}: ${plan.flatMap((p) => p.lines).length} vět`);
