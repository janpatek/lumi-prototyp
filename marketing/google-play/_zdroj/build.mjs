// Vyrenderuje grafiku pro Google Play z grafika.html do ../grafika/ (čeština) a ../grafika/sk/ (slovenština).
//
//   TOOLS=/cesta/k/node_modules node build.mjs
//
// TOOLS je složka s node_modules, kde je puppeteer-core (mimo repo). Renderuje se v nainstalovaném
// Google Chrome. Obrazovky aplikace v obrazovky/ nafotí nafotit.cjs (viz jeho hlavička).
// Feature graphic se ukládá jako JPEG bez průhlednosti, jak Google vyžaduje.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'grafika');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const puppeteer = createRequire(path.join(process.env.TOOLS || HERE, 'x.js'))('puppeteer-core');

fs.mkdirSync(OUT, { recursive: true });

// Texty pro náhled (../index.html) se berou z listing.md, aby byly jen na jednom místě.
function readListing(file) {
  const md = fs.readFileSync(path.join(HERE, '..', file), 'utf8');
  const part = (head) => md.split(/^## /m).find((x) => x.startsWith(head)) || '';
  const bold = (head) => (part(head).match(/\*\*(.+?)\*\*/) || [])[1];
  const code = (head) => (part(head).match(/```\n([\s\S]*?)```/) || [])[1].trimEnd();
  return { title: bold('Název'), short: bold('Krátký'), long: code('Dlouhý'), news: code('Co je nového') };
}
const listing = { cs: readListing('listing.md'), sk: readListing('listing-sk.md') };
fs.writeFileSync(path.join(HERE, 'listing-data.js'), `// Vygenerováno build.mjs z listing.md – neupravuj ručně.\nwindow.LISTING = ${JSON.stringify(listing, null, 2)};\n`);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--allow-file-access-from-files', '--force-color-profile=srgb'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1 });
  for (const lang of ['cs', 'sk']) {
  const dir = lang === 'cs' ? OUT : path.join(OUT, lang);
  fs.mkdirSync(dir, { recursive: true });
  await page.goto(pathToFileURL(path.join(HERE, 'grafika.html')).href + `?lang=${lang}`, { waitUntil: 'networkidle0' });
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map((i) => i.decode().catch(() => 0))); });
  for (const el of await page.$$('section[data-out]')) {
    const name = await el.evaluate((n) => n.dataset.out);
    const jpeg = name.startsWith('feature');
    const file = path.join(dir, jpeg ? name.replace(/\.png$/, '.jpg') : name);
    await el.screenshot({ path: file, ...(jpeg ? { type: 'jpeg', quality: 95 } : {}) });
    console.log(path.relative(OUT, file));
  }
  }
} finally {
  await browser.close();
}
