// Připraví mobile/www pro Capacitor: zkopíruje webovou aplikaci z ../app a sdílené soubory,
// které aplikace načítá přes ../ (config.js, brand, covers, audio). Cesty zůstávají stejné jako na webu,
// takže app/ se kvůli mobilu nemusí měnit. Úpravy jen pro nativní build:
//  - bez zámku gate.js (ten je pro web před spuštěním; v obchodě se aplikace distribuuje přes testovací stopy),
//  - odkazy na obchodní podmínky a zásady vedou na ospalek.cz (nejsou součástí balíčku),
//  - z hlasu (audio/hlas/jana) jen věty pohádek zdarma; seznam jde do bundled.json, ostatní věty
//    aplikace stahuje z ospalek.cz až při poslechu a ukládá do zařízení (app/remote.js).
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const out = join(here, '..', 'www');

const COPY = ['app', 'config.js', 'covers', 'audio', 'brand/maskot-3d/web', 'brand/ikony'];

// věty pohádek zdarma (tools/hlas/plan.mjs klice)
const env = { ...process.env };
delete env.ZNOVU;
const keep = new Set(JSON.parse(execFileSync(process.execPath, [join(root, 'tools/hlas/plan.mjs'), 'klice'], { cwd: root, env, encoding: 'utf8' })));
if (!keep.size) throw new Error('Žádné věty pohádek zdarma – zkontroluj tools/hlas/plan.mjs klice');
const VOICE = join(root, 'audio', 'hlas', 'jana') + sep;

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const p of COPY) {
  const src = join(root, p);
  if (!existsSync(src)) throw new Error(`Chybí ${p}`);
  cpSync(src, join(out, p), {
    recursive: true,
    filter: (s) => !s.endsWith('.DS_Store') && !(s.startsWith(VOICE) && s.endsWith('.mp3') && !keep.has(relative(VOICE, s).slice(0, -4))),
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
console.log(`mobile/www připraveno (hlas: ${keep.size} vět pohádek zdarma, ostatní se stahují z webu)`);
