// Lokální zkouška upozornění bez Cloudflaru a bez skutečné push služby: node push-worker/dev.mjs
// Potřebuje běžící napodobeninu Supabase (node supabase/dev-server.mjs), od ní si vezme dočasné klíče VAPID.
//   http://localhost:8788/          stav Workeru
//   POST /test                      zkušební upozornění z administrace (admin/?db=http://localhost:54321&push=http://localhost:8788)
//   POST /__cron?t=2026-11-11T19:00:00%2B01:00   spustí denní rozeslání, jako by byl ten čas
//   /fake-push/<cokoli>             napodobená push služba: přijme zprávu (201) a uloží ji; /fake-push/gone… odpoví 410
//   GET /__inbox                    co napodobená push služba přijala (zašifrované, base64url)
import http from 'node:http';
import worker, { daily } from './src/worker.js';

const PORT = Number(process.env.PORT || 8788);
const DB = process.env.DB || 'http://localhost:54321';
const keys = await fetch(DB + '/dev/push-key').then((r) => r.json()).catch(() => null);
if (!keys) { console.error(`Nejdřív spusť napodobeninu Supabase (${DB}).`); process.exit(1); }
const env = {
  SUPABASE_URL: DB, SUPABASE_KEY: 'dev', SUPABASE_SECRET: 'dev-secret',
  VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'mailto:podpora@ospalek.cz',
  ALLOWED_ORIGINS: 'http://localhost:5174', BATCH_SIZE: '2',
};
const inbox = [];
const read = (req) => new Promise((ok) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const body = await read(req);
  if (url.pathname.startsWith('/fake-push/')) {
    inbox.push({ at: new Date().toISOString(), endpoint: url.href, headers: { ttl: req.headers.ttl, topic: req.headers.topic, encoding: req.headers['content-encoding'], auth: req.headers.authorization }, body: body.toString('base64url') });
    res.writeHead(/\/gone/.test(url.pathname) ? 410 : 201); return res.end();
  }
  if (url.pathname === '/__inbox') { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); return res.end(JSON.stringify(inbox)); }
  if (url.pathname === '/__cron') {
    const r = await daily(env, url.searchParams.get('t') || undefined).catch((e) => ({ error: e.message }));
    console.log('cron', JSON.stringify(r));
    res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(r));
  }
  const r = await worker.fetch(new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), env, { waitUntil() {} });
  res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
}).listen(PORT, () => console.log(`Ospalek – upozornění lokálně na http://localhost:${PORT} (databáze ${DB})`));
