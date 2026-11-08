// Plán nahrávání: které věty chybí a v jakých dávkách je namluvit.
//   node tools/hlas/plan.mjs spolecne            všechny věty bez osobních údajů (všechny tvary rodu a čísla)
//   node tools/hlas/plan.mjs rodina <soubor.json> věty jedné rodiny, které ještě nejsou nahrané
// Vypíše do tools/hlas/davky/ jednu dávku na pohádku: <id>-<název>.json (věty) a .txt (text pro TTS).
import fs from 'fs';
import path from 'path';
import { loadApp, readManifest, MOOD_TAG, ROOT } from './lib.mjs';

const [mode, file] = process.argv.slice(2);
const app = loadApp();
const have = readManifest().clips;
const OUT = path.join(ROOT, 'tools/hlas/davky');
fs.mkdirSync(OUT, { recursive: true });

// Značky místo osobních údajů: věta, ve které se objeví, je osobní.
const MARK = /⟦/;
const mk = (n) => `⟦${n}⟧`;
function variants() {
  const out = [];
  const kid = (n, g) => app.person(mk(n), g, { food: mk('jídlo' + n), animal: mk('zvíře' + n) });
  const par = (role, named) => ({ role, name: named ? mk('rodič') : '', forms: app.person(named ? mk('rodič') : '', role === 'mama' || role === 'babi' ? 'f' : 'm').forms });
  for (const heroes of [['m'], ['f'], ['m', 'f'], ['f', 'f']])
    for (const sib of [null, 'm', 'f'])
      for (const p1 of ['mama', 'tata', 'babi', 'deda'])
        for (const named of [false, true])
          for (const p2 of [null, 'mama', 'tata'])
            for (const home of [false, true]) {
              const children = heroes.map((g, i) => kid('dítě' + i, g));
              if (sib) children.push(kid('sourozenec', sib));
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
function batch(story, name, lines) {
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
  console.log(`${story.id}-${name}: ${todo.length} vět, ${text.length} znaků`);
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
} else {
  console.log('Použití: node tools/hlas/plan.mjs spolecne | rodina tools/hlas/rodiny/<rodina>.json');
  process.exit(1);
}
console.log(`Celkem ${total} znaků k namluvení.`);
