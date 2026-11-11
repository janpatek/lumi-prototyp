// Plán nahrávání: které věty chybí a v jakých dávkách je namluvit.
//   node tools/hlas/plan.mjs spolecne            všechny věty bez osobních údajů (všechny tvary rodu a čísla)
//   node tools/hlas/plan.mjs rodina <soubor.json> věty jedné rodiny, které ještě nejsou nahrané
//   ZNOVU=1 node tools/hlas/plan.mjs …           totéž včetně už nahraných vět (pro namluvit.mjs)
//   node tools/hlas/plan.mjs jmena [soubor.json]  věty, ve kterých je jen jméno dítěte (bez místa, jídla, jména
//                                                 rodiče) – pro častá jména předem; výchozí tools/hlas/jmena.json
// Vypíše do tools/hlas/davky/ jednu dávku na pohádku: <id>-<název>.json (věty) a .txt (text pro TTS).
import fs from 'fs';
import path from 'path';
import { loadApp, readManifest, MOOD_TAG, ROOT } from './lib.mjs';

const [mode, file] = process.argv.slice(2);
const app = loadApp();
// ZNOVU=1: naplánovat i věty, které už nahrané jsou (nové namluvení všeho, viz namluvit.mjs)
const have = process.env.ZNOVU ? {} : readManifest().clips;
const OUT = path.join(ROOT, 'tools/hlas/davky');
fs.mkdirSync(OUT, { recursive: true });

// Značky místo osobních údajů: věta, ve které se objeví, je osobní.
const MARK = /⟦/;
const mk = (n) => `⟦${n}⟧`;
// one = { name, gender, as: 'hero' | 'sib' }: jedno dítě se skutečným jménem, vše ostatní značky
function variants(one) {
  const out = [];
  const kid = (n, g) => app.person(mk(n), g, { food: mk('jídlo' + n), animal: mk('zvíře' + n) });
  const real = (g) => app.person(one.name, g, { food: mk('jídlo'), animal: mk('zvíře') });
  const par = (role, named) => ({ role, name: named ? mk('rodič') : '', forms: app.person(named ? mk('rodič') : '', role === 'mama' || role === 'babi' ? 'f' : 'm').forms });
  const heroSets = one ? (one.as === 'hero' ? [[one.gender]] : [['m'], ['f']]) : [['m'], ['f'], ['m', 'f'], ['f', 'f']];
  const sibSets = one ? (one.as === 'sib' ? [one.gender] : [null, 'm', 'f']) : [null, 'm', 'f'];
  for (const heroes of heroSets)
    for (const sib of sibSets)
      for (const p1 of ['mama', 'tata', 'babi', 'deda'])
        for (const named of [false, true])
          for (const p2 of [null, 'mama', 'tata'])
            for (const home of [false, true]) {
              const children = heroes.map((g, i) => (one && one.as === 'hero' ? real(g) : kid('dítě' + i, g)));
              if (sib) children.push(one && one.as === 'sib' ? real(sib) : kid('sourozenec', sib));
              out.push({
                family: {
                  children,
                  parents: [par(p1, named), ...(p2 ? [par(p2, false)] : [])],
                  home: home ? { town: mk('obec'), inTown: mk('vObci'), near: [mk('o1'), mk('o2'), mk('o3')], attr: [mk('výlet')] } : { town: '', inTown: '', near: [], attr: [] },
                },
                heroes: heroes.map((_, i) => i),
              });
            }
  return out;
}

// věta, která už je v jiné dávce tohoto běhu (např. „Dobrou noc, Aničko.“), se nenamlouvá dvakrát
const planned = new Set();
const slug = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
function batch(story, name, lines, quiet) {
  const todo = lines.filter((l) => !have[l.key] && !planned.has(l.key));
  todo.forEach((l) => planned.add(l.key));
  if (!todo.length) return 0;
  // Odstavec = prázdný řádek, věty v odstavci jdou za sebou, aby se četly jako souvislý text.
  // ([pause 1s] mezi větami eleven_v4 skoro ignoruje, cut.mjs proto hranice dohledá podle délky textu.)
  let text = MOOD_TAG[story.mood] || MOOD_TAG.lullaby;
  let prev = null;
  todo.forEach((l) => { const at = `${l.pass || 0}:${l.para}`; text += (prev === null ? '\n' : prev === at ? ' ' : '\n\n') + l.t; prev = at; });
  const base = path.join(OUT, `${story.id}-${name}`);
  fs.writeFileSync(base + '.json', JSON.stringify({ story: story.id, mood: story.mood, lines: todo }, null, 1));
  fs.writeFileSync(base + '.txt', text + '\n');
  if (!quiet) console.log(`${story.id}-${name}: ${todo.length} vět, ${text.length} znaků`);
  return text.length;
}

let total = 0;
if (mode === 'spolecne') {
  const vs = variants();
  for (const st of app.stories) {
    // Varianty téže věty (vzal / vzala / vzali) nesmí stát vedle sebe – vypravěčka by zdůraznila koncovku.
    // Každá věta dostane průchod: 1. průchod čte pohádku v jednom tvaru, další průchody ostatní tvary.
    const seen = new Map();
    const slots = new Map();
    for (const v of vs) app.render(st, v.family, v.heroes).forEach((p) => p.lines.forEach((l, j) => {
      if (MARK.test(l.t) || seen.has(l.key)) return;
      const slot = p.i + ':' + j;
      const pass = slots.get(slot) || 0;
      slots.set(slot, pass + 1);
      seen.set(l.key, { ...l, para: p.i, pass });
    }));
    total += batch(st, 'spolecne', [...seen.values()].sort((a, b) => a.pass - b.pass || a.para - b.para));
  }
} else if (mode === 'rodina' && file) {
  const fam = JSON.parse(fs.readFileSync(file, 'utf8'));
  const family = { ...fam, children: fam.children.map((k) => app.person(k.name, k.gender, k)), parents: fam.parents.map((p) => ({ ...p, forms: app.person(p.name || '', p.role === 'mama' || p.role === 'babi' ? 'f' : 'm').forms })) };
  const name = path.basename(file, '.json');
  for (const st of app.stories) {
    const seen = new Map();
    app.render(st, family, fam.heroes || [0]).forEach((p) => p.lines.forEach((l) => seen.has(l.key) || seen.set(l.key, { ...l, para: p.i })));
    total += batch(st, name, [...seen.values()]);
  }
} else if (mode === 'jmena') {
  const names = JSON.parse(fs.readFileSync(file || path.join(ROOT, 'tools/hlas/jmena.json'), 'utf8')).jmena;
  const per = [];
  for (const n of names) {
    const before = total;
    for (const st of app.stories) {
      const seen = new Map();
      const slots = new Map();
      for (const as of ['hero', 'sib'])
        for (const v of variants({ ...n, as })) app.render(st, v.family, v.heroes).forEach((p) => p.lines.forEach((l, j) => {
          if (MARK.test(l.t) || seen.has(l.key)) return;
          const slot = p.i + ':' + j;
          const pass = slots.get(slot) || 0;
          slots.set(slot, pass + 1);
          seen.set(l.key, { ...l, para: p.i, pass });
        }));
      total += batch(st, 'jmeno-' + slug(n.name), [...seen.values()].sort((a, b) => a.pass - b.pass || a.para - b.para), true);
    }
    per.push(`${n.name}: ${total - before} znaků`);
  }
  console.log(per.join(', '));
  // ElevenLabs účtuje znaky (1 znak ≈ 1 kredit); cena podle business plánu 0,08 $ / 1000 znaků, 23 Kč/$
  console.log(`Odhad: asi ${total} kreditů ElevenLabs, tj. asi ${Math.round(total / 1000 * 0.08 * 23)} Kč.`);
} else if (mode === 'klice') {
  // klíče všech nahraných vět pohádek zdarma (společné i se jmény z jmena.json) – mobilní aplikace
  // přibalí jen tyhle, ostatní stahuje z webu (mobile/scripts/copy-web.mjs, app/remote.js)
  const names = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/hlas/jmena.json'), 'utf8')).jmena;
  const keys = new Set();
  const sets = [variants(null), ...names.flatMap((n) => ['hero', 'sib'].map((as) => variants({ ...n, as })))];
  for (const st of app.stories.filter((s) => s.free)) {
    for (const vs of sets) for (const v of vs) app.render(st, v.family, v.heroes).forEach((p) => p.lines.forEach((l) => { if (have[l.key]) keys.add(l.key); }));
  }
  process.stdout.write(JSON.stringify([...keys]));
  process.exit(0);
} else {
  console.log('Použití: node tools/hlas/plan.mjs spolecne | rodina tools/hlas/rodiny/<rodina>.json | jmena [seznam.json] | klice');
  process.exit(1);
}
console.log(`Celkem ${total} znaků k namluvení.`);
