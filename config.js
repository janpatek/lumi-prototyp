// Ospalek – veřejné nastavení napojení na databázi (Supabase, region EU).
// Anon klíč je veřejný z principu: sám nic nesmí, data chrání pravidla a funkce v databázi (supabase/schema.sql).
// Prázdné hodnoty = aplikace nic neodesílá a administrace ukazuje jen ukázková data.
// Návod: supabase/README.md.
window.OSPALEK_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
};
