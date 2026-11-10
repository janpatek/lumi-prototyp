// Lokální napodobenina Supabase pro vývoj a testy, bez účtu a bez internetu.
// Pod ní běží skutečné supabase/schema.sql v PGlite (Postgres ve WebAssembly), data jsou jen v paměti.
// Umí jen to, co používá Ospalek: anonymní přihlášení, přihlášení heslem, obnovení tokenu, obnovu hesla (odkaz se vypíše
// do konzole místo e-mailu), ověření kódem z Google Authenticatoru (TOTP, úroveň aal2) a volání funkcí (rpc).
//
//   cd supabase && npm install && node dev-server.mjs            # prázdná databáze
//   node dev-server.mjs --seed 60                                 # + 60 vymyšlených rodin s poslechy
//
// Aplikace: http://localhost:5174/app/?db=http://localhost:54321
// Administrace: http://localhost:5174/admin/?db=http://localhost:54321  (přihlášení admin@example.cz / ospalek-test)

import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const PORT = Number(process.env.PORT || 54321);
const STAFF = { email: 'admin@example.cz', password: 'ospalek-test', name: 'Jan (test)' };
const seedN = Number((process.argv.find((a, i) => process.argv[i - 1] === '--seed')) || 0);

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated;
  create schema auth;
  create table auth.users (id uuid primary key, email text, password text, last_sign_in_at timestamptz, is_anonymous boolean default false);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant usage on schema public to authenticated, anon;
`);
await db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
const staffId = crypto.randomUUID();
await db.query(`insert into auth.users (id, email, password) values ($1, $2, $3)`, [staffId, STAFF.email, STAFF.password]);
await db.query(`insert into public.staff (user_id, name, role) values ($1, $2, 'owner')`, [staffId, STAFF.name]);

// popis funkcí: názvy a typy argumentů, jestli vrací tabulku
const fns = new Map((await db.query(`
  select p.proname name, p.proretset set, p.prorettype::regtype::text ret,
    coalesce(p.proargnames, '{}') argnames, (select array_agg(t::regtype::text order by o) from unnest(p.proargtypes) with ordinality u(t, o)) argtypes
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'app\\_%' or p.proname like 'admin\\_%')`)).rows.map((r) => [r.name, r]));

const tokens = new Map(); // access token -> { uid, exp, aal }
const refreshes = new Map(); // refresh token -> { uid, aal }
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function session(uid, email, aal = 'aal1') {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  // tvar JWT, ať si administrace přečte úroveň ověření (aal) stejně jako u skutečné Supabase; podpis se nekontroluje
  const access = [b64u({ alg: 'none' }), b64u({ sub: uid, aal, exp }), crypto.randomBytes(8).toString('hex')].join('.');
  const refresh = 'r_' + crypto.randomBytes(12).toString('hex');
  tokens.set(access, { uid, exp, aal });
  refreshes.set(refresh, { uid, aal });
  return { access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: refresh, user: { id: uid, email } };
}
const tokenOf = (req) => { const t = tokens.get((req.headers.authorization || '').replace(/^Bearer /, '')); return t && t.exp >= Date.now() / 1000 ? t : null; };

// TOTP (RFC 6238) pro ověření kódem z Google Authenticatoru: SHA-1, 30 s, 6 číslic, klíč v base32
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const b32decode = (s) => { let bits = ''; for (const c of s.replace(/=+$/, '')) bits += B32.indexOf(c).toString(2).padStart(5, '0'); return Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2))); };
export function totp(secret, t = Date.now()) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(t / 30000)));
  const h = crypto.createHmac('sha1', b32decode(secret)).update(msg).digest(), o = h[19] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}
const factors = new Map(); // uid -> [{ id, factor_type, status, secret, friendly_name }]
const challenges = new Map(); // challenge id -> factor id
// jeden dotaz najednou, ať se nepletou nastavení role mezi požadavky
let chain = Promise.resolve();
const serial = (fn) => (chain = chain.then(fn, fn));
async function asUser(uid, sql, params, aal = 'aal1') {
  return serial(async () => {
    await db.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`, [uid, JSON.stringify({ sub: uid, aal })]);
    await db.exec('set role authenticated');
    try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
  });
}

const send = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey, authorization, content-type, prefer', 'Access-Control-Allow-Methods': 'POST, GET, PUT, DELETE, OPTIONS' });
  res.end(body === undefined ? '' : JSON.stringify(body));
};
const read = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { ok({}); } }); });

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204);
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'POST' && url.pathname === '/auth/v1/signup') {
      const uid = crypto.randomUUID();
      await serial(() => db.query(`insert into auth.users (id, is_anonymous) values ($1, true)`, [uid]));
      return send(res, 200, session(uid, null));
    }
    if (req.method === 'POST' && url.pathname === '/auth/v1/token') {
      const body = await read(req), grant = url.searchParams.get('grant_type');
      if (grant === 'password') {
        const u = (await serial(() => db.query(`select id, email from auth.users where email = $1 and password = $2`, [body.email, body.password]))).rows[0];
        if (!u) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
        await serial(() => db.query(`update auth.users set last_sign_in_at = now() where id = $1`, [u.id]));
        return send(res, 200, session(u.id, u.email));
      }
      if (grant === 'refresh_token' && refreshes.has(body.refresh_token)) {
        const r = refreshes.get(body.refresh_token); refreshes.delete(body.refresh_token);
        const u = (await serial(() => db.query(`select id, email from auth.users where id = $1`, [r.uid]))).rows[0];
        if (!u) return send(res, 400, { error: 'invalid_grant' });
        return send(res, 200, session(u.id, u.email, r.aal));
      }
      return send(res, 400, { error: 'unsupported_grant_type' });
    }
    // obnova hesla: místo e-mailu se odkaz vypíše do konzole
    if (req.method === 'POST' && url.pathname === '/auth/v1/recover') {
      const body = await read(req);
      const u = (await serial(() => db.query(`select id, email from auth.users where email = $1`, [body.email]))).rows[0];
      if (u) {
        const s = session(u.id, u.email), back = url.searchParams.get('redirect_to') || 'http://localhost:5174/admin/';
        console.log(`Obnova hesla pro ${u.email}: ${back}#access_token=${s.access_token}&refresh_token=${s.refresh_token}&expires_in=3600&token_type=bearer&type=recovery`);
      }
      return send(res, 200, {});
    }
    if (url.pathname.startsWith('/auth/v1/user') || url.pathname.startsWith('/auth/v1/factors')) {
      const t = tokenOf(req);
      if (!t) return send(res, 401, { msg: 'JWT expired' });
      const u = (await serial(() => db.query(`select id, email from auth.users where id = $1`, [t.uid]))).rows[0];
      const list = factors.get(t.uid) || []; factors.set(t.uid, list);
      const pub = (f) => ({ id: f.id, factor_type: f.factor_type, status: f.status, friendly_name: f.friendly_name });
      const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await read(req);
      if (url.pathname === '/auth/v1/user' && req.method === 'GET') return send(res, 200, { id: u.id, email: u.email, factors: list.map(pub) });
      if (url.pathname === '/auth/v1/user' && req.method === 'PUT') {
        if (body.password) {
          if ((await serial(() => db.query(`select 1 from auth.users where id = $1 and password = $2`, [t.uid, body.password]))).rows.length) return send(res, 422, { error_code: 'same_password', msg: 'New password should be different from the old password.' });
          await serial(() => db.query(`update auth.users set password = $2 where id = $1`, [t.uid, body.password]));
        }
        return send(res, 200, { id: u.id, email: u.email });
      }
      if (url.pathname === '/auth/v1/factors' && req.method === 'POST') {
        if (list.some((f) => f.friendly_name === body.friendly_name)) return send(res, 422, { error_code: 'mfa_factor_name_conflict', msg: 'A factor with the friendly name already exists' });
        const secret = Array.from(crypto.randomBytes(20), (b) => B32[b & 31]).join('');
        const f = { id: crypto.randomUUID(), factor_type: 'totp', status: 'unverified', secret, friendly_name: body.friendly_name };
        list.push(f);
        const uri = `otpauth://totp/${encodeURIComponent(body.issuer || 'test')}:${encodeURIComponent(u.email)}?secret=${secret}&issuer=${encodeURIComponent(body.issuer || 'test')}`;
        const qr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#eee"/><text x="50" y="54" font-size="10" text-anchor="middle">QR (test)</text></svg>`;
        console.log(`TOTP klíč pro ${u.email}: ${secret}`);
        return send(res, 200, { id: f.id, type: 'totp', totp: { qr_code: 'data:image/svg+xml;utf-8,' + qr, secret, uri } });
      }
      const fm = url.pathname.match(/^\/auth\/v1\/factors\/([\w-]+)(?:\/(challenge|verify))?$/);
      const f = fm && list.find((x) => x.id === fm[1]);
      if (!f) return send(res, 404, { msg: 'Factor not found' });
      if (req.method === 'DELETE') { list.splice(list.indexOf(f), 1); return send(res, 200, { id: f.id }); }
      if (fm[2] === 'challenge') { const id = crypto.randomUUID(); challenges.set(id, f.id); return send(res, 200, { id, type: 'totp', expires_at: Math.floor(Date.now() / 1000) + 300 }); }
      if (fm[2] === 'verify') {
        if (challenges.get(body.challenge_id) !== f.id) return send(res, 422, { error_code: 'mfa_challenge_expired', msg: 'Challenge not found' });
        challenges.delete(body.challenge_id);
        const now = Date.now();
        if (![now - 30000, now, now + 30000].some((at) => totp(f.secret, at) === String(body.code))) return send(res, 422, { error_code: 'mfa_verification_failed', msg: 'Invalid TOTP code entered' });
        f.status = 'verified';
        return send(res, 200, session(u.id, u.email, 'aal2'));
      }
      return send(res, 404, { msg: 'not found' });
    }
    const m = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
    if (req.method === 'POST' && m) {
      const t = tokenOf(req);
      if (!t) return send(res, 401, { message: 'JWT expired' });
      const f = fns.get(m[1]);
      if (!f) return send(res, 404, { message: 'function not found' });
      const body = await read(req);
      const names = f.argnames.filter((n) => n in body);
      const sql = `select * from public.${f.name}(${names.map((n, i) => `${n} => $${i + 1}::${f.argtypes[f.argnames.indexOf(n)]}`).join(', ')})`;
      const params = names.map((n) => (typeof body[n] === 'object' ? JSON.stringify(body[n]) : body[n]));
      const r = await asUser(t.uid, sql, params, t.aal);
      if (f.ret === 'void') return send(res, 204);
      if (!f.set && r.fields.length === 1) return send(res, 200, r.rows[0] ? Object.values(r.rows[0])[0] : null);
      return send(res, 200, r.rows);
    }
    send(res, 404, { message: 'not found' });
  } catch (e) {
    const code = /forbidden/.test(e.message) ? 403 : /not signed in/.test(e.message) ? 401 : 400;
    send(res, code, { message: e.message });
  }
}).listen(PORT, () => console.log(`Ospalek – testovací Supabase na http://localhost:${PORT}  (administrace: ${STAFF.email} / ${STAFF.password})`));

// Vymyšlené rodiny pro vyzkoušení grafů (jména jsou náhodné kombinace, e-maily na example.cz)
if (seedN) await serial(async () => {
  const KIDS = [['Toník', 'm'], ['Eliška', 'f'], ['Matyáš', 'm'], ['Anna', 'f'], ['Šimon', 'm'], ['Ema', 'f'], ['Kryštof', 'm'], ['Rozálie', 'f']];
  const TOWNS = [['Praha', 'CZ'], ['Brno', 'CZ'], ['Benešov', 'CZ'], ['Olomouc', 'CZ'], ['Bratislava', 'SK'], ['Žilina', 'SK']];
  const STORIES = [['hvezdicka', 'noc', 9], ['vyprava', 'dobro', 11], ['hadanky', 'auto', 7], ['drak', 'dobro', 12], ['lednice', 'zivot', 8], ['zubar', 'zivot', 10]];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const DAY = 864e5;
  for (let i = 0; i < seedN; i++) {
    const uid = crypto.randomUUID(), age = Math.floor(Math.random() ** 1.5 * 120), created = new Date(Date.now() - age * DAY - Math.random() * DAY);
    const [town, country] = pick(TOWNS), k = pick(KIDS), activity = Math.random(), consent = Math.random() < 0.7;
    await db.query(`insert into auth.users (id, is_anonymous) values ($1, true)`, [uid]);
    await db.query(`insert into families (id, created_at, last_seen_at, town, country, platform, app_version, source, onboarded, premium, analytics) values ($1, $2, now(), $3, $4, 'Web', 'web-9', $5, true, $6, $7)`,
      [uid, created, town, country, consent ? pick(['Přímý přístup', 'instagram.com', 'google.com', 'Doporučení']) : null, Math.random() < 0.15, consent]);
    await db.query(`insert into children (family_id, id, name, gender, age) values ($1, 'a', $2, $3, $4)`, [uid, k[0], k[1], 2 + Math.floor(Math.random() * 7)]);
    for (let d = age; d >= 0; d--) {
      if (Math.random() > activity * 0.7) continue;
      const [sid, cat, len] = pick(STORIES.slice(0, 3)), done = Math.random() < 0.8;
      const at = new Date(Date.now() - d * DAY); at.setHours(cat === 'noc' ? 19 + Math.floor(Math.random() * 3) : 9 + Math.floor(Math.random() * 9), Math.floor(Math.random() * 60));
      if (at > new Date()) continue;
      if (!consent) at.setMinutes(0, 0, 0); // bez souhlasu anonymně, čas na hodinu
      await db.query(`insert into plays (id, family_id, story_id, category, started_at, listened_sec, progress, completed) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [crypto.randomUUID(), consent ? uid : null, sid, cat, at, Math.round(len * 60 * (done ? 1 : Math.random())), done ? 1 : 0.5, done]);
    }
  }
  console.log(`Přidáno ${seedN} vymyšlených rodin.`);
});
