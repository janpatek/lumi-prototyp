// Ospalek – zveřejňování na Instagram a facebookovou stránku z administrace (Supabase Edge Function „instagram“).
// Instagram Graph API s přihlášením přes Facebook (firemní účet Instagramu propojený s facebookovou stránkou).
// Přístupový token stránky žije jen tady
// a v tabulce instagram_ucet (supabase/migrations/20261113_instagram.sql), do prohlížeče se nedostane.
//
// Adresy (https://<projekt>.supabase.co/functions/v1/instagram/…), všechny kromě /zpet a /cron chtějí člena týmu s rolí
// Vlastník nebo Obsah přihlášeného i kódem z Google Authenticatoru (Authorization: Bearer <token z administrace>):
//   POST /instagram/stav        – je účet propojený? (jméno účtu, platnost tokenu, adresa pro přesměrování)
//   POST /instagram/propojit    { navrat } – vrátí odkaz na přihlášení přes Facebook
//   GET  /instagram/zpet        – sem Facebook vrátí přihlášení (?code&state), funkce si vymění token a přesměruje zpět do administrace
//   POST /instagram/odpojit     – zapomene propojený účet
//   POST /instagram/zverejnit   { id, popisek } – připraví příspěvek z katalogu (katalog.json v úložišti marketing)
//   POST /instagram/dokoncit    { kontejner, id, popisek } – zeptá se, jestli ho Instagram zpracoval, a pak ho zveřejní
//   POST /instagram/cron        – kalendář (tabulka socialni_plan): zveřejní, co je na řadě. Volá ho pg_cron každou minutu,
//                                 nic nepřijímá a dělá jen to, co tým naplánoval, proto nechce přihlášení.
// Video Instagram zpracovává i minuty, proto zveřejnění běží na dva kroky a administrace se na /dokoncit ptá opakovaně.
//
// Nasazení: Supabase → Edge Functions → Deploy a new function → Via editor, název instagram, vložit tenhle soubor,
// v nastavení funkce VYPNOUT „Verify JWT“ (na /zpet přichází prohlížeč z Facebooku bez tokenu; ostatní adresy si
// přihlášení ověřují samy). Tajné hodnoty (Edge Functions → Secrets): IG_APP_ID a IG_APP_SECRET = App ID a App secret
// z Meta for Developers → aplikace Ospalek.cz → App settings → Basic.
// Postup: supabase/README.md, sekce Zveřejňování na Instagram.
//
// Soubor nemá žádné importy, aby šel otestovat i v Node (supabase/functions/instagram/test.mjs).

const GRAPH = 'https://graph.facebook.com/v23.0'; // verze Graph API, Meta ji podporuje zhruba dva roky od vydání
const SCOPES = 'instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement,pages_manage_posts,business_management';
const PLATNOST = 90 * 864e5; // Meta po 90 dnech bez přihlášení chce propojení obnovit (data access expiration)
const ORIGINS = ['https://ospalek.cz', 'https://www.ospalek.cz'];
const okOrigin = (o: string) => ORIGINS.includes(o) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);
const PLACEHOLDER = /\[[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ ]+\]/; // stejné jako v marketing/katalog.mjs

// deno-lint-ignore no-explicit-any
type J = any;
// deno-lint-ignore no-explicit-any
const G: any = globalThis;
const env = (k: string): string => (G.Deno ? G.Deno.env.get(k) : G.process?.env?.[k]) || '';
const fail = (status: number, message: string) => Object.assign(new Error(message), { status });
const claims = (jwt: string) => { try { return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return {}; } };
const redirectUri = () => `${env('SUPABASE_URL')}/functions/v1/instagram/zpet`;
const hashtags = (t: string) => (t.match(/#[^\s#]+/g) || []).length;

// ---------- databáze (tajný klíč, tabulky instagram_* jsou jen pro funkci) ----------
const secretKey = () => (() => { try { return Object.values(JSON.parse(env('SUPABASE_SECRET_KEYS') || '{}'))[0] as string; } catch { return ''; } })() || env('SUPABASE_SERVICE_ROLE_KEY');
async function db(method: string, path: string, body?: J, prefer?: string): Promise<J> {
  const key = secretKey();
  const headers: Record<string, string> = { apikey: key, 'Content-Type': 'application/json' };
  if (key.split('.').length === 3) headers.Authorization = 'Bearer ' + key; // starý klíč service_role je JWT
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${env('SUPABASE_URL')}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw fail(500, 'Databáze: ' + ((j && j.message) || r.status) + (/instagram_/.test((j && j.message) || '') ? ' (je spuštěná migrace 20261113_instagram.sql?)' : ''));
  return j;
}

// ---------- kdo volá ----------
type Caller = { id: string | null; name: string; h: Record<string, string> };
// kalendář běží bez přihlášeného člověka: úložiště čte a zapisuje tajným klíčem
const system = (name: string): Caller => {
  const key = secretKey(), h: Record<string, string> = { apikey: key };
  if (key.split('.').length === 3) h.Authorization = 'Bearer ' + key;
  return { id: null, name, h };
};
async function caller(req: Request): Promise<Caller> {
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer /i, '');
  if (!jwt) throw fail(401, 'Nejsi přihlášený.');
  const r = await fetch(`${env('SUPABASE_URL')}/auth/v1/user`, { headers: { apikey: secretKey(), Authorization: 'Bearer ' + jwt } });
  const u = await r.json().catch(() => null);
  if (!r.ok || !u?.id) throw fail(401, 'Nejsi přihlášený.');
  if (claims(jwt).aal !== 'aal2') throw fail(403, 'Přihlas se i kódem z Google Authenticatoru.');
  const rows = await db('GET', `staff?select=name,role&user_id=eq.${encodeURIComponent(u.id)}`);
  const me = rows && rows[0];
  if (!me || !['owner', 'content'].includes(me.role)) throw fail(403, 'Na Instagram může zveřejňovat jen vlastník a role Obsah.');
  // úložiště se čte a zapisuje pod přihlášením volajícího (stejná pravidla jako v administraci)
  return { id: u.id, name: me.name || '', h: { apikey: req.headers.get('apikey') || env('SUPABASE_ANON_KEY'), Authorization: 'Bearer ' + jwt } };
}

// ---------- úložiště marketing (pod přihlášením volajícího, kalendář tajným klíčem) ----------
async function storage(c: Caller, method: string, path: string, body?: string, type = 'application/json'): Promise<Response> {
  const h: Record<string, string> = { ...c.h };
  if (body !== undefined) Object.assign(h, { 'Content-Type': type, 'x-upsert': 'true', 'Cache-Control': '0' });
  return fetch(`${env('SUPABASE_URL')}/storage/v1/${path}`, { method, headers: h, body });
}
async function katalogItem(c: Caller, id: string): Promise<J> {
  const r = await storage(c, 'GET', `object/authenticated/marketing/katalog.json?t=${Date.now()}`);
  if (!r.ok) throw fail(502, `Katalog v úložišti se nenačetl (${r.status}).`);
  const it = ((await r.json()).polozky || []).find((x: J) => x.id === id);
  if (!it) throw fail(404, 'Materiál v katalogu není.');
  if (!it.ig) throw fail(400, 'Tenhle materiál se na Instagram nezveřejňuje.');
  return it;
}
async function signed(c: Caller, paths: string[]): Promise<Record<string, string>> {
  const r = await storage(c, 'POST', 'object/sign/marketing', JSON.stringify({ expiresIn: 3600, paths }));
  const j = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(j)) throw fail(502, `Nepodařilo se získat odkazy na soubory (${r.status}).`);
  const out: Record<string, string> = {};
  for (const x of j) if (x.signedURL) out[x.path] = `${env('SUPABASE_URL')}/storage/v1${x.signedURL}`;
  const miss = paths.filter((p) => !out[p]);
  if (miss.length) throw fail(400, `V úložišti chybí ${miss.join(', ')}. Nahrajte materiály znovu (tlačítko v administraci na localhost).`);
  return out;
}
// zveřejněný příspěvek se rovnou označí jako použitý (stav.json, stejný jako zaškrtávátko v administraci)
async function markUsed(c: Caller, id: string, permalink: string, extra: J = {}): Promise<J> {
  const r = await storage(c, 'GET', `object/authenticated/marketing/stav.json?t=${Date.now()}`);
  const used = r.ok ? ((await r.json().catch(() => ({}))).used || {}) : {};
  used[id] = { ...(used[id] || {}), at: new Date().toISOString(), by: c.name, ...(permalink ? { ig: permalink } : {}), ...extra };
  if (!used[id].ig && !used[id].fb) used[id].ig = true;
  const w = await storage(c, 'POST', 'object/marketing/stav.json', JSON.stringify({ used }));
  if (!w.ok) console.error('stav.json', w.status, await w.text());
  return used;
}

// ---------- Instagram a Facebook (Graph API) ----------
async function graph(method: string, url: string, params: Record<string, string>, sit = 'Instagram'): Promise<J> {
  const q = new URLSearchParams(params);
  const r = method === 'GET' ? await fetch(`${url}?${q}`) : await fetch(url, { method, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: q });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || j.error) {
    const e = (j && (j.error || j)) || {};
    const msg = e.error_user_msg || e.error_message || e.message || `chyba ${r.status}`;
    const code = e.code || e.error_type || '';
    // 190 = neplatný nebo prošlý token
    throw fail(code === 190 ? 401 : 502, `${sit}: ${msg}${code === 190 ? ' Propojte účet znovu.' : ''}`);
  }
  return j;
}
async function account(): Promise<J> {
  const rows = await db('GET', 'instagram_ucet?id=eq.1&select=*');
  const a = rows && rows[0];
  if (!a) return null;
  const left = Date.parse(a.expires_at) - Date.now();
  if (left <= 0) return { ...a, vyprsel: true };
  return a;
}
async function needAccount(): Promise<J> {
  const a = await account();
  if (!a) throw fail(409, 'Instagram ještě není propojený. Klikněte na Propojit Instagram.');
  if (a.vyprsel) throw fail(409, 'Propojení s Instagramem vypršelo (Meta ho po 90 dnech chce obnovit). Propojte účet znovu.');
  return a;
}
function checkCaption(t: string) {
  if (t.length > 2200) throw fail(400, `Popisek má ${t.length} znaků, Instagram povolí nejvýš 2200.`);
  if (hashtags(t) > 30) throw fail(400, `Popisek má ${hashtags(t)} hashtagů, Instagram povolí nejvýš 30.`);
  if (PLACEHOLDER.test(t)) throw fail(400, 'V popisku jsou ještě zástupné texty v hranatých závorkách, doplňte je.');
}

// připraví kontejner na Instagramu (video zpracovává i minuty, proto zvlášť)
async function igCreate(c: Caller, a: J, it: J, caption: string): Promise<{ kontejner: string; typ: string }> {
  const ig = it.ig, base = `${GRAPH}/${a.ig_user_id}/media`, tok = a.token;
  if (ig.typ === 'REELS') {
    const u = await signed(c, [ig.video, ig.cover].filter(Boolean));
    const k = await graph('POST', base, { media_type: 'REELS', video_url: u[ig.video], ...(ig.cover ? { cover_url: u[ig.cover] } : {}), caption, share_to_feed: 'true', access_token: tok });
    return { kontejner: k.id, typ: 'REELS' };
  }
  const u = await signed(c, ig.obrazky);
  if (ig.typ === 'IMAGE' || ig.obrazky.length === 1) {
    const k = await graph('POST', base, { image_url: u[ig.obrazky[0]], caption, access_token: tok });
    return { kontejner: k.id, typ: 'IMAGE' };
  }
  const kids: string[] = [];
  for (const p of ig.obrazky.slice(0, 10)) kids.push((await graph('POST', base, { image_url: u[p], is_carousel_item: 'true', access_token: tok })).id);
  const k = await graph('POST', base, { media_type: 'CAROUSEL', children: kids.join(','), caption, access_token: tok });
  return { kontejner: k.id, typ: 'CAROUSEL' };
}
// zveřejní zpracovaný kontejner; { ceka: true }, dokud ho Instagram zpracovává
async function igFinish(a: J, kontejner: string, polozka: string, typ: string, popisek: string, zverejnil: string | null): Promise<J> {
  const st = await graph('GET', `${GRAPH}/${kontejner}`, { fields: 'status_code,status', access_token: a.token });
  if (st.status_code === 'IN_PROGRESS') return { ceka: true };
  if (st.status_code === 'PUBLISHED') return { hotovo: true, uz: true, permalink: '' };
  if (st.status_code !== 'FINISHED') throw fail(502, `Instagram příspěvek nezpracoval (${st.status_code}${st.status ? ': ' + st.status : ''}).`);
  const pub = await graph('POST', `${GRAPH}/${a.ig_user_id}/media_publish`, { creation_id: kontejner, access_token: a.token });
  const perm = await graph('GET', `${GRAPH}/${pub.id}`, { fields: 'permalink', access_token: a.token }).catch(() => ({}));
  await db('POST', 'instagram_prispevky', { polozka, typ, media_id: pub.id, permalink: perm.permalink || null, popisek: popisek.slice(0, 2200), zverejnil }, 'return=minimal')
    .catch((e: Error) => console.error('prispevky', e.message));
  return { hotovo: true, permalink: perm.permalink || '' };
}
// facebooková stránka, přes kterou je Instagram propojený: video, fotka nebo příspěvek s více fotkami
async function fbPublish(c: Caller, a: J, it: J, message: string): Promise<string> {
  if (!a.fb_page_id) throw fail(409, 'Facebook: propojení nezná facebookovou stránku. Propojte Instagram znovu.');
  if (!a.fb_muze) throw fail(409, 'Facebook: chybí oprávnění zveřejňovat na stránce. Propojte Instagram znovu a povolte všechna oprávnění.');
  const ig = it.ig, page = a.fb_page_id, tok = a.token, F = 'Facebook';
  if (ig.typ === 'REELS') {
    const u = await signed(c, [ig.video]);
    const v = await graph('POST', `${GRAPH}/${page}/videos`, { file_url: u[ig.video], description: message, access_token: tok }, F);
    return `https://www.facebook.com/${page}/videos/${v.id}`;
  }
  const u = await signed(c, ig.obrazky);
  if (ig.obrazky.length === 1) {
    const ph = await graph('POST', `${GRAPH}/${page}/photos`, { url: u[ig.obrazky[0]], caption: message, access_token: tok }, F);
    return `https://www.facebook.com/${ph.post_id || ph.id}`;
  }
  const media: Record<string, string> = {};
  let i = 0;
  for (const p of ig.obrazky.slice(0, 10)) {
    const ph = await graph('POST', `${GRAPH}/${page}/photos`, { url: u[p], published: 'false', access_token: tok }, F);
    media[`attached_media[${i++}]`] = JSON.stringify({ media_fbid: ph.id });
  }
  const post = await graph('POST', `${GRAPH}/${page}/feed`, { message, ...media, access_token: tok }, F);
  return `https://www.facebook.com/${post.id}`;
}

// ---------- kalendář (tabulka socialni_plan) ----------
// Každé volání si zamkne řádek na 3 minuty, takže se překrývající běhy cronu nepoperou o stejný příspěvek.
// Stav po sítích je ve vysledky: ceka → (Instagram: zpracovava s kontejnerem) → hotovo | chyba; TikTok rovnou rucne.
const FINAL = ['hotovo', 'chyba', 'rucne'];
const NA_ZPRACOVANI = 30 * 60e3; // video, které Instagram nezpracuje do půl hodiny od plánovaného času, se vzdá
async function planStep(row: J, a: J | null, items: Record<string, J>): Promise<J> {
  const v: J = { ...(row.vysledky || {}) };
  const c = system(row.autor || 'Kalendář');
  const it = items[row.polozka];
  const late = Date.now() - Date.parse(row.kdy) > NA_ZPRACOVANI;
  for (const sit of row.site as string[]) {
    const r = v[sit] = { ...(v[sit] || { stav: 'ceka' }) };
    if (FINAL.includes(r.stav)) continue;
    try {
      if (sit === 'tiktok') { r.stav = 'rucne'; continue; }
      if (!it) throw fail(404, 'Materiál v katalogu už není.');
      if (!it.ig) throw fail(400, 'Tenhle materiál nemá soubory pro zveřejnění.');
      if (!a) throw fail(409, 'Instagram není propojený nebo propojení vypršelo.');
      if (sit === 'facebook') {
        r.odkaz = await fbPublish(c, a, it, row.popisek); r.stav = 'hotovo'; r.at = new Date().toISOString();
      } else if (sit === 'instagram') {
        if (!r.kontejner) { checkCaption(row.popisek); Object.assign(r, await igCreate(c, a, it, row.popisek), { stav: 'zpracovava' }); }
        const f = await igFinish(a, r.kontejner, row.polozka, r.typ, row.popisek, row.vytvoril);
        if (f.ceka) { if (late) throw fail(504, 'Instagram video nezpracoval do 30 minut.'); continue; }
        r.stav = 'hotovo'; r.odkaz = f.permalink; r.at = new Date().toISOString();
      }
    } catch (e) {
      r.stav = 'chyba'; r.chyba = (e as Error).message;
    }
  }
  const all = (row.site as string[]).map((s) => v[s].stav);
  const stav = all.every((x) => FINAL.includes(x)) ? (all.includes('chyba') ? 'chyba' : 'hotovo') : 'zpracovava';
  if (stav !== 'zpracovava' && (v.instagram?.stav === 'hotovo' || v.facebook?.stav === 'hotovo')) {
    await markUsed(c, row.polozka, v.instagram?.odkaz || '', v.facebook?.stav === 'hotovo' ? { fb: v.facebook.odkaz || true } : {})
      .catch((e: Error) => console.error('stav.json', e.message));
  }
  return { stav, vysledky: v };
}
async function cron(): Promise<J> {
  const now = new Date().toISOString();
  const due = await db('GET', `socialni_plan?select=id&stav=in.(naplanovano,zpracovava)&kdy=lte.${now}&or=(zamek.is.null,zamek.lt.${now})&order=kdy&limit=5`);
  if (!due.length) return { zpracovano: 0 };
  const a0 = await account();
  const a = a0 && !a0.vyprsel ? a0 : null;
  const r = await storage(system('Kalendář'), 'GET', `object/authenticated/marketing/katalog.json?t=${Date.now()}`);
  const items: Record<string, J> = r.ok ? Object.fromEntries(((await r.json()).polozky || []).map((x: J) => [x.id, x])) : {};
  const out: J[] = [];
  for (const { id } of due) {
    const lock = new Date(Date.now() + 3 * 60e3).toISOString(), t = new Date().toISOString();
    const got = await db('PATCH', `socialni_plan?id=eq.${id}&stav=in.(naplanovano,zpracovava)&or=(zamek.is.null,zamek.lt.${t})`,
      { zamek: lock, stav: 'zpracovava', updated_at: t }, 'return=representation');
    if (!got.length) continue; // mezitím ho vzal jiný běh nebo ho někdo smazal
    const res = await planStep(got[0], a, items);
    await db('PATCH', `socialni_plan?id=eq.${id}`, { ...res, zamek: null, updated_at: new Date().toISOString() }, 'return=minimal');
    out.push({ id, stav: res.stav });
  }
  return { zpracovano: out.length, vysledky: out };
}

const back = (navrat: string, q: Record<string, string>) => new Response(null, { status: 302, headers: { Location: `${navrat}?${new URLSearchParams(q)}#socialni` } });

// ---------- obsluha ----------
export async function handle(req: Request, path: string): Promise<J> {
  if (path === 'zpet') {
    const u = new URL(req.url), state = u.searchParams.get('state') || '';
    const rows = state ? await db('DELETE', `instagram_oauth?state=eq.${encodeURIComponent(state)}`, undefined, 'return=representation') : [];
    const row = rows && rows[0];
    if (!row || Date.now() - Date.parse(row.created_at) > 15 * 60e3) {
      return back(ORIGINS[0] + '/admin/', { ig: 'chyba', zprava: 'Přihlášení vypršelo nebo nepatří k administraci. Zkuste Propojit Instagram znovu.' });
    }
    if (u.searchParams.get('error') || !u.searchParams.get('code')) {
      return back(row.navrat, { ig: 'chyba', zprava: u.searchParams.get('error_description') || 'Propojení jste na Facebooku nepotvrdili.' });
    }
    try {
      const code = u.searchParams.get('code')!.replace(/#_$/, '');
      const app = { client_id: env('IG_APP_ID'), client_secret: env('IG_APP_SECRET') };
      const short = await graph('GET', `${GRAPH}/oauth/access_token`, { ...app, redirect_uri: redirectUri(), code });
      // dlouhodobý token uživatele, z něj token stránky, který nevyprší
      const long = await graph('GET', `${GRAPH}/oauth/access_token`, { ...app, grant_type: 'fb_exchange_token', fb_exchange_token: short.access_token });
      const perms = await graph('GET', `${GRAPH}/me/permissions`, { access_token: long.access_token });
      const ok = new Set((perms.data || []).filter((x: J) => x.status === 'granted').map((x: J) => x.permission));
      if (!ok.has('instagram_content_publish')) throw fail(400, 'Facebook nepovolil zveřejňování na Instagram. Při propojení nechte zaškrtnutá všechna oprávnění.');
      const pages = await graph('GET', `${GRAPH}/me/accounts`, { fields: 'id,name,access_token,instagram_business_account{id,username}', limit: '100', access_token: long.access_token });
      // správce může mít víc stránek s Instagramem, bereme jen účet Ospalek (jméno jde změnit v Secrets: IG_UCET)
      const want = (env('IG_UCET') || 'ospalek.cz').toLowerCase().replace(/^@/, '');
      const withIg = (pages.data || []).filter((x: J) => x.instagram_business_account && x.access_token);
      const page = withIg.find((x: J) => String(x.instagram_business_account.username || '').toLowerCase() === want);
      if (!page) {
        const found = withIg.map((x: J) => '@' + x.instagram_business_account.username).join(', ');
        throw fail(400, `Nenašli jsme Instagram @${want} propojený s facebookovou stránkou${found ? ` (přihlášení vrátilo jen ${found})` : ''}. Propojte ho se stránkou Ospalek.cz a při přihlášení v Upravit přístup zaškrtněte tu stránku i Instagram.`);
      }
      const now = new Date().toISOString();
      await db('POST', 'instagram_ucet', {
        id: 1, ig_user_id: String(page.instagram_business_account.id), username: page.instagram_business_account.username || '', token: page.access_token,
        fb_page_id: String(page.id || ''), fb_page_name: page.name || '', fb_muze: ok.has('pages_manage_posts'),
        expires_at: new Date(Date.now() + PLATNOST).toISOString(), token_at: now, propojil: row.user_id, updated_at: now,
      }, 'resolution=merge-duplicates,return=minimal');
      return back(row.navrat, { ig: 'ok' });
    } catch (e) {
      console.error('zpet', (e as Error).message);
      return back(row.navrat, { ig: 'chyba', zprava: (e as Error).message });
    }
  }

  if (path === 'cron') return cron();

  const c = await caller(req);
  const b = await req.json().catch(() => ({}));

  if (path === 'stav') {
    const a = await account();
    return {
      nastaveno: !!(env('IG_APP_ID') && env('IG_APP_SECRET')), presmerovani: redirectUri(),
      propojeno: !!(a && !a.vyprsel), vyprsel: !!(a && a.vyprsel), username: a?.username || '', expires_at: a?.expires_at || null,
      facebook: a ? { stranka: a.fb_page_name || '', muze: !!(a.fb_page_id && a.fb_muze) } : null,
    };
  }
  if (path === 'propojit') {
    if (!env('IG_APP_ID') || !env('IG_APP_SECRET')) throw fail(409, 'V Supabase → Edge Functions → Secrets chybí IG_APP_ID nebo IG_APP_SECRET.');
    let navrat = ORIGINS[0] + '/admin/';
    try { const n = new URL(String(b.navrat || '')); if (okOrigin(n.origin) && n.pathname.endsWith('/admin/')) navrat = n.origin + n.pathname; } catch { /* výchozí návrat */ }
    const state = [...crypto.getRandomValues(new Uint8Array(24))].map((x) => x.toString(16).padStart(2, '0')).join('');
    await db('DELETE', `instagram_oauth?created_at=lt.${new Date(Date.now() - 15 * 60e3).toISOString()}`);
    await db('POST', 'instagram_oauth', { state, user_id: c.id, navrat }, 'return=minimal');
    const q = new URLSearchParams({ client_id: env('IG_APP_ID'), redirect_uri: redirectUri(), response_type: 'code', scope: SCOPES, auth_type: 'rerequest', state });
    return { url: `https://www.facebook.com/v23.0/dialog/oauth?${q}` };
  }
  if (path === 'odpojit') {
    await db('DELETE', 'instagram_ucet?id=eq.1');
    return { ok: true };
  }
  if (path === 'zverejnit') {
    const a = await needAccount();
    const caption = String(b.popisek ?? '').trim();
    checkCaption(caption);
    return igCreate(c, a, await katalogItem(c, String(b.id || '')), caption);
  }
  if (path === 'dokoncit') {
    const a = await needAccount();
    const kontejner = String(b.kontejner || ''), id = String(b.id || '');
    if (!/^\d+$/.test(kontejner)) throw fail(400, 'Chybí příspěvek k dokončení.');
    const f = await igFinish(a, kontejner, id, String(b.typ || ''), String(b.popisek || ''), c.id);
    if (f.ceka || f.uz) return f;
    const used = id ? await markUsed(c, id, f.permalink) : null;
    return { hotovo: true, permalink: f.permalink, used };
  }
  throw fail(404, 'Neznámá adresa');
}

if (G.Deno) {
  G.Deno.serve(async (req: Request) => {
    const origin = req.headers.get('origin') || '';
    const h: Record<string, string> = {
      'Access-Control-Allow-Origin': okOrigin(origin) ? origin : ORIGINS[0],
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Content-Type': 'application/json', Vary: 'Origin',
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    const path = new URL(req.url).pathname.split('/').filter(Boolean).pop() || '';
    try {
      if (req.method !== (path === 'zpet' ? 'GET' : 'POST')) throw fail(405, 'Nepovolená metoda.');
      const out = await handle(req, path);
      return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200, headers: h });
    } catch (e) {
      const status = (e as J).status || 500;
      console.error(path, status, (e as Error).message);
      return new Response(JSON.stringify({ message: (e as Error).message }), { status, headers: h });
    }
  });
}
