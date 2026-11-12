// Ospalek – zveřejňování na Instagram z administrace (Supabase Edge Function „instagram“).
// Instagram Graph API s přihlášením přes Facebook (firemní účet Instagramu propojený s facebookovou stránkou).
// Přístupový token stránky žije jen tady
// a v tabulce instagram_ucet (supabase/migrations/20261113_instagram.sql), do prohlížeče se nedostane.
//
// Adresy (https://<projekt>.supabase.co/functions/v1/instagram/…), všechny kromě /zpet chtějí člena týmu s rolí
// Vlastník nebo Obsah přihlášeného i kódem z Google Authenticatoru (Authorization: Bearer <token z administrace>):
//   POST /instagram/stav        – je účet propojený? (jméno účtu, platnost tokenu, adresa pro přesměrování)
//   POST /instagram/propojit    { navrat } – vrátí odkaz na přihlášení přes Facebook
//   GET  /instagram/zpet        – sem Facebook vrátí přihlášení (?code&state), funkce si vymění token a přesměruje zpět do administrace
//   POST /instagram/odpojit     – zapomene propojený účet
//   POST /instagram/zverejnit   { id, popisek } – připraví příspěvek z katalogu (katalog.json v úložišti marketing)
//   POST /instagram/dokoncit    { kontejner, id, popisek } – zeptá se, jestli ho Instagram zpracoval, a pak ho zveřejní
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
const SCOPES = 'instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement,business_management';
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
type Caller = { id: string; name: string; jwt: string; apikey: string };
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
  return { id: u.id, name: me.name || '', jwt, apikey: req.headers.get('apikey') || env('SUPABASE_ANON_KEY') };
}

// ---------- úložiště marketing (pod přihlášením volajícího) ----------
async function storage(c: Caller, method: string, path: string, body?: string, type = 'application/json'): Promise<Response> {
  const h: Record<string, string> = { apikey: c.apikey, Authorization: 'Bearer ' + c.jwt };
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
async function markUsed(c: Caller, id: string, permalink: string): Promise<J> {
  const r = await storage(c, 'GET', `object/authenticated/marketing/stav.json?t=${Date.now()}`);
  const used = r.ok ? ((await r.json().catch(() => ({}))).used || {}) : {};
  used[id] = { at: new Date().toISOString(), by: c.name, ig: permalink || true };
  const w = await storage(c, 'POST', 'object/marketing/stav.json', JSON.stringify({ used }));
  if (!w.ok) console.error('stav.json', w.status, await w.text());
  return used;
}

// ---------- Instagram ----------
async function graph(method: string, url: string, params: Record<string, string>): Promise<J> {
  const q = new URLSearchParams(params);
  const r = method === 'GET' ? await fetch(`${url}?${q}`) : await fetch(url, { method, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: q });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || j.error) {
    const e = (j && (j.error || j)) || {};
    const msg = e.error_user_msg || e.error_message || e.message || `chyba ${r.status}`;
    const code = e.code || e.error_type || '';
    // 190 = neplatný nebo prošlý token
    throw fail(code === 190 ? 401 : 502,`Instagram: ${msg}${code === 190 ? ' Propojte účet znovu.' : ''}`);
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
      const pages = await graph('GET', `${GRAPH}/me/accounts`, { fields: 'name,access_token,instagram_business_account{id,username}', limit: '100', access_token: long.access_token });
      const page = (pages.data || []).find((x: J) => x.instagram_business_account && x.access_token);
      if (!page) throw fail(400, 'Nenašli jsme facebookovou stránku s propojeným firemním Instagramem. Propojte Instagram Ospalek.cz se stránkou a při přihlášení ji vyberte.');
      const now = new Date().toISOString();
      await db('POST', 'instagram_ucet', {
        id: 1, ig_user_id: String(page.instagram_business_account.id), username: page.instagram_business_account.username || '', token: page.access_token,
        expires_at: new Date(Date.now() + PLATNOST).toISOString(), token_at: now, propojil: row.user_id, updated_at: now,
      }, 'resolution=merge-duplicates,return=minimal');
      return back(row.navrat, { ig: 'ok' });
    } catch (e) {
      console.error('zpet', (e as Error).message);
      return back(row.navrat, { ig: 'chyba', zprava: (e as Error).message });
    }
  }

  const c = await caller(req);
  const b = await req.json().catch(() => ({}));

  if (path === 'stav') {
    const a = await account();
    return {
      nastaveno: !!(env('IG_APP_ID') && env('IG_APP_SECRET')), presmerovani: redirectUri(),
      propojeno: !!(a && !a.vyprsel), vyprsel: !!(a && a.vyprsel), username: a?.username || '', expires_at: a?.expires_at || null,
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
    const it = await katalogItem(c, String(b.id || ''));
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
  if (path === 'dokoncit') {
    const a = await needAccount();
    const kontejner = String(b.kontejner || ''), id = String(b.id || '');
    if (!/^\d+$/.test(kontejner)) throw fail(400, 'Chybí příspěvek k dokončení.');
    const st = await graph('GET', `${GRAPH}/${kontejner}`, { fields: 'status_code,status', access_token: a.token });
    if (st.status_code === 'IN_PROGRESS') return { ceka: true };
    if (st.status_code === 'PUBLISHED') return { hotovo: true, uz: true };
    if (st.status_code !== 'FINISHED') throw fail(502, `Instagram příspěvek nezpracoval (${st.status_code}${st.status ? ': ' + st.status : ''}).`);
    const pub = await graph('POST', `${GRAPH}/${a.ig_user_id}/media_publish`, { creation_id: kontejner, access_token: a.token });
    const perm = await graph('GET', `${GRAPH}/${pub.id}`, { fields: 'permalink', access_token: a.token }).catch(() => ({}));
    await db('POST', 'instagram_prispevky', { polozka: id, typ: String(b.typ || ''), media_id: pub.id, permalink: perm.permalink || null, popisek: String(b.popisek || '').slice(0, 2200), zverejnil: c.id }, 'return=minimal')
      .catch((e: Error) => console.error('prispevky', e.message));
    const used = id ? await markUsed(c, id, perm.permalink || '') : null;
    return { hotovo: true, permalink: perm.permalink || '', used };
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
