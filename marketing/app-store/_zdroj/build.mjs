// Vyrenderuje obrázky pro App Store z grafika.html do ../obrazky/ (čeština) a ../obrazky/sk/ (slovenština).
//
//   TOOLS=/cesta/k/node_modules node build.mjs
//
// TOOLS je složka s node_modules, kde je puppeteer-core (mimo repo). Renderuje se v nainstalovaném Google Chrome.
// Obrazovky aplikace v obrazovky/ nafotí nafotit.cjs (viz jeho hlavička).
// Rozměr 1320×2868 je iPhone 6,9"; App Store z něj zmenší obrázky i pro menší iPhony.
// Apple nechce průhlednost, proto JPEG.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'obrazky');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const puppeteer = createRequire(path.join(process.env.TOOLS || HERE, 'x.js'))('puppeteer-core');

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
      const name = (await el.evaluate((n) => n.dataset.out)).replace(/\.png$/, '.jpg');
      await el.screenshot({ path: path.join(dir, name), type: 'jpeg', quality: 92 });
      console.log(path.relative(OUT, path.join(dir, name)));
    }
  }
} finally {
  await browser.close();
}
