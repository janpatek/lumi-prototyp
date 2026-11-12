// Start administrace: rozhodne se, odkud jsou data.
//  – ostrá data (je vyplněný ../config.js): přihlášení člena týmu do Supabase a načtení souhrnů,
//  – jinak ukázková data z demo-data.js.
// Zbytek skriptů potřebuje hotová data (window.DEMO), proto se načítá až potom: stahuje se paralelně, spouští v pořadí.
const ADMIN_SCRIPTS = ['store-data.js?v=1', 'api.js?v=5', 'vtable.js?v=2', 'admin.js?v=13', 'helpdesk.js?v=2', 'rodiny.js?v=4', 'analytika.js?v=7', 'predplatne.js?v=1', 'kupony.js?v=3', 'system.js?v=6', 'upozorneni.js?v=1', '../app/voice-lines.js?v=1', 'generator.js?v=1', 'socialni-site.js?v=5'];

function loadScripts(list) {
  return Promise.all(list.map((src) => new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.async = false; // async=false: stahují se najednou, spustí se v pořadí
    s.onload = res; s.onerror = () => rej(new Error('Nepodařilo se načíst ' + src));
    document.body.appendChild(s);
  })));
}
function bootMessage(html) {
  let el = document.getElementById('bootMsg');
  if (!el) { el = document.createElement('main'); el.id = 'bootMsg'; el.className = 'login'; document.body.prepend(el); }
  el.innerHTML = `<div class="panel login-card"><img src="../brand/maskot-3d/web/ospalek-spi.webp" alt=""><b class="wordmark">Ospalek</b>${html}</div>`;
  return el;
}

async function bootAdmin() {
  let t0 = performance.now();
  document.body.classList.add('locked');
  try {
    if (LIVE.mode() === 'live') {
      const me = await LIVE.ensureStaff();
      t0 = performance.now(); // čas psaní hesla se do startu nepočítá
      bootMessage('<h1>Načítám ostrá data…</h1><p class="muted">Souhrny ze Supabase</p>');
      window.DEMO = await LIVE.load(me);
    } else {
      window.DEMO = window.makeDemo();
    }
    await loadScripts(ADMIN_SCRIPTS);
  } catch (e) {
    const el = bootMessage(`<h1>Data se nepodařilo načíst</h1><p class="err">${String(e.message).replace(/[<>&]/g, '')}</p>
      <button class="btn" type="button" onclick="location.reload()">Zkusit znovu</button>
      <button class="linkbtn" type="button" id="sbOut">Odhlásit z databáze</button>`);
    el.querySelector('#sbOut').onclick = () => { LIVE.signOut(); location.reload(); };
    return;
  }
  document.getElementById('bootMsg')?.remove();
  document.body.classList.remove('locked');
  window.BOOT_MS = performance.now() - t0;
  startAdmin();
}
bootAdmin();
