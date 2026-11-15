// Ospalek – volitelné přihlášení přes Google (Android, iPhone) a Apple (iPhone).
// Přihlášený uživatel má u nás e-mail: dá se dohledat, když mu něco nefunguje, účet si obnoví na jiném
// telefonu a může dostávat novinky (jen se souhlasem S.news). Bez přihlášení aplikace funguje dál jako dřív.
//
// Nativní doplněk OspalekLogin (mobile/android …/LoginPlugin.java, mobile/ios …/LoginPlugin.swift):
//   google({ nonce }) → { idToken, email?, name? }   nonce = SHA-256 (hex) náhodného řetězce
//   apple({ nonce })  → { idToken, email?, name? }   (jen iPhone)
//   signOut()                                        zapomene vybraný Google účet v telefonu
// Token z telefonu ověří Supabase (sync.js link) s původním náhodným řetězcem; účet se propojí, ID zůstává.
// Na webu přihlášení zatím není (AUTH.can = { google: false, apple: false }).

const AUTH = (() => {
  const Cap = window.Capacitor;
  const native = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  const platform = native ? Cap.getPlatform() : 'web';
  const P = native && Cap.Plugins ? Cap.Plugins.OspalekLogin : null;
  const C = window.OSPALEK_CONFIG || {};
  // Web client ID z Google Cloud (stejný jako v Supabase); bez něj se Google přihlášení nenabízí
  const GID = C.googleWebClientId || '';
  const can = { google: !!P && !!GID && SYNC.on && (platform === 'android' || platform === 'ios'), apple: !!P && SYNC.on && platform === 'ios' };

  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  async function nonce() {
    const raw = hex(crypto.getRandomValues(new Uint8Array(16)));
    const hashed = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)));
    return { raw, hashed };
  }

  // Přihlásí uživatele. Vrací { provider, email, name, switched }, null = uživatel volbu zavřel.
  async function signIn(provider) {
    if (!can[provider]) throw new Error('Přihlášení tady není dostupné.');
    const n = await nonce();
    let r;
    try {
      r = await P[provider]({ nonce: n.hashed, clientId: GID });
    } catch (e) {
      if (e && (e.code === 'CANCELLED' || /cancel/i.test(e.message || ''))) return null;
      throw new Error(e && e.message ? e.message : 'Přihlášení se nepovedlo.');
    }
    if (!r || !r.idToken) return null;
    const res = await SYNC.link(provider, r.idToken, n.raw);
    return { provider, email: res.email || r.email || null, name: r.name || null, switched: res.switched };
  }

  async function signOut() {
    if (P) { try { await P.signOut(); } catch (e) { /* nevadí */ } }
    SYNC.signOut();
  }

  return { can, signIn, signOut };
})();
