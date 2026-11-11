// Pohádka dne a večerní připomínka.
// - Pohádka dne: plán na dva týdny dopředu z databáze (app_daily, sestavuje ho administrace), uložený v localStorage,
//   takže funguje i bez internetu. Bez plánu se pohádky střídají podle data, stejně jako v databázi (daily_pick).
// - Připomínka: Web Push. Prohlížeč vydá odběr (adresu u své push služby a klíče), ten se uloží k účtu rodiny
//   (app_push_subscribe) a push-worker na něj každý večer pošle upozornění. Jména dětí na server nejdou:
//   aplikace si v zařízení uloží názvy pohádek se jménem (titles) a doplní je do upozornění až sw.js.
// V mobilní aplikaci (Capacitor) Web Push nefunguje, tam bude nativní upozornění.
// Lokální zkouška: ?db=http://localhost:54321 (veřejný klíč VAPID si vezme z napodobeniny Supabase).

const DAILY = (() => {
  const C = window.OSPALEK_CONFIG || {};
  const dev = new URLSearchParams(location.search).get('db');
  const devOk = dev && /^http:\/\/localhost(:\d+)?$/.test(dev);
  const PKEY = 'ospalek.daily.v1', SEEN = 'ospalek.push.seen.v1', META = 'ospalek-meta';
  const START = Date.UTC(2026, 0, 5); // stejný začátek střídání jako daily_pick v supabase/schema.sql
  const get = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  // dnešní datum v Praze (YYYY-MM-DD), ať je pohádka dne stejná jako v upozornění
  const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague' }).format(new Date());
  let plan = get(PKEY) || { hour: 19, enabled: true, days: [], at: 0 };
  let lastTitles = '';

  function pick(list, day = today()) {
    if (!list.length) return null;
    const hit = (plan.days || []).find((d) => d.day === day);
    const planned = hit && list.find((s) => s.id === hit.story);
    if (planned) return planned;
    const n = Math.round((Date.parse(day + 'T00:00:00Z') - START) / 864e5);
    return list[((n % list.length) + list.length) % list.length];
  }

  // plán se obnoví nejvýš jednou za 30 minut (a vždy po půlnoci); onChange překreslí knihovnu
  async function refresh(onChange) {
    if (!SYNC.on || !navigator.onLine) return;
    if (Date.now() - plan.at < 30 * 60e3 && (plan.days || []).some((d) => d.day === today())) return;
    try {
      const r = await SYNC.call('app_daily', { n: 14 });
      if (!r) return;
      const before = JSON.stringify(plan.days);
      const hourBefore = plan.hour;
      plan = { hour: r.hour, enabled: r.enabled, days: r.days || [], at: Date.now() };
      set(PKEY, plan);
      if ((before !== JSON.stringify(plan.days) || hourBefore !== plan.hour) && onChange) onChange();
    } catch (e) { /* zůstane uložený plán nebo střídání */ }
  }

  // ---------- Připomínka (Web Push) ----------
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const hasPush = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && /^https?:$/.test(location.protocol);
  const supported = () => SYNC.on && !OFFLINE.NATIVE && hasPush() && !!(devOk || C.pushKey);
  // iPhone umí upozornění jen z aplikace přidané na plochu (Sdílet → Přidat na plochu)
  const needsInstall = () => SYNC.on && !OFFLINE.NATIVE && ios && !hasPush() && !!(devOk || C.pushKey);
  const permission = () => ('Notification' in window ? Notification.permission : 'default');

  const u8 = (b64) => {
    const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  };
  async function vapidKey() {
    if (devOk) return (await fetch(dev + '/dev/push-key').then((r) => r.json())).publicKey;
    return C.pushKey;
  }
  async function send(sub) {
    const j = sub.toJSON();
    await SYNC.call('app_push_subscribe', { p: { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, platform: 'web' } });
    set(SEEN, today());
  }
  const registration = () => Promise.race([navigator.serviceWorker.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('sw')), 8000))]);

  // Zapnout: zeptá se na povolení (musí být po kliknutí), vydá odběr a uloží ho. Vrací 'ok' | 'denied' | 'error'.
  async function enable() {
    if (!supported()) return 'error';
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return 'denied';
      const reg = await registration();
      const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8(await vapidKey()) });
      await send(sub);
      return 'ok';
    } catch (e) {
      return permission() === 'denied' ? 'denied' : 'error';
    }
  }
  async function disable() {
    set(SEEN, null);
    lastTitles = '';
    if ('caches' in window) caches.delete(META).catch(() => {});
    if (!hasPush()) return;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && await reg.pushManager.getSubscription();
      if (!sub) return;
      await SYNC.call('app_push_unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe();
    } catch (e) { /* bez odběru není co rušit */ }
  }
  // Při startu: odběr se jednou denně potvrdí (prohlížeč ho občas vymění). Vrací stav pro nastavení.
  async function check(want) {
    if (!want || !supported()) return;
    if (permission() !== 'granted') return;
    if (get(SEEN) === today() || !navigator.onLine) return;
    try {
      const reg = await registration();
      const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8(await vapidKey()) });
      await send(sub);
    } catch (e) { /* zkusí se příště */ }
  }

  // Názvy pohádek se jménem dítěte pro sw.js (Cache Storage, sdílená se service workerem). Jen v zařízení.
  function titles(map) {
    const s = JSON.stringify(map);
    if (s === lastTitles || !('caches' in window)) return;
    lastTitles = s;
    caches.open(META).then((c) => c.put(new URL('titulky.json', location.href).href, new Response(s, { headers: { 'Content-Type': 'application/json' } }))).catch(() => {});
  }

  return {
    today, pick, refresh, titles,
    hour: () => plan.hour ?? 19,
    pushOn: () => plan.enabled !== false,
    supported, needsInstall, permission, enable, disable, check,
  };
})();
