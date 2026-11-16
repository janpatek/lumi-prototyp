// Test kupónů nad skutečným schema.sql v PGlite (bez účtu a bez internetu):  cd supabase && node test-kupony.mjs
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key, email text, password text, last_sign_in_at timestamptz, is_anonymous boolean default false);
  create table auth.mfa_factors (id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade, factor_type text, status text, friendly_name text, secret text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant usage on schema public to authenticated, anon;
`);
await db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
// migrace musí jít spustit i nad databází, která už blok má (opakované spuštění)
await db.exec(fs.readFileSync(new URL('./migrations/20261116_kupony_bez_revenuecat.sql', import.meta.url), 'utf8'));
await db.query(`insert into access_codes (code_hash, label, days) values (encode(sha256(convert_to('RECENZE-TEST', 'UTF8')), 'hex'), 'Recenzenti', 30)`);

const user = async (email = null) => { const id = crypto.randomUUID(); await db.query('insert into auth.users (id, email, is_anonymous) values ($1, $2, $3)', [id, email, !email]); return id; };
async function as(uid, sql, params = [], role = 'authenticated', aal = 'aal1') {
  await db.exec(`set role ${role}`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`, [uid || '', JSON.stringify({ sub: uid, aal })]);
  try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role'); }
}
const redeem = async (uid, code) => (await as(uid, 'select public.app_redeem_code($1) r', [code]))[0].r;

const staff = await user('admin@example.cz');
await db.query(`insert into staff (user_id, name, role) values ($1, 'Test', 'owner')`, [staff]);
const content = await user('obsah@example.cz');
await db.query(`insert into staff (user_id, name, role) values ($1, 'Obsah', 'content')`, [content]);
const admin = (sql, params) => as(staff, sql, params, 'authenticated', 'aal2');

const day = 864e5;
await admin(`select admin_coupon_save($1, '[]')`, [{ id: 'c1', name: 'Podcast', purpose: 'partner', gives: 'trial', value: 30, mode: 'shared', code: 'maliavelci', newOnly: true, from: new Date(Date.now() - day), to: null, limit: 2 }]);
await admin(`select admin_coupon_save($1, $2)`, [{ id: 'c2', name: 'Známí', purpose: 'znami', gives: 'months', value: 2, mode: 'unique', prefix: 'ZNAMI', newOnly: false, from: new Date(Date.now() - day) }, [{ c: 'ZNAMI-AAAA-BBBB', note: 'sestra' }, { c: 'ZNAMI-CCCC-DDDD' }]]);
await admin(`select admin_coupon_save($1, '[]')`, [{ id: 'c3', name: 'Sleva', purpose: 'marketing', gives: 'percent', value: 20, dur: 'first', mode: 'shared', code: 'INSTA20', from: new Date(Date.now() - day) }]);
await admin(`select admin_coupon_save($1, '[]')`, [{ id: 'c4', name: 'Budoucí', purpose: 'marketing', gives: 'trial', value: 7, mode: 'shared', code: 'MIKULAS', from: new Date(Date.now() + 9 * day) }]);

// práva: rodina ani člen týmu bez kupónových práv administraci kupónů nevidí
const f1 = await user(), f2 = await user(), f3 = await user();
await assert.rejects(as(f1, 'select admin_coupons()'), /forbidden|permission/);
await assert.rejects(as(content, 'select admin_coupons()', [], 'authenticated', 'aal2'), /forbidden/);
await assert.rejects(as(staff, 'select admin_coupons()'), /mfa/);
await assert.rejects(as(f1, 'select * from coupons'), /permission/);
await assert.rejects(as(f1, 'select coupon_redeem($1, $2)', [f1, 'MALIAVELCI']), /permission/);
await assert.rejects(admin(`select admin_coupon_add_codes('c2', $1)`, [[{ c: 'MALIAVELCI' }]]), /koliduje/);

let r = await redeem(f1, ' maliavelci ');
assert.equal(r.ok, true, r.msg); assert.match(r.msg, /odemčené do/);
const until1 = new Date(r.until); assert.ok(Math.abs(until1 - Date.now() - 30 * day) < 60e3);
assert.equal(typeof r.until, 'number', 'until v ms jako u kódů přístupu');
r = await redeem(f1, 'MALIAVELCI'); assert.equal(r.ok, false); assert.equal(r.error, 'rule'); assert.match(r.msg, /už máte/);
// jen pro nové rodiny: rodina, která už kupón má, další „new only“ nedostane; jiné kupóny ano a sčítají se
r = await redeem(f1, 'ZNAMI-AAAA-BBBB'); assert.equal(r.ok, true, r.msg);
assert.ok(new Date(r.until) > new Date(until1.getTime() + 55 * day), 'měsíce se přičtou k běžícímu přístupu');
r = await redeem(f2, 'zn ami-aaaa-bbbb'); assert.equal(r.ok, false); assert.match(r.msg, /někdo použil/);
r = await redeem(f2, 'INSTA20'); assert.equal(r.ok, false); assert.match(r.msg, /slevový/);
r = await redeem(f2, 'MIKULAS'); assert.equal(r.ok, false); assert.match(r.msg, /neplatí/);
r = await redeem(f2, 'MALIAVELCI'); assert.equal(r.ok, true, r.msg);
r = await redeem(f3, 'MALIAVELCI'); assert.equal(r.ok, false); assert.match(r.msg, /vyčerpaný/);
// pozastavení
await admin(`select admin_coupon_pause('c2', true)`);
r = await redeem(f3, 'ZNAMI-CCCC-DDDD'); assert.equal(r.ok, false); assert.match(r.msg, /neplatí/);
await admin(`select admin_coupon_pause('c2', false)`);
r = await redeem(f3, 'ZNAMI-CCCC-DDDD'); assert.equal(r.ok, true, r.msg);
// hádání kódů: po 10 neznámých kódech za hodinu stop (společný limit pro kódy přístupu i kupóny)
const f4 = await user();
for (let i = 0; i < 10; i++) assert.equal((await redeem(f4, `XXXX-${i}000`)).error, 'invalid');
r = await redeem(f4, 'MALIAVELCI'); assert.equal(r.error, 'tries');

// kód pro recenzenty dál funguje a odemčení se sčítá s kupónem (bere se pozdější datum)
const f5 = await user();
r = await redeem(f5, 'recenze-test'); assert.equal(r.ok, true); assert.ok(Math.abs(r.until - Date.now() - 30 * day) < 60e3);
r = await redeem(f5, 'ZNAMI-CCCC-DDDD'); assert.equal(r.ok, false); // už použitý rodinou f3
// přístup pro aplikaci (při spuštění a po přihlášení na jiném telefonu)
assert.ok((await as(f1, 'select app_code_until() p'))[0].p > Date.now() + 80 * day);
assert.ok((await as(f5, 'select app_code_until() p'))[0].p > Date.now());
assert.equal((await as(f4, 'select app_code_until() p'))[0].p, null);

// administrace vidí kampaně, kódy a uplatnění; RevenueCat fronta
const all = (await admin('select admin_coupons() a'))[0].a;
assert.equal(all.campaigns.length, 4); assert.equal(all.codes.length, 2); assert.equal(all.redemptions.length, 4);
assert.equal(all.codes.find((x) => x.code === 'ZNAMI-AAAA-BBBB').used > 0, true);
assert.equal('rc' in all.redemptions[0], false);
// RevenueCat a původní samostatné uplatnění jsou pryč
assert.equal((await db.query(`select count(*)::int n from pg_proc where proname in ('coupon_rc_pending', 'coupon_rc_mark', 'app_redeem_coupon', 'app_promo')`)).rows[0].n, 0);

// sloučení účtů: kupón přejde z anonymního telefonu na hlavní účet
const main = await user('rodic@example.cz');
await db.query(`insert into families (id) values ($1)`, [main]);
const t = (await as(f3, 'select app_merge_ticket() t'))[0].t;
await as(main, 'select app_merge_from($1)', [t]);
assert.ok((await as(main, 'select app_code_until() p'))[0].p > Date.now() + 55 * day);
assert.equal((await db.query(`select count(*)::int n from coupon_redemptions where family_id = $1`, [main])).rows[0].n, 1);

// smazání rodiny: uplatnění zůstane bez vazby na rodinu (vyúčtování s partnery)
await as(f2, 'select app_delete_family()');
const left = (await admin('select admin_coupons() a'))[0].a.redemptions.filter((x) => x.coupon_id === 'c1');
assert.equal(left.length, 2); assert.equal(left.filter((x) => x.fseq === null).length, 1);

console.log('kupóny: všechny testy prošly');
