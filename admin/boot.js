// Start administrace: po hesle se rozhodne, odkud jsou data.
//  – ostrá data (je vyplněný ../config.js): přihlášení člena týmu do Supabase a načtení souhrnů,
//  – jinak ukázková data z demo-data.js.
// Zbytek skriptů potřebuje hotová data (window.DEMO), proto se načítá až potom: stahuje se paralelně, spouští v pořadí.
const ADMIN_SCRIPTS = ['api.js?v=3', 'vtable.js?v=2', 'admin.js?v=6', 'helpdesk.js?v=2', 'rodiny.js?v=3', 'analytika.js?v=3', 'kupony.js?v=2', 'system.js?v=3'];

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
  el.innerHTML = `<div class="panel login-card"><img src="../brand/maskot-3d/web/ospalek-spi.webp" alt=""><b class="wordmark">ospalek</b>${html}</div>`;
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
      <button class="btn white" type="button" style="margin-top:8px" id="toDemo">Zobrazit ukázková data</button>`);
    el.querySelector('#toDemo').onclick = () => { LIVE.setMode('demo'); location.reload(); };
    return;
  }
  document.getElementById('bootMsg')?.remove();
  document.body.classList.remove('locked');
  window.BOOT_MS = performance.now() - t0;
  startAdmin();
}
window.adminGate(bootAdmin);
