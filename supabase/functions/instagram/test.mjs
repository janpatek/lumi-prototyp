// Test funkce instagram bez Supabase a bez Instagramu: node supabase/functions/instagram/test.mjs
// Databázi, úložiště, přihlášení i Instagram Graph API nahrazuje podvržený fetch, ověřuje se celý průběh
// propojení (OAuth), zveřejnění reelu, karuselu a obrázku, obnova tokenu a odmítnutí cizích lidí.
import assert from 'node:assert/strict';

const SB = 'https://test.supabase.co';
Object.assign(process.env, { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'a.b.c', IG_APP_ID: '123', IG_APP_SECRET: 'tajne' });
const { handle } = await import('./index.ts');

const jwt = (sub, aal = 'aal2') => `x.${Buffer.from(JSON.stringify({ sub, aal })).toString('base64url')}.y`;
const USERS = { [jwt('jan')]: 'jan', [jwt('podpora')]: 'podpora', [jwt('jan', 'aal1')]: 'jan' };
const STAFF = { jan: { name: 'Jan', role: 'owner' }, podpora: { name: 'Petra', role: 'support' } };
const KATALOG = { polozky: [
  { id: 'reel-jmeno', ig: { typ: 'REELS', video: 'reels/01-jmeno/reel.mp4', cover: 'reels/01-jmeno/obalka.jpg', obrazky: [] } },
  { id: 'ig-pred-a-po', ig: { typ: 'CAROUSEL', video: null, cover: null, obrazky: ['p/s1.jpg', 'p/s2.jpg', 'p/s3.jpg'] } },
  { id: 'ig-ahoj', ig: { typ: 'IMAGE', video: null, cover: null, obrazky: ['a/s1.jpg'] } },
  { id: 'profil-x', ig: null },
] };
const FILES = new Set(['reels/01-jmeno/reel.mp4', 'reels/01-jmeno/obalka.jpg', 'p/s1.jpg', 'p/s2.jpg', 'p/s3.jpg', 'a/s1.jpg']);
const T = { oauth: [], ucet: [], prispevky: [], stav: null };
const calls = [];
let seq = 1000, polls = 0;
const res = (body, status = 200) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const eqv = (u, k) => (u.searchParams.get(k) || '').replace(/^eq\./, '');

globalThis.fetch = async (url, o = {}) => {
  const u = new URL(url), m = o.method || 'GET';
  const body = o.body instanceof URLSearchParams ? Object.fromEntries(o.body) : o.body ? JSON.parse(o.body) : null;
  calls.push({ m, url: u.origin + u.pathname, body, q: Object.fromEntries(u.searchParams) });
  if (url.startsWith(SB + '/auth/v1/user')) { const id = USERS[o.headers.Authorization.slice(7)]; return id ? res({ id }) : res({ msg: 'bad' }, 401); }
  if (u.pathname === '/rest/v1/staff') { const s = STAFF[eqv(u, 'user_id')]; return res(s ? [s] : []); }
  if (u.pathname === '/rest/v1/instagram_oauth') {
    if (m === 'POST') { T.oauth.push({ ...body, created_at: new Date().toISOString() }); return res(null, 201); }
    if (m === 'DELETE') {
      if (u.searchParams.get('created_at')) return res(null, 204);
      const st = eqv(u, 'state'), hit = T.oauth.filter((r) => r.state === st); T.oauth = T.oauth.filter((r) => r.state !== st); return res(hit);
    }
  }
  if (u.pathname === '/rest/v1/instagram_ucet') {
    if (m === 'GET') return res(T.ucet);
    if (m === 'POST') { T.ucet = [body]; return res(null, 201); }
    if (m === 'PATCH') { T.ucet = [{ ...T.ucet[0], ...body }]; return res(null, 204); }
    if (m === 'DELETE') { T.ucet = []; return res(null, 204); }
  }
  if (u.pathname === '/rest/v1/instagram_prispevky') { T.prispevky.push(body); return res(null, 201); }
  if (u.pathname === '/storage/v1/object/authenticated/marketing/katalog.json') return res(KATALOG);
  if (u.pathname === '/storage/v1/object/authenticated/marketing/stav.json') return T.stav ? res(T.stav) : res({ error: 'not found' }, 400);
  if (u.pathname === '/storage/v1/object/marketing/stav.json') { T.stav = body; return res({ Key: 'x' }); }
  if (u.pathname === '/storage/v1/object/sign/marketing') return res(body.paths.map((p) => ({ path: p, signedURL: FILES.has(p) ? `/object/sign/marketing/${p}?token=t` : null, error: FILES.has(p) ? null : 'missing' })));
  // Instagram
  if (url.startsWith('https://api.instagram.com/oauth/access_token')) {
    assert.equal(body.client_secret, 'tajne'); assert.equal(body.redirect_uri, `${SB}/functions/v1/instagram/zpet`);
    return body.code === 'dobry' ? res({ data: [{ access_token: 'short', user_id: '1784', permissions: 'instagram_business_basic,instagram_business_content_publish' }] }) : res({ error_type: 'OAuthException', code: 400, error_message: 'Invalid code' }, 400);
  }
  if (u.origin + u.pathname === 'https://graph.instagram.com/access_token') return res({ access_token: 'long', token_type: 'bearer', expires_in: 5184000 });
  if (u.origin + u.pathname === 'https://graph.instagram.com/refresh_access_token') return res({ access_token: 'long2', expires_in: 5184000 });
  if (u.pathname === '/v23.0/me') return res({ user_id: '17841400', username: 'ospalek.cz' });
  if (u.pathname === '/v23.0/17841400/media') { assert.equal(body.access_token, T.ucet[0].token); return res({ id: String(++seq) }); }
  if (u.pathname === '/v23.0/17841400/media_publish') return res({ id: '999' });
  if (u.pathname === '/v23.0/999') return res({ permalink: 'https://www.instagram.com/reel/ABC/', id: '999' });
  if (/^\/v23\.0\/\d+$/.test(u.pathname)) return res({ status_code: polls++ === 0 ? 'IN_PROGRESS' : 'FINISHED', id: u.pathname.split('/').pop() });
  throw new Error('Nečekaný požadavek ' + m + ' ' + url);
};

const req = (path, body, who = jwt('jan'), method = 'POST') => new Request(`${SB}/functions/v1/instagram/${path}`, {
  method, headers: { authorization: 'Bearer ' + who, apikey: 'anon', 'content-type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body || {}) : undefined,
});
const call = (path, body, who) => handle(req(path, body, who), path);
const lastMedia = () => calls.filter((c) => c.url.endsWith('/17841400/media'));

// 1) cizí lidé: bez přihlášení, bez kódu (aal1), role Podpora
await assert.rejects(call('stav', {}, 'nic'), (e) => e.status === 401);
await assert.rejects(call('stav', {}, jwt('jan', 'aal1')), (e) => e.status === 403 && /Google Authenticator/.test(e.message));
await assert.rejects(call('stav', {}, jwt('podpora')), (e) => e.status === 403);

// 2) stav před propojením, zveřejnění bez propojení
assert.deepEqual(await call('stav'), { nastaveno: true, presmerovani: `${SB}/functions/v1/instagram/zpet`, propojeno: false, vyprsel: false, username: '', expires_at: null });
await assert.rejects(call('zverejnit', { id: 'reel-jmeno', popisek: 'Ahoj' }), (e) => e.status === 409);

// 3) propojení: odkaz s náhodným state, návrat jen na administraci
const p = await call('propojit', { navrat: 'http://localhost:5174/admin/' });
const au = new URL(p.url);
assert.equal(au.origin + au.pathname, 'https://www.instagram.com/oauth/authorize');
assert.equal(au.searchParams.get('client_id'), '123');
assert.equal(au.searchParams.get('scope'), 'instagram_business_basic,instagram_business_content_publish');
const state = au.searchParams.get('state');
assert.match(state, /^[0-9a-f]{48}$/);
assert.equal(T.oauth[0].navrat, 'http://localhost:5174/admin/');
await call('propojit', { navrat: 'https://zly-web.cz/admin/' });
assert.equal(T.oauth[1].navrat, 'https://ospalek.cz/admin/');
T.oauth.pop();

// 4) návrat z Instagramu: neznámý state, špatný kód, pak správně
const zpet = (q) => handle(new Request(`${SB}/functions/v1/instagram/zpet?${new URLSearchParams(q)}`), 'zpet');
let r = await zpet({ code: 'dobry', state: 'cizi' });
assert.equal(r.status, 302); assert.match(r.headers.get('Location'), /^https:\/\/ospalek\.cz\/admin\/\?ig=chyba/);
r = await zpet({ code: 'spatny', state });
assert.match(r.headers.get('Location'), /^http:\/\/localhost:5174\/admin\/\?ig=chyba&zprava=Instagram%3A\+Invalid\+code#socialni$/);
assert.equal(T.ucet.length, 0);
r = await zpet({ code: 'dobry', state }); // state už je spotřebovaný
assert.match(r.headers.get('Location'), /ig=chyba/);
const p2 = new URL((await call('propojit', { navrat: 'http://localhost:5174/admin/' })).url).searchParams.get('state');
r = await zpet({ code: 'dobry#_', state: p2 });
assert.equal(r.headers.get('Location'), 'http://localhost:5174/admin/?ig=ok#socialni');
assert.equal(T.ucet[0].ig_user_id, '17841400'); assert.equal(T.ucet[0].token, 'long'); assert.equal(T.ucet[0].propojil, 'jan');
assert.ok(Date.parse(T.ucet[0].expires_at) - Date.now() > 59 * 864e5);
const s = await call('stav');
assert.equal(s.propojeno, true); assert.equal(s.username, 'ospalek.cz');
assert.equal(JSON.stringify(s).includes('long'), false); // token se do administrace nedostane

// 5) kontrola popisku
await assert.rejects(call('zverejnit', { id: 'reel-jmeno', popisek: 'x'.repeat(2201) }), /2200/);
await assert.rejects(call('zverejnit', { id: 'reel-jmeno', popisek: Array.from({ length: 31 }, (_, i) => '#t' + i).join(' ') }), /31 hashtagů/);
await assert.rejects(call('zverejnit', { id: 'reel-jmeno', popisek: 'Výherce: [JMÉNO VÝHERCE]' }), /zástupné/);
await assert.rejects(call('zverejnit', { id: 'profil-x', popisek: 'a' }), /nezveřejňuje/);
await assert.rejects(call('zverejnit', { id: 'neni', popisek: 'a' }), (e) => e.status === 404);

// 6) reel: kontejner REELS s podepsanými odkazy, pak čekání a zveřejnění, označení jako použité
const k = await call('zverejnit', { id: 'reel-jmeno', popisek: 'Ahoj #ospalek' });
assert.equal(k.typ, 'REELS');
const rb = lastMedia().at(-1).body;
assert.equal(rb.media_type, 'REELS'); assert.equal(rb.share_to_feed, 'true'); assert.equal(rb.caption, 'Ahoj #ospalek');
assert.equal(rb.video_url, `${SB}/storage/v1/object/sign/marketing/reels/01-jmeno/reel.mp4?token=t`);
assert.equal(rb.cover_url, `${SB}/storage/v1/object/sign/marketing/reels/01-jmeno/obalka.jpg?token=t`);
assert.deepEqual(await call('dokoncit', { kontejner: k.kontejner, id: 'reel-jmeno' }), { ceka: true });
const d = await call('dokoncit', { kontejner: k.kontejner, id: 'reel-jmeno', typ: 'REELS', popisek: 'Ahoj #ospalek' });
assert.equal(d.hotovo, true); assert.equal(d.permalink, 'https://www.instagram.com/reel/ABC/');
assert.equal(T.stav.used['reel-jmeno'].by, 'Jan'); assert.equal(T.stav.used['reel-jmeno'].ig, 'https://www.instagram.com/reel/ABC/');
assert.equal(T.prispevky[0].polozka, 'reel-jmeno'); assert.equal(T.prispevky[0].media_id, '999');
await assert.rejects(call('dokoncit', { kontejner: '../me', id: 'x' }), /Chybí/);

// 7) karusel: tři položky is_carousel_item a rodič CAROUSEL s jejich id
const before = lastMedia().length;
const kc = await call('zverejnit', { id: 'ig-pred-a-po', popisek: 'Před a po' });
const cm = lastMedia().slice(before);
assert.equal(cm.length, 4);
assert.ok(cm.slice(0, 3).every((c) => c.body.is_carousel_item === 'true' && c.body.image_url.endsWith('.jpg?token=t') && !c.body.caption));
assert.equal(cm[3].body.media_type, 'CAROUSEL'); assert.equal(cm[3].body.children.split(',').length, 3); assert.equal(cm[3].body.caption, 'Před a po');
assert.equal(kc.typ, 'CAROUSEL');

// 8) obrázek
const ki = await call('zverejnit', { id: 'ig-ahoj', popisek: 'Ahoj' });
assert.equal(ki.typ, 'IMAGE'); assert.equal(lastMedia().at(-1).body.image_url, `${SB}/storage/v1/object/sign/marketing/a/s1.jpg?token=t`);

// 9) chybějící soubor v úložišti
FILES.delete('a/s1.jpg');
await assert.rejects(call('zverejnit', { id: 'ig-ahoj', popisek: 'Ahoj' }), /chybí a\/s1\.jpg/);

// 10) obnova tokenu, když zbývá méně než 20 dní, a vypršelý token
T.ucet[0] = { ...T.ucet[0], expires_at: new Date(Date.now() + 10 * 864e5).toISOString(), token_at: new Date(Date.now() - 50 * 864e5).toISOString() };
await call('stav');
assert.equal(T.ucet[0].token, 'long2'); assert.ok(Date.parse(T.ucet[0].expires_at) - Date.now() > 59 * 864e5);
T.ucet[0].expires_at = new Date(Date.now() - 1000).toISOString();
assert.equal((await call('stav')).vyprsel, true);
await assert.rejects(call('zverejnit', { id: 'reel-jmeno', popisek: 'a' }), /vypršelo/);

// 11) odpojení
await call('odpojit');
assert.equal((await call('stav')).propojeno, false);

console.log('instagram: všechny testy prošly');
