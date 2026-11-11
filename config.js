// Ospalek – veřejné nastavení napojení na databázi (Supabase, region EU – Irsko).
// Publishable klíč je veřejný z principu: sám nic nesmí, data chrání pravidla a funkce v databázi (supabase/schema.sql).
// Prázdné hodnoty = aplikace nic neodesílá a administrace ukazuje jen ukázková data.
// Návod: supabase/README.md.
window.OSPALEK_CONFIG = {
  supabaseUrl: 'https://imiujppjewddeldjifkl.supabase.co',
  supabaseAnonKey: 'sb_publishable_uX729wkKmJ4vtTQaWcWzig_dGjzNaJC',
  // Večerní upozornění (push-worker/README.md): veřejný klíč VAPID vyplní `node push-worker/klice.mjs`.
  // Prázdný = aplikace se na upozornění neptá.
  pushKey: '',
  pushUrl: 'https://ospalek-push.jan-patek.workers.dev',
};
