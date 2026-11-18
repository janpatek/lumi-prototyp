// Zvuky pohádek: hudební styl, kulisa a efekty podle děje.
//
//   node tools/pozadi/zvuky.mjs check <plán.json …>   kontrola rozmístění (úryvky, id efektů)
//   node tools/pozadi/zvuky.mjs build                  sestaví audio/pozadi/index.json
//
// index.json (čte app/audio.js; v mobilní aplikaci se doplňuje z ospalek.cz, takže plán zvuků
// nové pohádky dorazí i bez nové verze aplikace):
//   clips    staré smyčky po pohádkách (verze aplikace do 1.20), nechávají se beze změny
//   kulisy   { id: { file, body } }                  smyčky prostředí v audio/pozadi/
//   hudba    { styl: { číslo: [délky částí] } }       části skladeb audio/hudba/<styl>-<číslo>-<část>.mp3
//   fx       { id: { varianta: délka } }              audio/efekty/<id>-<varianta>.mp3
//   pohadky  plán z tools/pozadi/pohadky.json
//
// Plán pohádek je v tools/pozadi/pohadky.json:
//   { "<id pohádky>": { "styl": "<id stylu>", "kulisa": "<id kulisy>" | null,
//                      "fx": [ { "p": <číslo odstavce>, "at": "<úryvek textu>", "fx": "<id efektu>", "kdy": "pred" | "po" | "spolu" } ] } }
// Úryvek musí být v odstavci p ve všech verzích textu (nesmí obsahovat jméno ani tvar podle rodu).
// kdy: pred = efekt, pak věta s úryvkem; po = po větě; spolu = efekt zazní tiše pod začátkem věty.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStories, render } from './texty.mjs';
import FX from './efekty-katalog.mjs';
import KULISY from './kulisy.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const STYLY = JSON.parse(readFileSync(join(here, 'styly.json'), 'utf8')).styly;
const KDY = ['pred', 'po', 'spolu'];
const VL = createRequire(import.meta.url)('../../app/voice-lines.js');
// věta odstavce, ke které efekt patří (stejně jako app/audio.js storyFx)
const lineOf = (text, at, kdy) => {
  const lines = VL.splitLines(text);
  let k = lines.findIndex((l) => l.includes(at));
  if (k < 0) {
    const parts = at.split(/(?<=[.!?…“])\s+/);
    const part = kdy === 'po' ? parts[parts.length - 1] : parts[0];
    k = kdy === 'po' ? lines.map((l) => l.includes(part)).lastIndexOf(true) : lines.findIndex((l) => l.includes(part));
  }
  return k;
};

// kulisa: null | "id" | [{ od, id }] → vždy seznam změn
export const kulisy = (k) => (!k ? [] : typeof k === 'string' ? [{ od: 0, id: k }] : k);

export function check(plan, extraFx = {}) {
  const S = Object.fromEntries(loadStories().map((s) => [s.id, s]));
  const errs = [];
  const fxOk = (id) => id in FX || id in extraFx;
  for (const [id, p] of Object.entries(plan)) {
    if (id.startsWith('_')) continue;
    const st = S[id];
    if (!st) { errs.push(`${id}: taková pohádka není`); continue; }
    if (!STYLY[p.styl]) errs.push(`${id}: neznámý styl ${p.styl}`);
    for (const k of kulisy(p.kulisa)) {
      if (k.id && !KULISY[k.id]) errs.push(`${id}: neznámá kulisa ${k.id}`);
      if (!Number.isInteger(k.od) || k.od < 0) errs.push(`${id}: kulisa od ${k.od}`);
    }
    const r = render(st);
    for (const f of p.fx || []) {
      const w = `${id} [${f.p}] „${f.at}“`;
      if (!fxOk(f.fx)) errs.push(`${w}: neznámý efekt ${f.fx}`);
      if (!KDY.includes(f.kdy)) errs.push(`${w}: kdy musí být pred/po/spolu`);
      for (const v of ['A', 'B', 'C']) if (!(r[v][f.p] || '').includes(f.at)) errs.push(`${w}: úryvek není v odstavci (verze ${v})`);
      if ((r.A[f.p] || '').includes(f.at) && lineOf(r.A[f.p], f.at, f.kdy) < 0) errs.push(`${w}: úryvek nejde přiřadit k větě`);
    }
  }
  return errs;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...files] = process.argv.slice(2);
  if (cmd === 'check') {
    let n = 0, bad = 0;
    for (const f of files) {
      const plan = JSON.parse(readFileSync(f, 'utf8'));
      const errs = check(plan, plan._nove || {});
      n += Object.keys(plan).filter((k) => !k.startsWith('_')).length;
      bad += errs.length;
      errs.forEach((e) => console.log(e));
    }
    console.log(bad ? `${bad} chyb` : `v pořádku (${n} pohádek)`);
    process.exit(bad ? 1 : 0);
  }
  if (cmd === 'build') {
    const plan = JSON.parse(readFileSync(join(here, 'pohadky.json'), 'utf8'));
    const errs = check(plan);
    if (errs.length) { errs.forEach((e) => console.log(e)); process.exit(1); }
    const INDEX = join(root, 'audio/pozadi/index.json');
    const old = JSON.parse(readFileSync(INDEX, 'utf8'));
    const nove = JSON.parse(readFileSync(join(here, 'kulisy.json'), 'utf8'));
    const kul = {};
    for (const [id, [, src]] of Object.entries(KULISY)) {
      if (nove[id]) { kul[id] = nove[id]; continue; }
      if (!src.endsWith('.mp3')) continue; // nevygenerovaná
      const clip = Object.values(old.clips).flatMap((c) => Object.values(c)).find((c) => c.file === src);
      if (clip) kul[id] = clip;
    }
    const hudba = JSON.parse(readFileSync(join(here, 'hudba.json'), 'utf8'));
    const fx = JSON.parse(readFileSync(join(here, 'efekty.json'), 'utf8'));
    // kontrola, že plán odkazuje jen na existující zvuky
    const miss = [];
    for (const [id, p] of Object.entries(plan)) {
      if (!hudba[p.styl]) miss.push(`${id}: styl ${p.styl} nemá hudbu`);
      for (const k of kulisy(p.kulisa)) if (k.id && !kul[k.id]) miss.push(`${id}: kulisa ${k.id} nemá soubor`);
      for (const f of p.fx) if (!fx[f.fx] || !Object.keys(fx[f.fx]).length) miss.push(`${id}: efekt ${f.fx} nemá soubor`);
    }
    for (const [s, tracks] of Object.entries(hudba)) for (const [n, parts] of Object.entries(tracks)) parts.forEach((_, k) => { if (!existsSync(join(root, `audio/hudba/${s}-${n}-${k + 1}.mp3`))) miss.push(`chybí audio/hudba/${s}-${n}-${k + 1}.mp3`); });
    for (const [f, vs] of Object.entries(fx)) for (const v of Object.keys(vs)) if (!existsSync(join(root, `audio/efekty/${f}-${v}.mp3`))) miss.push(`chybí audio/efekty/${f}-${v}.mp3`);
    if (miss.length) { miss.forEach((e) => console.log(e)); process.exit(1); }
    const index = { pad: old.pad, clips: old.clips, kulisy: kul, hudba, fx, pohadky: plan };
    writeFileSync(INDEX, JSON.stringify(index));
    const nfx = Object.values(plan).reduce((a, p) => a + p.fx.length, 0);
    console.log(`index.json: ${Object.keys(plan).length} pohádek, ${nfx} efektů v textu, ${Object.keys(hudba).length} stylů hudby, ${Object.keys(kul).length} kulis, ${Object.keys(fx).length} druhů efektů`);
  }
}
