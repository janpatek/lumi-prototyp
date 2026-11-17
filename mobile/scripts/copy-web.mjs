// Připraví mobile/www pro Capacitor: zkopíruje webovou aplikaci z ../app a sdílené soubory,
// které aplikace načítá přes ../ (config.js, brand, covers, audio). Cesty zůstávají stejné jako na webu,
// takže app/ se kvůli mobilu nemusí měnit. Úpravy jen pro nativní build:
//  - bez zámku gate.js (ten je pro web před spuštěním; v obchodě se aplikace distribuuje přes testovací stopy),
//  - odkazy na obchodní podmínky a zásady vedou na ospalek.cz (nejsou součástí balíčku),
//  - z hlasu (audio/hlas/jana) jen věty pohádek zdarma; seznam jde do bundled.json, ostatní věty
//    aplikace stahuje z ospalek.cz až při poslechu a ukládá do zařízení (app/remote.js),
//  - z hudby (audio/hudba) jen styly pohádek zdarma, ostatní se stahují stejně jako věty;
//    staré smyčky hudby z audio/pozadi (*-hudba.mp3, používají je jen starší verze aplikace) vůbec.
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const out = join(here, '..', 'www');

const COPY = ['app', 'config.js', 'covers', 'audio', 'brand/maskot-3d/web', 'brand/ikony', 'brand/hodnoceni'];

// věty pohádek zdarma (tools/hlas/plan.mjs klice)
const env = { ...process.env };
delete env.ZNOVU;
const keep = new Set(JSON.parse(execFileSync(process.execPath, [join(root, 'tools/hlas/plan.mjs'), 'klice'], { cwd: root, env, encoding: 'utf8' })));
if (!keep.size) throw new Error('Žádné věty pohádek zdarma – zkontroluj tools/hlas/plan.mjs klice');
const VOICE = join(root, 'audio', 'hlas', 'jana') + sep;

// hudební styly pohádek zdarma (tools/pozadi/pohadky.json)
const sounds = JSON.parse(readFileSync(join(root, 'tools/pozadi/pohadky.json'), 'utf8'));
const freeIds = JSON.parse(execFileSync(process.execPath, ['-e', `
  globalThis.window = {}; require('vm').runInThisContext(require('fs').readFileSync(${JSON.stringify(join(root, 'app/stories.cs.js'))}, 'utf8'));
  console.log(JSON.stringify(window.STORIES.filter((s) => s.free).map((s) => s.id)));`], { encoding: 'utf8' }));
const freeStyles = new Set(freeIds.map((id) => sounds[id] && sounds[id].styl).filter(Boolean));
if (!freeStyles.size) throw new Error('Pohádky zdarma nemají hudební styl – zkontroluj tools/pozadi/pohadky.json');
const MUSIC = join(root, 'audio', 'hudba') + sep;
const OLD_LOOPS = join(root, 'audio', 'pozadi') + sep;
const skipSound = (s) => (s.startsWith(MUSIC) && s.endsWith('.mp3') && !freeStyles.has(relative(MUSIC, s).replace(/-\d+-\d+\.mp3$/, '')))
  || (s.startsWith(OLD_LOOPS) && s.endsWith('-hudba.mp3'));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const p of COPY) {
  const src = join(root, p);
  if (!existsSync(src)) throw new Error(`Chybí ${p}`);
  cpSync(src, join(out, p), {
    recursive: true,
    filter: (s) => !s.endsWith('.DS_Store') && !(s.startsWith(VOICE) && s.endsWith('.mp3') && !keep.has(relative(VOICE, s).slice(0, -4))) && !skipSound(s),
  });
}
writeFileSync(join(out, 'audio', 'hlas', 'jana', 'bundled.json'), JSON.stringify([...keep]));

// app/index.html: pryč se zámkem (od spuštění webu tam už není, kontrola jen pro jistotu)
const indexPath = join(out, 'app', 'index.html');
let html = readFileSync(indexPath, 'utf8');
html = html.replace(/\s*<!--[^>]*Zámek[^>]*-->/, '').replace(/\s*<script src="\.\.\/gate\.js[^"]*"><\/script>/, '');
if (html.includes('gate.js')) throw new Error('Nepodařilo se odstranit gate.js z app/index.html');
writeFileSync(indexPath, html);

// právní dokumenty z webu
const appJs = join(out, 'app', 'app.js');
writeFileSync(appJs, readFileSync(appJs, 'utf8')
  .replaceAll('"../obchodni-podminky/"', '"https://ospalek.cz/obchodni-podminky/"')
  .replaceAll('"../ochrana-osobnich-udaju/"', '"https://ospalek.cz/ochrana-osobnich-udaju/"'));

// vstup Capacitoru je www/index.html → aplikace
writeFileSync(join(out, 'index.html'), `<!doctype html>
<html lang="cs"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=app/index.html">
<script>location.replace('app/index.html')</script><title>Ospalek</title></head><body></body></html>
`);
console.log(`mobile/www připraveno (hlas: ${keep.size} vět pohádek zdarma, hudba: ${[...freeStyles].join(', ')}; ostatní se stahuje z webu)`);
