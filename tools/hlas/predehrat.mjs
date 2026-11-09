// Předem namluví věty pro častá jména přes tts-worker, aby je první rodina s tím jménem dostala hned
// a nikdo za ně neplatil. Worker je uloží do společné mezipaměti (R2); věta, která už tam je, nic nestojí.
//   node tools/hlas/plan.mjs jmena               (vytvoří dávky tools/hlas/davky/*-jmeno-*.json)
//   node tools/hlas/predehrat.mjs <adresa Workeru> [jméno …]
// Bez jmen projde všechny dávky jmen. Worker přijímá jen povolené weby, proto se skript hlásí
// jako http://localhost:5174 (musí být v ALLOWED_ORIGINS).
import fs from 'fs';
import path from 'path';
import { ROOT } from './lib.mjs';

const [url, ...only] = process.argv.slice(2);
if (!url) { console.log('Použití: node tools/hlas/predehrat.mjs <adresa Workeru> [jméno …]'); process.exit(1); }
const dir = path.join(ROOT, 'tools/hlas/davky');
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
const files = fs.readdirSync(dir).filter((f) => /-jmeno-.+\.json$/.test(f) && (!only.length || only.some((n) => f.endsWith(`-jmeno-${slug(n)}.json`))));
const jobs = files.flatMap((f) => { const b = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); return b.lines.map((l) => ({ text: l.t, mood: b.mood })); });
if (!jobs.length) { console.log('Žádné dávky jmen – spusť nejdřív node tools/hlas/plan.mjs jmena'); process.exit(1); }

const count = { edge: 0, r2: 0, miss: 0, chyba: 0 };
let chars = 0, i = 0;
async function worker() {
  while (i < jobs.length) {
    const j = jobs[i++];
    const r = await fetch(url.replace(/\/$/, '') + '/tts', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5174' }, body: JSON.stringify({ text: j.text, voice: 'jana', mood: j.mood }) }).catch(() => null);
    if (!r || !r.ok) { count.chyba++; console.error('Chyba:', r ? r.status : 'spojení', j.text.slice(0, 50)); continue; }
    await r.arrayBuffer();
    const c = r.headers.get('X-Ospalek-Cache') || 'miss';
    count[c] = (count[c] || 0) + 1;
    if (c === 'miss') chars += j.text.length;
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);
console.log(`${jobs.length} vět: nově namluveno ${count.miss} (${chars} znaků), už uloženo ${count.edge + count.r2}, chyby ${count.chyba}`);
