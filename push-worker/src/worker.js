// Ospalek – večerní upozornění „Je čas na pohádku“ (Cloudflare Worker).
//
// Cron každou celou hodinu zavolá v databázi push_start. Ta vrátí práci jen tehdy, když jsou upozornění zapnutá,
// v Praze je nastavená hodina (výchozí 19:00, s hodinovou rezervou) a dnes se ještě neposílalo. Odběry se pak
// rozešlou po dávkách: každou dávku zpracuje samostatné volání tohoto Workeru (vazba SELF), protože jedno volání
// smí na tarifu Free udělat jen 50 požadavků ven. Výsledek každé dávky zapíše push_report (zaniklé odběry smaže).
//
// Zpráva obsahuje nadpis, text se zástupným {pohadka} a id pohádky dne. Název pohádky se jménem dítěte doplní
// až telefon (app/sw.js), server jména dětí nezná.
//
// POST /test (administrace): zkušební upozornění na zařízení přihlášeného člena týmu (role Vlastník nebo Obsah).
//
// Nastavení (wrangler.toml → [vars], tajné hodnoty přes `npx wrangler secret put …`):
//   VAPID_PUBLIC_KEY      veřejný klíč (stejný jako pushKey v config.js), vyrobí ho push-worker/klice.mjs
//   VAPID_PRIVATE_KEY     tajné: soukromý klíč VAPID (klice.mjs ho uloží rovnou do Workeru)
//   SUPABASE_SECRET       tajné: tajný klíč Supabase (sb_secret_…), smí volat jen funkce push_*
//   SUPABASE_URL, SUPABASE_KEY  databáze a veřejný klíč (ověření člena týmu u /test)
//   ALLOWED_ORIGINS       odkud smí volat administrace (/test)
//   BATCH_SIZE            odběrů v jedné dávce (Free: 40, Paid: až 400)

import { sendPush } from './webpush.js';

const TOPIC = 'pohadka-dne'; // nedoručené upozornění z minulého dne nahradí nové

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const allowed = list(env.ALLOWED_ORIGINS);
    const cors = allowed.includes(origin)
      ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }
      : { Vary: 'Origin' };
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: allowed.includes(origin) ? 204 : 403, headers: cors });
    if (request.method === 'GET' && url.pathname === '/') {
      return json({ ok: true, vapid: !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY), db: !!(env.SUPABASE_URL && env.SUPABASE_SECRET) }, 200, cors);
    }
    if (request.method === 'POST' && url.pathname === '/test') return test(request, env, cors);
    // jedna dávka denního rozeslání; volá ji jen tenhle Worker sám sobě (hlavička s otiskem tajného klíče)
    if (request.method === 'POST' && url.pathname === '/batch') {
      if (request.headers.get('x-push-internal') !== await internalToken(env)) return json({ error: 'Zakázáno.' }, 403);
      const b = await request.json();
      return json(await sendBatch(env, b.run, b.page, b.size, b.msg));
    }
    return json({ error: 'Nenalezeno.' }, 404, cors);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(daily(env).then((r) => console.log('upozornění', JSON.stringify(r))));
  },
};

// ---------- Denní rozeslání ----------
export async function daily(env, at) {
  if (!ready(env)) return { error: 'Worker nemá klíče VAPID nebo databázi.' };
  const run = await svc(env, 'push_start', at ? { t: at } : {});
  if (!run) return { skipped: true };
  const size = Math.max(1, Math.min(500, Number(env.BATCH_SIZE) || 40));
  const pages = Math.ceil(run.targets / size);
  const msg = { kind: 'daily', title: run.title, body: run.body, story: run.story, day: run.day };
  const token = await internalToken(env);
  const results = [];
  // nejvýš 6 dávek současně (víc otevřených spojení Worker stejně nepustí)
  for (let p = 0; p < pages; p += 6) {
    results.push(...await Promise.all(Array.from({ length: Math.min(6, pages - p) }, (_, i) => {
      const body = { run: run.run, page: p + i, size, msg };
      if (!env.SELF) return sendBatch(env, body.run, body.page, body.size, body.msg); // lokálně bez vazby SELF
      return env.SELF.fetch('https://push.internal/batch', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-push-internal': token }, body: JSON.stringify(body) })
        .then((r) => r.json()).catch((e) => ({ error: e.message }));
    })));
  }
  const sum = (k) => results.reduce((a, r) => a + (r[k] || 0), 0);
  return { run: run.run, story: run.story, targets: run.targets, ok: sum('ok'), fail: sum('fail'), gone: sum('gone'), errors: results.filter((r) => r.error).length };
}

async function sendBatch(env, run, page, size, msg) {
  const subs = (await svc(env, 'push_batch', { page, size })) || [];
  return deliver(env, run, subs, msg);
}

async function deliver(env, run, subs, msg) {
  const vapid = { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT };
  const res = await Promise.all(subs.map((s) => sendPush(s, msg, vapid, { topic: TOPIC })));
  const ids = (k) => subs.filter((_, i) => res[i] === k).map((s) => s.id);
  const out = { ok_ids: ids('ok'), fail_ids: ids('fail'), gone_ids: ids('gone') };
  await svc(env, 'push_report', { run, ...out });
  return { ok: out.ok_ids.length, fail: out.fail_ids.length, gone: out.gone_ids.length };
}

// ---------- Zkušební upozornění z administrace ----------
async function test(request, env, cors) {
  if (!ready(env)) return json({ error: 'Worker ještě nemá klíče VAPID nebo tajný klíč Supabase. Návod: push-worker/README.md.' }, 500, cors);
  // databáze vrátí odběry jen členovi týmu s rolí Vlastník nebo Obsah, přihlášenému i kódem (aal2)
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/admin_push_test`, {
    method: 'POST', headers: { apikey: env.SUPABASE_KEY, Authorization: request.headers.get('Authorization') || '', 'Content-Type': 'application/json' }, body: '{}',
  });
  if (!r.ok) return json({ error: r.status === 401 || r.status === 403 ? 'Zkoušku smí poslat jen přihlášený člen týmu s rolí Vlastník nebo Obsah.' : 'Databáze odpověděla chybou ' + r.status }, 403, cors);
  const t = await r.json();
  if (!t.subs.length) return json({ error: 'Tenhle účet nemá žádné zařízení s povolenými upozorněními.', targets: 0 }, 409, cors);
  const out = await deliver(env, t.run, t.subs, { kind: 'test', title: t.title, body: t.body, story: t.story });
  return json({ targets: t.subs.length, ...out }, 200, cors);
}

// ---------- Pomocné ----------
const ready = (env) => !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.SUPABASE_URL && env.SUPABASE_SECRET);
const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const json = (o, status = 200, headers = {}) => new Response(JSON.stringify(o), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });

// funkce push_* v databázi smí volat jen tajný klíč (role service_role)
async function svc(env, fn, args) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: env.SUPABASE_SECRET, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  if (r.status === 204) return null;
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${await r.text()}`);
  return r.json();
}

async function internalToken(env) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('ospalek-push:' + (env.SUPABASE_SECRET || '')));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
