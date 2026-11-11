// Ospalek – předplatné. Platí se jen v mobilní aplikaci přes App Store a Google Play (RevenueCat).
// Na webu se nic neplatí: zůstává simulace pro vývoj a testování (BILLING.native === false).
// V aplikaci (Capacitor) je plugin @revenuecat/purchases-capacitor dostupný jako Capacitor.Plugins.Purchases.
// Klíče jsou veřejné SDK klíče z RevenueCat (Project settings → API keys) v ../config.js:
//   revenuecatAndroidKey: 'goog_…', revenuecatIosKey: 'appl_…'
// Nárok (entitlement) v RevenueCat se jmenuje „plus“, nabídka (offering) „default“ s balíčkem měsíčního předplatného.

const BILLING = (() => {
  const Cap = window.Capacitor;
  const native = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  const P = native && Cap.Plugins ? Cap.Plugins.Purchases : null;
  const LN = native && Cap.Plugins ? Cap.Plugins.LocalNotifications : null; // @capacitor/local-notifications
  const C = window.OSPALEK_CONFIG || {};
  const key = native ? (Cap.getPlatform() === 'ios' ? C.revenuecatIosKey : C.revenuecatAndroidKey) : '';
  const ENT = 'plus';
  const on = !!(P && key);

  // ID uživatele v RevenueCat = anonymní účet rodiny v Supabase (sync.js), ať webhooky spárují předplatné s rodinou.
  const familyId = () => { try { return (JSON.parse(localStorage.getItem('ospalek.sb.v1')) || {}).user || null; } catch (e) { return null; } };
  const active = (info) => !!(info && info.entitlements && info.entitlements.active && info.entitlements.active[ENT]);

  let ready = null;
  const init = () => (ready = ready || P.configure({ apiKey: key, appUserID: familyId() }));

  return {
    native,
    on,
    // Je předplatné aktivní? null = nevíme (web, chyba, bez připojení), pak platí poslední známý stav.
    async status() {
      if (!on) return null;
      try { await init(); const r = await P.getCustomerInfo(); return active(r.customerInfo); } catch (e) { return null; }
    },
    // Koupě měsíčního předplatného (se zkušební dobou 3 dny, pokud na ni má účet nárok). Vrací true/false, zrušení = false.
    async buy() {
      if (!on) throw new Error('Platby v této verzi nejsou zapnuté.');
      await init();
      const o = await P.getOfferings();
      const pkg = o.current && (o.current.monthly || o.current.availablePackages[0]);
      if (!pkg) throw new Error('Nabídka předplatného se nenačetla.');
      try {
        const r = await P.purchasePackage({ aPackage: pkg });
        return active(r.customerInfo);
      } catch (e) {
        if (e && (e.userCancelled || e.code === '1' || e.code === 1)) return false;
        throw e;
      }
    },
    // Cena měsíčního předplatného tak, jak ji ukazuje obchod (např. „129,00 Kč“ nebo „4,99 €“). null = nevíme.
    // Běží zkušební doba? { end: Date, renews } (renews = po jejím konci se začne platit), jinak null.
    async trial() {
      if (!on) return null;
      try {
        await init();
        const e = (await P.getCustomerInfo()).customerInfo.entitlements.active[ENT];
        return e && e.periodType === 'TRIAL' && e.expirationDateMillis ? { end: new Date(e.expirationDateMillis), renews: !!e.willRenew } : null;
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
    async price() {
      if (!on) return null;
      try {
        await init();
        const o = await P.getOfferings();
        const pkg = o.current && (o.current.monthly || o.current.availablePackages[0]);
        return (pkg && pkg.product && pkg.product.priceString) || null;
      } catch (e) { return null; }
    },
    async restore() {
      if (!on) return null;
      await init();
      const r = await P.restorePurchases();
      return active(r.customerInfo);
    },
    // Zrušení a správa předplatného jsou jen v obchodě. Otevře stránku předplatných Applu nebo Googlu.
    async manage() {
      let url = null;
      if (on) { try { await init(); url = (await P.getCustomerInfo()).customerInfo.managementURL; } catch (e) {} }
      if (!url) url = native && Cap.getPlatform() === 'ios' ? 'https://apps.apple.com/account/subscriptions' : 'https://play.google.com/store/account/subscriptions';
      location.href = url;
    },
  };
})();
