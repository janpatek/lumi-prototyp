// Ospalek – nová verze mobilní aplikace. Na webu nic nedělá (web má vždy nejnovější kód ze serveru).
// Plugin @capawesome/capacitor-app-update (AppUpdate): Android se ptá Google Play (In-App Updates), iPhone App Store.
//
// 1) Povinná aktualizace: nejnižší podporované číslo sestavení z databáze (app_release, administrace → Pohádka dne).
//    Starší aplikace místo všeho ukáže výzvu k aktualizaci. Android aktualizuje přímo v aplikaci, jinak otevře obchod.
//    Jen když databáze odpoví: bez internetu se aktualizovat nedá a stažené pohádky mají jít pustit dál.
// 2) Nepovinná: obchod hlásí novější verzi → nenápadná výzva dole v knihovně, pro stejnou verzi nejvýš jednou za 3 dny.
//    Android ji stáhne na pozadí (pohádka hraje dál) a po stažení nabídne restart, iPhone otevře App Store.
//    Nikdy během přehrávání: restart by pohádku utnul.
// Načítá se po app.js (používá ui, $modal, MASCOT, esc). Číslo verze se ukládá pro sync.js (verze v administraci).

const UPDATE = (() => {
  const Cap = window.Capacitor;
  const native = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  if (!native) return { native: false };
  const ios = Cap.getPlatform() === 'ios';
  const C = window.OSPALEK_CONFIG || {};
  const P = (Cap.Plugins && Cap.Plugins.AppUpdate) || (Cap.nativePromise ? { call: (m, o) => Cap.nativePromise('AppUpdate', m, o) } : null);
  if (!P) return { native: true };
  const call = (m, o = {}) => (P.call ? P.call(m, o) : P[m](o));
  const AVAILABLE = 2, DOWNLOADED = 11, OK = 0;
  const KEY = 'ospalek.upd.v1', VKEY = 'ospalek.nver.v1';
  const get = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
  const put = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} };
  const busy = () => !!document.getElementById('player') || !!$modal.innerHTML || ui.screen === 'onb' || ui.screen === 'login';
  let info = null, lastCheck = 0, downloading = false;

  async function storeInfo() {
    info = await call('getAppUpdateInfo', ios ? { country: 'CZ' } : {});
    // verze pro administraci (sync.js): „android-1.26-28“
    try { localStorage.setItem(VKEY, JSON.stringify(`${info.currentVersionName}-${info.currentVersionCode}`)); } catch (e) {}
    return info;
  }
  // nejnižší podporované sestavení z databáze; null = nevíme (bez internetu, funkce ještě není v databázi)
  async function minBuild() {
    if (!C.supabaseUrl || !C.supabaseAnonKey) return null;
    try {
      const r = await fetch(C.supabaseUrl + '/rest/v1/rpc/app_release', { method: 'POST', body: '{}',
        headers: { apikey: C.supabaseAnonKey, Authorization: 'Bearer ' + C.supabaseAnonKey, 'Content-Type': 'application/json' } });
      if (!r.ok) return null;
      const j = await r.json();
      return Number(j && j[ios ? 'ios_min' : 'android_min']) || 0;
    } catch (e) { return null; }
  }
  const openStore = () => call('openAppStore', ios ? { appId: C.appStoreId } : {}).catch(() => {});

  function banner(text, onTap) {
    document.querySelector('.fresh-toast')?.remove();
    const t = document.createElement('button');
    t.className = 'fresh-toast';
    t.textContent = text;
    t.addEventListener('click', () => { t.remove(); onTap(); });
    document.body.append(t);
    setTimeout(() => t.classList.add('out'), 12000);
    setTimeout(() => t.remove(), 12600);
  }

  // povinná aktualizace: přes celou obrazovku, bez zavření
  function force() {
    if (document.querySelector('.force-update')) return;
    const el = document.createElement('div');
    el.className = 'force-update';
    el.setAttribute('role', 'alertdialog');
    el.setAttribute('aria-labelledby', 'fuT');
    el.innerHTML = `<div class="force-box">
      <img src="${MASCOT.head}" alt="">
      <h2 id="fuT">Ospalek potřebuje aktualizovat</h2>
      <p>Tahle verze aplikace už nefunguje správně. Aktualizace trvá chvilku, pohádky, děti i předplatné zůstanou.</p>
      <button class="btn" type="button">Aktualizovat</button>
    </div>`;
    el.querySelector('button').addEventListener('click', async () => {
      if (!ios && info && info.updateAvailability === AVAILABLE && info.immediateUpdateAllowed) {
        try { if ((await call('performImmediateUpdate')).code === OK) return; } catch (e) { /* zkusíme obchod */ }
      }
      openStore();
    });
    document.body.append(el);
    try { if (document.getElementById('player')) closePlayer(); } catch (e) {}
  }

  function offerRestart() {
    if (busy()) return;
    banner('Nová verze Ospalka je stažená. Restartovat ›', () => call('completeFlexibleUpdate').catch(() => {}));
  }

  function offer() {
    if (busy() || downloading) return;
    const code = String(info.availableVersionCode || info.availableVersionName || '');
    const s = get();
    if (s.code === code && Date.now() - (s.at || 0) < 3 * 864e5) return;
    put({ code, at: Date.now() });
    banner('Je tu nová verze Ospalka. Aktualizovat ›', async () => {
      if (ios || !info.flexibleUpdateAllowed) { openStore(); return; }
      try {
        downloading = (await call('startFlexibleUpdate')).code === OK; // Google Play se zeptá a stahuje na pozadí
      } catch (e) { openStore(); }
    });
  }

  async function check(forceNow) {
    if (!forceNow && Date.now() - lastCheck < 3 * 3600e3) {
      // mezitím se mohla dostáhnout nová verze
      if (downloading && info) { try { if ((await storeInfo()).installStatus === DOWNLOADED) offerRestart(); } catch (e) {} }
      return;
    }
    lastCheck = Date.now();
    try { await storeInfo(); } catch (e) { info = null; }
    const min = await minBuild();
    const cur = info ? Number(info.currentVersionCode) || 0 : 0;
    if (min && cur && cur < min && (!ios || C.appStoreId)) { force(); return; }
    if (!info) return;
    if (!ios && info.installStatus === DOWNLOADED) { downloading = true; offerRestart(); return; }
    if (info.updateAvailability === AVAILABLE && (!ios || C.appStoreId)) offer();
  }

  // stav stahování na Androidu (Google Play hlásí průběh)
  if (!ios && P.addListener) {
    try { P.addListener('onFlexibleUpdateStateChange', (st) => { if (st && st.installStatus === DOWNLOADED) { downloading = true; offerRestart(); } }); } catch (e) {}
  }
  // systémové Zpět při povinné aktualizaci: nic nezavírat, aplikace jde do pozadí
  const back = window.ospalekBack;
  window.ospalekBack = () => (document.querySelector('.force-update') ? false : back ? back() : false);

  setTimeout(() => check(true), 3000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(false); });
  return { native: true, check };
})();
