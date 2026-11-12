// App Store: kopie marketing/google-play/_zdroj/nafotit.cjs. Předplatné ukázkové rodiny drží S.codeUntil
// (aplikace mimo obchod jinak S.premium při startu zruší), poličky se přepínají přes ui.shelf.
// Nafotí obrazovky aplikace s ukázkovou rodinou (Toník a Eliška z Benešova) do obrazovky/.
//
//   TOOLS=/cesta/k/node_modules node nafotit.cjs <kopie mobile/www> obrazovky
//
// Vstup je kopie mobile/www (npm run web v mobile/) BEZ databáze: v kopii přepiš config.js na prázdné
// supabaseUrl a supabaseAnonKey, ať se ukázková rodina neposílá do ostré databáze. Ven pustí jen Google Fonts.
// Skryje vývojářský přepínač hlasu „Prohlížeč“ a poznámku pod přehrávačem, které ve vydané verzi nebudou.
const puppeteer = require(process.env.TOOLS + '/puppeteer-core');
const path = require('path');
const DIR = process.argv[2], OUT = process.argv[3];
const SEED = `
  S.user = { email: 'rodina@example.com', provider: 'google' }; S.onboarded = true; S.premium = true; S.codeUntil = Date.now() + 1e11; S.analytics = false;
  S.family.children = [
    { id: 'a', gender: 'm', age: 5, forms: decline('Toník', 'm'), food: 'palačinky', animal: 'liška' },
    { id: 'b', gender: 'f', age: 3, forms: decline('Eliška', 'f'), food: 'jahody', animal: 'ježek' } ];
  S.family.parents = [ { id: 'p', role: 'mama', name: true, forms: decline('Petra', 'f') }, { id: 'q', role: 'tata', name: false, forms: decline('', 'm') } ];
  S.family.home = { town: 'Benešov', inTown: 'v Benešově', near: ['Bystřice', 'Týnec nad Sázavou', 'Vlašim'], attr: ['zámek Konopiště', 'rozhledna Špulka'],
    nearOpts: ['Bystřice', 'Týnec nad Sázavou', 'Vlašim', 'Votice', 'Neveklov', 'Čerčany'], attrOpts: ['zámek Konopiště', 'rozhledna Špulka', 'hrad Český Šternberk', 'Zoo Chotěbuz'] };
  S.heroIds = ['a'];`;
(async () => {
  const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--allow-file-access-from-files'] });
  const p = await b.newPage();
  await p.setRequestInterception(true);
  p.on('request', (r) => { const u = r.url(); (u.startsWith('file:') || u.startsWith('data:') || /fonts\.(googleapis|gstatic)\.com/.test(u)) ? r.continue() : r.abort(); });
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const url = 'file://' + path.join(DIR, 'app/index.html');
  await p.goto(url, { waitUntil: 'networkidle0' });
  await p.evaluate(SEED + 'save();');
  const shot = async (name, js, theme = 'light') => {
    await p.goto(url, { waitUntil: 'networkidle0' });
    await p.evaluate(`S.theme='${theme}'; save(); applyTheme(); ${js || 'render();'}`);
    await p.addStyleTag({ content: '.chips.voices [data-v="browser"], .voicewarn { display: none !important; } ::-webkit-scrollbar { display: none; }' });
    await p.evaluate(() => document.fonts.ready);
    await new Promise((r) => setTimeout(r, 900));
    await p.screenshot({ path: path.join(OUT, name + '.png') });
    console.log(name);
  };
  await shot('knihovna', "ui.shelf=null; go('lib');");
  await shot('knihovna-auto', "ui.shelf='auto'; go('lib');");
  await shot('prehravac', "go('lib'); openPlayer(STORIES.find(s=>s.id==='hvezdicka')); P.i=2; highlight(); document.querySelector('#ptext p.now').scrollIntoView({block:'center'});", 'dark');
  await shot('prehravac-den', "go('lib'); openPlayer(STORIES.find(s=>s.id==='zubar')); P.i=1; highlight(); document.querySelector('#ptext p.now').scrollIntoView({block:'center'});");
  await shot('dite', "go('settings'); personSheet('child','a'); document.querySelectorAll('#modal details').forEach(d=>d.open=true);");
  await shot('deti', "ui.screen='onb'; ui.step=0; render();");
  await shot('bydliste', "ui.screen='onb'; ui.step=2; render();");
  await shot('rodina', "go('settings');");
  await b.close();
})();
