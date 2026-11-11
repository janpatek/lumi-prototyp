// Připraví mobile/www pro Capacitor: zkopíruje webovou aplikaci z ../app a sdílené soubory,
// které aplikace načítá přes ../ (config.js, brand, covers, audio). Cesty zůstávají stejné jako na webu,
// takže app/ se kvůli mobilu nemusí měnit. Úpravy jen pro nativní build:
//  - bez zámku gate.js (ten je pro web před spuštěním; v obchodě se aplikace distribuuje přes testovací stopy),
//  - odkazy na obchodní podmínky a zásady vedou na ospalek.cz (nejsou součástí balíčku).
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const out = join(here, '..', 'www');

const COPY = ['app', 'config.js', 'covers', 'audio', 'brand/maskot-3d/web', 'brand/ikony'];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const p of COPY) {
  const src = join(root, p);
  if (!existsSync(src)) throw new Error(`Chybí ${p}`);
  cpSync(src, join(out, p), { recursive: true, filter: (s) => !s.endsWith('.DS_Store') });
}

// app/index.html: pryč se zámkem
const indexPath = join(out, 'app', 'index.html');
let html = readFileSync(indexPath, 'utf8');
const before = html;
html = html.replace(/\s*<!--[^>]*Zámek[^>]*-->/, '').replace(/\s*<script src="\.\.\/gate\.js[^"]*"><\/script>/, '');
if (html === before || html.includes('gate.js')) throw new Error('Nepodařilo se odstranit gate.js z app/index.html');
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
console.log('mobile/www připraveno');
