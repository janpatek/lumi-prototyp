// Kontrola konceptů pohádek: node tools/pohadky/over.mjs [soubory…]
// Bez argumentů vezme koncepty/pohadky/*.js. Každou pohádku vyrenderuje pro několik
// testovacích rodin (kluk, holka, dvě děti, rodina bez okolí a bez druhého rodiče)
// a vypíše chyby, délku v minutách (stejný vzorec jako app.js) a podíl osobních vět.
// --text <id> vypíše celý text pohádky pro všechny rodiny.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const textId = args.includes('--text') ? args[args.indexOf('--text') + 1] : null;
let files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--text');
if (!files.length) files = fs.readdirSync(path.join(root, 'koncepty/pohadky')).filter((f) => f.endsWith('.js')).sort().map((f) => path.join(root, 'koncepty/pohadky', f));

const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'app/stories.cs.js'), 'utf8'), sandbox, { filename: 'stories.cs.js' });
vm.runInContext(fs.readFileSync(path.join(root, 'app/voice-lines.js'), 'utf8'), sandbox, { filename: 'voice-lines.js' });
for (const f of files) vm.runInContext(fs.readFileSync(f, 'utf8'), sandbox, { filename: f });
const W = sandbox.window;
const split = (W.VOICE_LINES || sandbox.VOICE_LINES || {}).splitLines || ((t) => t.split(/(?<=[.!?…])\s+/));
const listCz = (a) => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' a ' + a[a.length - 1]);

const kid = (nom, gen, dat, acc, voc, ins, gender, food, animal) => ({ forms: { nom, gen, dat, acc, voc, ins }, gender, food, animal });
const K = {
  tonik: kid('Toník', 'Toníka', 'Toníkovi', 'Toníka', 'Toníku', 'Toníkem', 'm', 'palačinky', 'liška'),
  matej: kid('Matěj', 'Matěje', 'Matějovi', 'Matěje', 'Matěji', 'Matějem', 'm', 'špagety', 'tygr'),
  eliska: kid('Eliška', 'Elišky', 'Elišce', 'Elišku', 'Eliško', 'Eliškou', 'f', 'jahody', 'koník'),
  anicka: kid('Anička', 'Aničky', 'Aničce', 'Aničku', 'Aničko', 'Aničkou', 'f', 'knedlíky', 'kočička'),
};
const parent = (role, name) => {
  const R = { mama: ['f', { nom: 'maminka', gen: 'maminky', dat: 'mamince', acc: 'maminku', voc: 'maminko', ins: 'maminkou' }], tata: ['m', { nom: 'tatínek', gen: 'tatínka', dat: 'tatínkovi', acc: 'tatínka', voc: 'tatínku', ins: 'tatínkem' }] }[role];
  return { ...R[1], full: R[1].nom + (name ? ' ' + name : ''), name: name ? { nom: name } : null, g: (m, f) => (R[0] === 'f' ? f : m) };
};
function ctx(heroes, sib, ps, home) {
  const one = heroes.length === 1;
  const allF = heroes.every((k) => k.gender === 'f');
  const h = {};
  ['nom', 'gen', 'dat', 'acc', 'voc', 'ins'].forEach((k) => { h[k] = listCz(heroes.map((x) => x.forms[k])); });
  return {
    H: h.nom, h,
    g: (m, f, mpl = m, fpl) => (one ? (allF ? f : m) : allF ? fpl ?? mpl.replace(/li\b/g, 'ly') : mpl),
    n: (sg, pl) => (one ? sg : pl),
    sib: sib ? sib.forms : null,
    sg: (m, f) => (sib && sib.gender === 'f' ? f : m),
    p1: ps[0], p2: ps[1] || null,
    town: home.town, inTown: home.inTown, near: home.near, attr: home.attr,
    food: listCz([...new Set(heroes.map((k) => k.food))]),
    animal: listCz([...new Set(heroes.map((k) => k.animal))]),
  };
}
const HOME_A = { town: 'Benešov', inTown: 'v Benešově', near: ['Týnec nad Sázavou', 'Vlašim', 'Bystřice'], attr: ['hrad Konopiště'] };
const HOME_B = { town: 'Ponětovice', inTown: 'v Ponětovicích', near: ['Šlapanice', 'Sokolnice', 'Telnice', 'Jiříkovice'], attr: ['rozhledna Akátová věž', 'zámek Slavkov'] };
const HOME_0 = { town: 'Lhota', inTown: 've Lhotě', near: [], attr: [] };
const FAM = {
  'kluk': ctx([K.tonik], K.eliska, [parent('mama', 'Petra'), parent('tata', 'Honza')], HOME_A),
  'kluk B': ctx([K.matej], null, [parent('tata'), parent('mama', 'Jana')], HOME_B),
  'holka': ctx([K.eliska], K.tonik, [parent('tata', 'Honza'), parent('mama')], HOME_A),
  'holka B': ctx([K.anicka], null, [parent('mama', 'Lucie')], HOME_B),
  'dvě děti': ctx([K.tonik, K.eliska], null, [parent('mama', 'Petra'), parent('tata', 'Honza')], HOME_A),
  'dvě holky': ctx([K.eliska, K.anicka], K.matej, [parent('mama')], HOME_B),
  'bez okolí': ctx([K.matej], null, [parent('mama')], HOME_0),
};
const minutes = (segs) => Math.max(1, Math.round(segs.reduce((a, s) => a + s.t.split(/\s+/).length / 2 + (s.pause || 0) + 1, 0) / 60));
const SFX = ['sparkle', 'magic', 'car', 'horn', 'birds', 'owl', 'paper', 'wind', 'ding'];
const MOODS = ['lullaby', 'adventure', 'road'];
const CATS = new Set((W.CATEGORIES || []).map((k) => k.id).concat(['sranda', 'lidove', 'hrdinove', 'zvirata', 'svatky', 'zvidave']));
const BAD = /undefined|null|NaN|\[object|\$\{|\s[,.]|\s{2,}|„\s|\s“|,,|\.\.(?!\.)/;

const stories = W.STORIES_DRAFT || [];
const ids = new Set();
let problems = 0;
const rows = [];
for (const st of stories) {
  const err = [];
  if (ids.has(st.id)) err.push('duplicitní id'); ids.add(st.id);
  if ((W.STORIES || []).some((s) => s.id === st.id)) err.push('id už v aplikaci existuje');
  if (!MOODS.includes(st.mood)) err.push('mood ' + st.mood);
  (st.cats || []).forEach((c) => { if (!CATS.has(c)) err.push('kategorie ' + c); });
  if (!Array.isArray(st.ages) || st.ages.length !== 2) err.push('ages');
  if (st.free !== false) err.push('free má být false');
  if (![5, 10, 15].includes(st.delka)) err.push('delka');
  const out = {};
  for (const [k, c] of Object.entries(FAM)) {
    try {
      const title = st.title(c);
      const segs = st.text(c);
      if (!Array.isArray(segs) || !segs.length) throw new Error('text není pole');
      segs.forEach((s, i) => {
        if (typeof s.t !== 'string' || !s.t.trim()) err.push(`${k}: prázdný odstavec ${i + 1}`);
        if (s.sfx && !SFX.includes(s.sfx)) err.push(`${k}: sfx ${s.sfx}`);
        const m = (s.t || '').match(BAD); if (m) err.push(`${k}: odst. ${i + 1} podezřelé „${m[0]}“: …${s.t.slice(Math.max(0, m.index - 30), m.index + 30)}…`);
        if (((s.t || '').match(/„/g) || []).length !== ((s.t || '').match(/“/g) || []).length) err.push(`${k}: odst. ${i + 1} nepárové uvozovky`);
      });
      if (BAD.test(title)) err.push(`${k}: název „${title}“`);
      out[k] = { title, segs, lines: segs.flatMap((s) => split(s.t)) };
    } catch (e) { err.push(`${k}: ${e.message}`); }
  }
  let info = '';
  if (out['kluk'] && out['kluk B']) {
    const b = new Set(out['kluk B'].lines);
    const pers = out['kluk'].lines.filter((l) => !b.has(l));
    const persChars = pers.reduce((a, l) => a + l.length, 0);
    const all = out['kluk'].lines.reduce((a, l) => a + l.length, 0);
    const words = out['kluk'].segs.reduce((a, s) => a + s.t.split(/\s+/).length, 0);
    const min = minutes(out['kluk'].segs);
    if (st.delka && Math.abs(min - st.delka) > (st.delka >= 10 ? 1 : 0)) err.push(`délka ${min} min místo ${st.delka}`);
    info = `${min} min, ${words} slov, ${out['kluk'].lines.length} vět, osobních ${pers.length} (${Math.round((100 * persChars) / all)} % znaků)`;
  }
  problems += err.length;
  rows.push({ id: st.id, title: out['kluk']?.title, info, err });
  if (textId === st.id) for (const [k, o] of Object.entries(out)) console.log(`\n===== ${k}: ${o.title}\n` + o.segs.map((s) => s.t).join('\n\n'));
}
if (!textId) for (const r of rows) console.log(`${r.err.length ? '✗' : '✓'} ${r.id} – ${r.title} | ${r.info}` + r.err.map((e) => '\n    ' + e).join(''));
console.log(`\n${stories.length} pohádek, ${problems} problémů`);
process.exit(problems ? 1 : 0);
