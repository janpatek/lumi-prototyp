// Lokální napodobenina Supabase pro vývoj a testy, bez účtu a bez internetu.
// Pod ní běží skutečné supabase/schema.sql v PGlite (Postgres ve WebAssembly), data jsou jen v paměti.
// Umí jen to, co používá Ospalek: anonymní přihlášení, přihlášení heslem, obnovení tokenu a volání funkcí (rpc).
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

const tokens = new Map(); // access token -> { uid, exp }
function session(uid, email) {
  const access = 't_' + crypto.randomBytes(16).toString('hex'), exp = Math.floor(Date.now() / 1000) + 3600;
  tokens.set(access, { uid, exp });
  return { access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'r_' + uid, user: { id: uid, email } };
}
// jeden dotaz najednou, ať se nepletou nastavení role mezi požadavky
let chain = Promise.resolve();
const serial = (fn) => (chain = chain.then(fn, fn));
async function asUser(uid, sql, params) {
  return serial(async () => {
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
    await db.exec('set role authenticated');
    try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
  });
}

const send = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey, authorization, content-type, prefer', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' });
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
      if (grant === 'refresh_token' && /^r_/.test(body.refresh_token || '')) {
        const uid = body.refresh_token.slice(2);
        const u = (await serial(() => db.query(`select id, email from auth.users where id = $1`, [uid]))).rows[0];
        if (!u) return send(res, 400, { error: 'invalid_grant' });
        return send(res, 200, session(u.id, u.email));
      }
      return send(res, 400, { error: 'unsupported_grant_type' });
    }
    const m = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
    if (req.method === 'POST' && m) {
      const t = tokens.get((req.headers.authorization || '').replace(/^Bearer /, ''));
      if (!t || t.exp < Date.now() / 1000) return send(res, 401, { message: 'JWT expired' });
      const f = fns.get(m[1]);
      if (!f) return send(res, 404, { message: 'function not found' });
      const body = await read(req);
      const names = f.argnames.filter((n) => n in body);
      const sql = `select * from public.${f.name}(${names.map((n, i) => `${n} => $${i + 1}::${f.argtypes[f.argnames.indexOf(n)]}`).join(', ')})`;
      const params = names.map((n) => (typeof body[n] === 'object' ? JSON.stringify(body[n]) : body[n]));
      const r = await asUser(t.uid, sql, params);
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
