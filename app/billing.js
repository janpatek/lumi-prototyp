// Ospalek – předplatné. Platí se jen v mobilní aplikaci přes App Store a Google Play, bez prostředníka (žádný RevenueCat).
// Na webu se nic neplatí: zůstává simulace pro vývoj a testování (BILLING.native === false).
// V aplikaci nakupuje vlastní nativní plugin OspalekStore (mobile/android …/StorePlugin.java, mobile/ios …/StorePlugin.swift):
// Google Play Billing a StoreKit 2. Nákup se hned ověří na našem serveru (Edge Function store, supabase/functions/store),
// který ho zapíše k rodině; další změny (obnovení, zrušení, vrácení peněz) posílají obchody serveru samy.
// Produkty v ../config.js: storeAndroid 'ospalek_plus' se základním plánem 'mesicne', storeIos 'ospalek_plus_mesicne'.

const BILLING = (() => {
  const Cap = window.Capacitor;
  const native = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  const ios = native && Cap.getPlatform() === 'ios';
  const LN = native && Cap.Plugins ? Cap.Plugins.LocalNotifications : null; // @capacitor/local-notifications
  const C = window.OSPALEK_CONFIG || {};
  const P = !native ? null : (Cap.Plugins && Cap.Plugins.OspalekStore) || (Cap.nativePromise ? { call: (m, o) => Cap.nativePromise('OspalekStore', m, o) } : null);
  const call = (m, o = {}) => (P.call ? P.call(m, o) : P[m](o));
  const product = ios ? { productId: C.storeIos || 'ospalek_plus_mesicne' } : { productId: C.storeAndroid || 'ospalek_plus', basePlanId: C.storeAndroidPlan || 'mesicne' };
  const on = !!P;

  // ID rodiny = anonymní účet v Supabase (sync.js). Obchod ho dostane při nákupu, server podle něj páruje oznámení.
  const familyId = () => { try { return (JSON.parse(localStorage.getItem('ospalek.sb.v1')) || {}).user || null; } catch (e) { return null; } };
  // Ověření nákupu na serveru: vrací { active, trial, expires, willRenew } nebo null (bez připojení, server nenasazený)
  async function verify(purchase) {
    if (!purchase || !C.supabaseUrl || typeof SYNC === 'undefined' || !SYNC.token) return null;
    try {
      const body = ios ? { platform: 'ios', jws: purchase.jws } : { platform: 'android', token: purchase.token, productId: purchase.productId };
      const r = await fetch(C.supabaseUrl + '/functions/v1/store/app', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: C.supabaseAnonKey, Authorization: 'Bearer ' + (await SYNC.token()) }, body: JSON.stringify(body) });
      return r.ok ? await r.json() : null;
    } catch (e) { return null; }
  }
  // Stav předplatného: z obchodu v telefonu, podrobnosti (konec zkušební doby na Androidu) ze serveru
  let last = null;
  async function state(force) {
    if (last && !force && Date.now() - last.t < 60e3) return last.v;
    const e = await call('entitlement', product);
    let v = { active: !!e.active, willRenew: !!e.willRenew, trial: !!(e.purchase && e.purchase.trial), expires: e.purchase && e.purchase.expires, purchase: e.purchase };
    if (e.purchase) {
      const s = await verify(e.purchase);
      if (s) v = { ...v, trial: !!s.trial, expires: s.expires || v.expires, willRenew: ios ? v.willRenew : !!s.willRenew, active: v.active || !!s.active };
    }
    last = { t: Date.now(), v };
    return v;
  }

  return {
    native,
    on,
    // Je předplatné aktivní? null = nevíme (web, chyba, bez připojení), pak platí poslední známý stav.
    async status() {
      if (!on) return null;
      try { return (await state()).active; } catch (e) { return null; }
    },
    // Koupě měsíčního předplatného (se zkušební dobou 3 dny, pokud na ni má účet nárok). Vrací true/false, zrušení = false.
    async buy() {
      if (!on) throw new Error('Platby v této verzi nejsou zapnuté.');
      const r = await call('buy', { ...product, account: familyId() || undefined });
      if (r.status === 'cancelled') return false;
      if (r.status === 'pending') throw new Error('Platba čeká na schválení (třeba rodičem nebo bankou). Předplatné se zapne samo, až obchod platbu potvrdí.');
      last = null;
      verify(r.purchase); // zapíše nákup k rodině hned, i když oznámení obchodu dorazí později
      return true;
    },
    // Běží zkušební doba? { end: Date, renews } (renews = po jejím konci se začne platit), jinak null.
    async trial() {
      if (!on) return null;
      try {
        const v = await state();
        return v.active && v.trial && v.expires ? { end: new Date(v.expires), renews: !!v.willRenew } : null;
      } catch (er) { return null; }
    },
    // Připomínka konce zkušební doby: upozornění naplánované přímo v telefonu (nic nejde na server).
    // Přijde 6 hodin před hranicí pro zrušení (obchody chtějí zrušit nejpozději 24 hodin před koncem).
    // ask = smí se zeptat na povolení upozornění (jen hned po objednání, jinak se plánuje jen s už daným povolením).
    async remind(t, price, ask) {
      if (!LN) return;
      const id = 3001;
      try {
        await LN.cancel({ notifications: [{ id }] });
        if (!t || !t.renews) return;
        const cutoff = new Date(t.end.getTime() - 24 * 3600e3);
        const at = new Date(cutoff.getTime() - 6 * 3600e3);
        if (at <= new Date()) return;
        let perm = await LN.checkPermissions();
        if (perm.display !== 'granted' && ask) perm = await LN.requestPermissions();
        if (perm.display !== 'granted') return;
        const when = `${cutoff.getDate()}. ${cutoff.getMonth() + 1}. v ${cutoff.getHours()}:${String(cutoff.getMinutes()).padStart(2, '0')}`;
        await LN.schedule({ notifications: [{ id, title: 'Zítra končí zkušební doba Ospalka', body: `Pak se začne platit ${price} měsíčně. Když nechcete pokračovat, zrušte předplatné v nastavení obchodu nejpozději ${when}.`, schedule: { at, allowWhileIdle: true } }] });
      } catch (e) { /* bez připomínky aplikace funguje dál, konec zkušební doby ukazuje i knihovna */ }
    },
    // Cena měsíčního předplatného tak, jak ji ukazuje obchod (např. „129,00 Kč“ nebo „4,99 €“). null = nevíme.
    async price() {
      if (!on) return null;
      try { return (await call('product', product)).price || null; } catch (e) { return null; }
    },
    async restore() {
      if (!on) return null;
      await call('restore', product);
      return (await state(true)).active;
    },
    // Zrušení a správa předplatného jsou jen v obchodě (Apple: list přímo v aplikaci, Google: stránka předplatných).
    async manage() {
      if (on) { try { await call('manage', product); return; } catch (e) {} }
      location.href = ios ? 'https://apps.apple.com/account/subscriptions' : 'https://play.google.com/store/account/subscriptions';
    },
  };
})();
