// Společné pro skripty hlasu: načte pohádky a výpočet kontextu přímo z aplikace (app/), aby věty
// a jejich klíče vyšly přesně stejně jako v přehrávači.
import fs from 'fs';
import vm from 'vm';
import path from 'path';
import { fileURLToPath } from 'url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const VOICE = 'jana';
export const CLIPS = path.join(ROOT, 'audio/hlas', VOICE);
export const MANIFEST = path.join(CLIPS, 'index.json');

// náladu vypravěče drží jedna značka na začátku každé nahrávky – stejná pro společné i osobní věty
export const MOOD_TAG = {
  lullaby: '[soft, calm, warm storyteller voice]',
  adventure: '[warm, lively storyteller voice]',
  road: '[cheerful, playful storyteller voice]',
};

export function loadApp() {
  const window = {};
  const c = vm.createContext({ window, S: null, console });
  const app = fs.readFileSync(path.join(ROOT, 'app/app.js'), 'utf8');
  const a = app.indexOf('// ---------- Skloňování'), b = app.indexOf('const heroes = () =>');
  if (a < 0 || b < 0) throw new Error('V app/app.js se nenašla část se skloňováním a kontextem.');
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'app/stories.cs.js'), 'utf8'), c);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'app/voice-lines.js'), 'utf8'), c);
  vm.runInContext(app.slice(a, b) + '\n;globalThis.__ctx = ctx; globalThis.__decline = decline;', c);
  return {
    stories: window.STORIES,
    lines: window.VOICE_LINES,
    // rodina ve stejném tvaru jako S.family v aplikaci; heroes = indexy dětí, které jsou hrdiny
    render(story, family, heroes = [0]) {
      c.S = { family };
      const hs = heroes.map((i) => family.children[i]);
      return window.VOICE_LINES.planStory(story.text(c.__ctx(hs)));
    },
    person: (name, gender, extra = {}) => ({ forms: c.__decline(name, gender), gender, ...extra }),
  };
}

export const readManifest = () => (fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : { voice: VOICE, model: 'eleven_v4', clips: {} });
export const writeManifest = (m) => {
  const sorted = Object.fromEntries(Object.entries(m.clips).sort(([x], [y]) => x.localeCompare(y)));
  fs.writeFileSync(MANIFEST, JSON.stringify({ ...m, clips: sorted }, null, 1) + '\n');
};
