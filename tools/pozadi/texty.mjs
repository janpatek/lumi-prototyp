// Vypíše texty pohádek s čísly odstavců pro rozmísťování efektů (tools/pozadi/pohadky.json).
// Každá pohádka se vykreslí pro tři různé rodiny (kluk / dvě holky / holka), aby bylo vidět,
// co se v textu mění. Úryvek efektu (at) musí být ve všech verzích.
//
//   node tools/pozadi/texty.mjs [id ...]        výpis
//   node tools/pozadi/texty.mjs --json          { id: { mood, cats, A: [texty], B: [texty] } }
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export function loadStories() {
  const win = {};
  vm.runInNewContext(readFileSync(join(root, 'app/stories.cs.js'), 'utf8'), { window: win, console });
  return win.STORIES;
}
const person = (forms, g) => ({ ...forms, full: forms.full, g: (m, f) => (g === 'f' ? f : m) });
const nameForms = (n) => ({ nom: n[0], gen: n[1], dat: n[2], acc: n[3], voc: n[4], ins: n[5], loc: n[2] });
function ctx(kind) {
  const A = kind === 'A', C = kind === 'C';
  const h = A ? nameForms(['Toník', 'Toníka', 'Toníkovi', 'Toníka', 'Toníku', 'Toníkem'])
    : C ? nameForms(['Bára', 'Báry', 'Báře', 'Báru', 'Báro', 'Bárou'])
    : nameForms(['Anička a Eliška', 'Aničky a Elišky', 'Aničce a Elišce', 'Aničku a Elišku', 'Aničko a Eliško', 'Aničkou a Eliškou']);
  const g = (m, f, mpl, fpl) => (A ? m : C ? f : fpl !== undefined ? fpl : (mpl || m).replace(/li\b/g, 'ly'));
  const p1 = A ? person({ ...nameForms(['maminka', 'maminky', 'mamince', 'maminku', 'maminko', 'maminkou']), full: 'maminka Petra' }, 'f')
    : person({ ...nameForms(['tatínek', 'tatínka', 'tatínkovi', 'tatínka', 'tatínku', 'tatínkem']), full: 'tatínek Martin' }, 'm');
  const p2 = A ? person({ ...nameForms(['tatínek', 'tatínka', 'tatínkovi', 'tatínka', 'tatínku', 'tatínkem']), full: 'tatínek Martin' }, 'm')
    : person({ ...nameForms(['babička', 'babičky', 'babičce', 'babičku', 'babičko', 'babičkou']), full: 'babička Jana' }, 'f');
  const sib = A ? null : null;
  const c = {
    H: h.nom, h, g, n: (one, more) => (A || C ? one : more), sib, sg: (m, f) => (A ? m : f),
    p1, p2, inTown: A ? 'v Benešově' : 'v Kroměříži', town: A ? 'Benešov' : 'Kroměříž',
    near: A ? ['Vlašim', 'Votice', 'Týnec'] : [], attr: A ? ['hrad Konopiště'] : [],
    food: A ? 'palačinky' : 'špagety', animal: A ? 'pejsek' : 'koťátko', kids: A ? 1 : 2, age: A ? 5 : 4,
  };
  return new Proxy(c, { get: (o, k) => (k in o ? o[k] : typeof k === 'string' ? person({ ...nameForms(['x', 'x', 'x', 'x', 'x', 'x']), full: 'x' }, 'm') : undefined) });
}
export function render(st) {
  const out = {};
  for (const k of ['A', 'B', 'C']) {
    try { out[k] = st.text(ctx(k)).map((p) => p.t); } catch (e) { out[k] = null; out.err = e.message; }
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const want = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const S = loadStories().filter((s) => !want.length || want.includes(s.id));
  if (process.argv.includes('--json')) {
    const o = {};
    for (const s of S) { const r = render(s); o[s.id] = { mood: s.mood, cats: s.cats, ...r }; }
    console.log(JSON.stringify(o));
  } else {
    for (const s of S) {
      const r = render(s);
      console.log(`\n=== ${s.id} (mood ${s.mood}, ${s.cats.join(', ')})${r.err ? ' CHYBA ' + r.err : ''}`);
      r.A.forEach((t, i) => console.log(`[${i}] ${t}`));
      if (r.B && r.B.length !== r.A.length) console.log(`(verze B má ${r.B.length} odstavců)`);
    }
  }
}
