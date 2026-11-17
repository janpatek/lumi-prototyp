// Test bezpečnostních oprav (migrations/20261117_zabezpeceni.sql) nad skutečným schema.sql v PGlite:
//   cd supabase && node test-zabezpeceni.mjs
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, password text, last_sign_in_at timestamptz, is_anonymous boolean default false);
  create table auth.mfa_factors (id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade, factor_type text, status text, friendly_name text, secret text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant usage on schema public to authenticated, anon, service_role;
`);
const sql = (f) => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
await db.exec(sql('./schema.sql'));
// migrace musí jít spustit nad hotovou databází, i opakovaně
await db.exec(sql('./migrations/20261117_zabezpeceni.sql'));
await db.exec(sql('./migrations/20261117_zabezpeceni.sql'));

const user = async (email = null, confirmed = true) => { const id = crypto.randomUUID(); await db.query('insert into auth.users (id, email, email_confirmed_at, is_anonymous) values ($1, $2, $3, $4)', [id, email, email && confirmed ? new Date() : null, !email]); return id; };
async function as(uid, q, params = [], role = 'authenticated', aal = 'aal1') {
  await db.exec(`set role ${role}`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`, [uid || '', JSON.stringify({ sub: uid, aal })]);
  try { return (await db.query(q, params)).rows; } finally { await db.exec('reset role'); }
}
const fails = async (p, re) => { let e = null; try { await p; } catch (x) { e = x; } assert.ok(e, 'mělo selhat'); if (re) assert.match(e.message, re); };
const sync = (uid, p) => as(uid, 'select app_sync_family($1)', [p]);
const fam = async (uid) => (await db.query('select * from families where id = $1', [uid])).rows[0];
let n = 0; const ok = (t) => console.log(`  ✓ ${++n}. ${t}`);

// ---------- nastavení rodiny: jen známé klíče a typy ----------
const a = await user();
const X = '<img src=x onerror=window.__xss=1>';
await sync(a, { provider: 'device', town: 'Bene<b>šov', platform: X, app_version: '<i>x', source: 'insta<script>', onboarded: true, analytics: true,
  children: Array.from({ length: 9 }, (_, i) => ({ id: 'k' + i, name: 'Dítě' + i, gender: 'm', age: 5 })),
  settings: { theme: X, notify: '<img>', relatives: X, places: '<svg onload=1>', heroes: X, changesMonth: X, favs: '<b>x', heard: '<b>x', code: 'ano', zlo: X, nested: { a: X } } });
let f = await fam(a);
assert.deepEqual(f.settings, {});
assert.equal(f.platform, null); assert.equal(f.app_version, null);
assert.equal(f.town, 'Benebšov'); assert.equal(f.source, 'instascript');
assert.equal((await db.query('select count(*)::int n from children where family_id = $1', [a])).rows[0].n, 6);
ok('škodlivé nastavení, platforma a verze se zahodí, obec bez značek, nejvýš 6 dětí');
await sync(a, { provider: 'device', town: 'Benešov', platform: 'Android', app_version: 'android-64', onboarded: true, premium: true, analytics: false,
  children: [{ id: 'k0', name: 'Toník', gender: 'm', age: 5 }],
  settings: { theme: 'dark', notify: 'on', relatives: 2, places: 3, heroes: 1, favs: 4, heard: 12, changesMonth: 1, code: true } });
f = await fam(a);
assert.deepEqual(f.settings, { theme: 'dark', notify: 'on', relatives: 2, places: 3, heroes: 1, favs: 4, heard: 12, changesMonth: 1, code: true });
assert.equal(f.platform, 'Android'); assert.equal(f.app_version, 'android-64'); assert.equal(f.town, 'Benešov');
ok('skutečné nastavení z aplikace projde beze změny');
await sync(a, { provider: 'device', town: 'Benešov', platform: 'Web', app_version: 'web-?', onboarded: true, children: [{ id: 'k0', name: 'Toník', gender: 'm', age: 5 }] });
assert.equal((await fam(a)).settings.theme, 'dark'); assert.equal((await fam(a)).app_version, 'web-?');
ok('starší aplikace bez nastavení ho nesmaže');

// ---------- hlas: povolení a limity ----------
const allow = async (uid, chars = 100) => (await as(uid, 'select app_tts_allow($1) r', [chars]))[0].r;
const fresh = await user();   // účet, který ještě rodinu neuložil (první pohádka hned po nastavení)
assert.deepEqual(await allow(fresh), { ok: true });
assert.equal((await fam(fresh)).onboarded, false);
await as(fresh, 'select app_tts_usage(120)');
assert.equal((await db.query('select tts_chars from family_usage where family_id = $1', [fresh])).rows[0].tts_chars, 120);
await sync(fresh, { provider: 'device', onboarded: true, children: [{ id: 'k', name: 'Ema', gender: 'f', age: 4 }] });
assert.equal((await fam(fresh)).onboarded, true);
assert.deepEqual(await allow(a), { ok: true });
assert.deepEqual((await as(null, 'select app_tts_allow(10) r', [], 'authenticated'))[0].r, { ok: false, error: 'auth' });
await fails(as(null, 'select app_tts_allow(10)', [], 'anon'), /permission denied/);
await db.query('delete from family_usage where family_id = $1', [fresh]);
const seq0 = (await fam(fresh)).seq;
for (let i = 0; i < 20; i++) await allow(fresh);
const next = await user(); await allow(next);
assert.equal(Number((await fam(next)).seq), Number(seq0) + 1);   // kontrola limitu nespotřebovává čísla rodin
await db.query('delete from families where id = $1', [next]);
ok('hlas: přihlášený účet smí (i těsně před uložením rodiny a věty se mu počítají), nepřihlášený ne');
await db.query('update tts_limits set family_day = 1000, family_month = 5000, global_day = 3000');
for (let i = 0; i < 9; i++) await as(a, 'select app_tts_usage(100)');
assert.deepEqual(await allow(a, 100), { ok: true });
await as(a, 'select app_tts_usage(100)');
assert.deepEqual(await allow(a, 100), { ok: false, error: 'family' });
const b = await user(); await sync(b, { provider: 'device', children: [{ id: 'k', name: 'Ema', gender: 'f', age: 4 }] });
for (let i = 0; i < 10; i++) await as(b, 'select app_tts_usage(100)');
const c = await user(); await sync(c, { provider: 'device', children: [{ id: 'k', name: 'Jan', gender: 'm', age: 4 }] });
for (let i = 0; i < 10; i++) await as(c, 'select app_tts_usage(100)');
const d = await user(); await sync(d, { provider: 'device', children: [{ id: 'k', name: 'Ola', gender: 'f', age: 4 }] });
assert.deepEqual(await allow(d, 100), { ok: false, error: 'global' });
await db.query(`update family_usage set day = day - 3 where family_id = $1`, [a]);
await db.query('update tts_limits set family_day = 1000, family_month = 1000, global_day = 999999');
assert.deepEqual(await allow(a, 100), { ok: false, error: 'month' });
await db.query('update tts_limits set family_day = 70000, family_month = 160000, global_day = 600000');
assert.deepEqual(await allow(a, 400), { ok: true });
ok('hlas: denní limit rodiny, měsíční limit i celkový denní strop');

// ---------- pozvánky do týmu ----------
await db.query(`insert into staff_invites (email, name, role) values ('kolega@ospalek.cz', 'Kolega', 'owner')`);
const evil = await user('kolega@ospalek.cz', false);
assert.equal((await db.query('select count(*)::int n from staff where user_id = $1', [evil])).rows[0].n, 0);
assert.equal((await db.query('select count(*)::int n from staff_invites')).rows[0].n, 1);
ok('pozvánka: účet s nepotvrzeným e-mailem roli nedostane a pozvánka zůstane');
await db.query('update auth.users set email_confirmed_at = now() where id = $1', [evil]);
assert.equal((await db.query('select role from staff where user_id = $1', [evil])).rows[0].role, 'owner');
ok('pozvánka: po potvrzení e-mailu se role přidělí');
await db.query(`insert into staff_invites (email, name, role) values ('hned@ospalek.cz', 'Hned', 'support')`);
const hned = await user('hned@ospalek.cz', true);
assert.equal((await db.query('select role from staff where user_id = $1', [hned])).rows[0].role, 'support');
ok('pozvánka: účet založený rovnou s potvrzeným e-mailem (administrace) funguje jako dřív');

// ---------- administrace: osobní údaje podle role, audit ----------
const owner = evil;
const content = await user('obsah@ospalek.cz'); await db.query(`insert into staff (user_id, name, role) values ($1, 'Obsah', 'content')`, [content]);
const mailFam = await user('rodic@example.org'); await sync(mailFam, { provider: 'google', children: [{ id: 'k', name: 'Eliška', gender: 'f', age: 3 }] });
const row = async (who) => (await as(who, 'select * from admin_families()', [], 'authenticated', 'aal2')).find((r) => r.id === mailFam);
let r = await row(owner);
assert.equal(r.email, 'rodic@example.org'); assert.equal(r.kids[0].name, 'Eliška');
r = await row(content);
assert.equal(r.email, 'r•••@example.org'); assert.equal(r.kids[0].name, ''); assert.equal(r.kids[0].g, 'f'); assert.equal(r.kids[0].age, 3);
await fails(as(content, 'select * from admin_families()', [], 'authenticated', 'aal1'), /mfa required/);
ok('admin_families: vlastník vidí jména a e-mail, role Obsah jen zakryté; bez druhého faktoru nic');
await as(owner, `select admin_log('coupon.create', 'c1', 'ok')`, [], 'authenticated', 'aal2');
await fails(as(owner, `select admin_log($1, 'c1', 'x')`, [X], 'authenticated', 'aal2'), /Neznámá akce/);
ok('admin_log: jen akce ve tvaru oblast.akce');

// ---------- nákupy ----------
const rec = (o) => db.query('select store_record($1) r', [o]).then((x) => x.rows[0].r);
const day = 864e5, iso = (ms) => new Date(ms).toISOString();
const sub = (status, exp, extra = {}) => ({ id: 'ios:1000', platform: 'ios', product: 'ospalek_plus_mesicne', status, trial: false, started_at: iso(Date.now() - 5 * day), expires_at: iso(exp), env: 'Production', ...extra });
const exp = Date.now() + 25 * day;
let o = await rec({ source: 'app', family: a, sub: sub('active', exp), events: [] });
assert.equal(o.active, true); assert.equal((await fam(a)).premium, true);
await rec({ sub: sub('refunded', exp), events: [] });   // oznámení obchodu o vrácení peněz
assert.equal((await fam(a)).premium, false);
o = await rec({ source: 'app', family: a, sub: sub('active', exp), events: [] });   // starý doklad znovu
assert.equal(o.active, false); assert.equal(o.status, 'refunded'); assert.equal((await fam(a)).premium, false);
ok('nákup: starý doklad po vrácení peněz předplatné neobnoví');
o = await rec({ source: 'app', family: a, sub: sub('active', exp + 30 * day), events: [] });   // skutečně nový nákup
assert.equal(o.active, true); assert.equal((await fam(a)).premium, true);
ok('nákup: nové předplatné po vrácení peněz funguje');
o = await rec({ source: 'app', family: a, sub: sub('expired', exp - 60 * day), events: [] });   // prastarý doklad
assert.equal(o.active, true);
assert.equal((await db.query(`select status from store_subs where id = 'ios:1000'`)).rows[0].status, 'active');
// oznámení obchodu platí vždy: vrácení peněz a jeho odvolání (REFUND_REVERSED) se stejným koncem období
await rec({ sub: sub('refunded', exp + 30 * day), events: [] });
o = await rec({ sub: sub('active', exp + 30 * day), events: [] });
assert.equal(o.active, true);
ok('nákup: starší doklad z telefonu nepřepíše novější stav');
o = await rec({ source: 'app', family: b, sub: sub('active', exp + 30 * day), events: [] });   // stejný nákup, jiná rodina (nový telefon)
assert.equal(o.active, true); assert.equal((await fam(b)).premium, true); assert.equal((await fam(a)).premium, false);
ok('nákup: po převodu na jinou rodinu ho ta původní už nemá');
o = await rec({ family: 'neni-uuid', sub: { ...sub('active', exp), id: 'android:tok', platform: 'android' }, events: [] });
assert.equal(o.active, true);
ok('nákup: ID rodiny, které není UUID, zpracování neshodí');
const touch = () => as(null, 'select store_touch($1) r', [a], 'service_role').then((x) => x[0].r);
for (let i = 0; i < 60; i++) assert.equal(await touch(), true);
assert.equal(await touch(), false);
await fails(as(a, 'select store_touch($1)', [a]), /permission denied/);
ok('nákup: limit 60 ověření za hodinu na účet, klient funkci nezavolá');

// ---------- kód přístupu a sloučení účtů ----------
await db.query(`insert into access_codes (code_hash, label, days, max_uses) values (encode(sha256(convert_to('DAREK-1', 'UTF8')), 'hex'), 'Dárek', 30, 1)`);
const g1 = await user('prvni@example.org'); await sync(g1, { provider: 'google', children: [{ id: 'k', name: 'Ada', gender: 'f', age: 4 }] });
assert.equal((await as(g1, `select app_redeem_code('darek-1') r`))[0].r.ok, true);
const targets = [];
for (let i = 0; i < 2; i++) {
  const t = await user(`dalsi${i}@example.org`); await sync(t, { provider: 'google', children: [] });
  const ticket = (await as(g1, 'select app_merge_ticket() t'))[0].t;
  await as(t, 'select app_merge_from($1)', [ticket]);
  targets.push(t);
}
const holders = (await db.query(`select count(distinct user_id)::int n from access_grants g join access_codes c on c.id = g.code_id where c.label = 'Dárek'`)).rows[0].n;
assert.equal(holders, 1);
ok('sloučení účtů: kód na jedno použití zůstane jen jednomu účtu');

// ---------- práva ----------
const can = async (role, sig) => (await db.query('select has_function_privilege($1, $2, $3) x', [role, sig, 'execute'])).rows[0].x;
for (const sig of ['public.app_merge_ticket()', 'public.app_merge_from(uuid)', 'public.admin_story_ratings()', 'public.app_tts_allow(int)', 'public.admin_families()']) {
  assert.equal(await can('anon', sig), false, sig); assert.equal(await can('authenticated', sig), true, sig);
}
for (const sig of ['public.store_touch(uuid)', 'public.store_record(jsonb)', 'public.clean_settings(jsonb)']) assert.equal(await can('authenticated', sig), false, sig);
const open = (await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') order by 1`)).rows.map((x) => x.proname);
assert.deepEqual(open, ['app_catalog']);
const norls = (await db.query(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`)).rows;
assert.deepEqual(norls, []);
ok('práva: nepřihlášený klíč smí jen katalog, všechny tabulky mají ochranu řádků');

console.log(`\nVšech ${n} testů prošlo.`);
