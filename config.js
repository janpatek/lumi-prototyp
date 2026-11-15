// Ospalek – veřejné nastavení napojení na databázi (Supabase, region EU – Irsko).
// Publishable klíč je veřejný z principu: sám nic nesmí, data chrání pravidla a funkce v databázi (supabase/schema.sql).
// Prázdné hodnoty = aplikace nic neodesílá a administrace ukazuje jen ukázková data.
// Návod: supabase/README.md.
window.OSPALEK_CONFIG = {
  supabaseUrl: 'https://imiujppjewddeldjifkl.supabase.co',
  supabaseAnonKey: 'sb_publishable_uX729wkKmJ4vtTQaWcWzig_dGjzNaJC',
  // Předplatné v mobilní aplikaci (app/billing.js): produkty v Google Play Console a App Store Connect.
  storeAndroid: 'ospalek_plus', storeAndroidPlan: 'mesicne', storeIos: 'ospalek_plus_mesicne',
  // Volitelné přihlášení přes Google (app/auth.js): veřejné ID klienta typu Web z Google Cloud (projekt ospalek-514414),
  // stejné jako v Supabase → Authentication → Providers → Google. Prázdné = přihlášení se nenabízí.
  googleWebClientId: '570024544411-a5hcrl30abi17t5mgrveeu28phvto11p.apps.googleusercontent.com',
  // Večerní upozornění (push-worker/README.md): veřejný klíč VAPID vyplní `node push-worker/klice.mjs`.
  // Prázdný = aplikace se na upozornění neptá.
  pushKey: '',
  pushUrl: 'https://ospalek-push.jan-patek.workers.dev',
};
