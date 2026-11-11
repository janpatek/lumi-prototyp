// Ospalek – předplatné z App Store a Google Play bez prostředníka (Supabase Edge Function „store“).
// Nahrazuje RevenueCat: nákupy ověřujeme přímo u obchodů a evidujeme v tabulkách store_subs a store_events,
// ze kterých počítá dashboard Předplatné v administraci (MRR, konverze, odchody, LTV…).
//
// Adresy (https://<projekt>.supabase.co/functions/v1/store/…):
//   POST /store/app     – aplikace po nákupu nebo při kontrole stavu (přihlášená rodina, Authorization: Bearer <token rodiny>)
//                         { platform: 'android', token, productId } | { platform: 'ios', jws }
//   POST /store/apple   – App Store Server Notifications V2 ({ signedPayload }), podpis ověřený řetězem k Apple Root CA G3
//   POST /store/google?secret=…  – Google Play Real-time developer notifications (Pub/Sub push), stav se dočte z Play API
//
// Nasazení: Supabase → Edge Functions → Deploy a new function → Via editor, název store, vložit tenhle soubor,
// v nastavení funkce VYPNOUT „Verify JWT“ (Apple ani Google token Supabase neposílají; /app si token ověřuje sama).
// Tajné hodnoty (Edge Functions → Secrets): GOOGLE_SERVICE_ACCOUNT (celý JSON klíč servisního účtu s přístupem k Play Console),
// PUBSUB_SECRET (náhodný řetězec, stejný jako v adrese Pub/Sub push odběru). URL a tajný klíč Supabase dodá Supabase sama.
// Postup: supabase/README.md, sekce Předplatné.
//
// Soubor nemá žádné importy, aby šel otestovat i v Node (supabase/functions/store/test.mjs).

const BUNDLE = 'cz.ospalek.app';
const PACKAGE = 'cz.ospalek.app';
// SHA-256 otisk certifikátu Apple Root CA - G3 (https://www.apple.com/certificateauthority/)
const APPLE_ROOT = '63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179';
const ORIGINS = ['https://ospalek.cz', 'https://www.ospalek.cz', 'capacitor://localhost', 'https://localhost', 'http://localhost'];

// deno-lint-ignore no-explicit-any
type J = any;
// deno-lint-ignore no-explicit-any
const G: any = globalThis;
const env = (k: string): string => (G.Deno ? G.Deno.env.get(k) : G.process?.env?.[k]) || '';
const enc = new TextEncoder();
const fail = (status: number, message: string) => Object.assign(new Error(message), { status });

// ---------- base64 ----------
const b64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const b64text = (s: string) => new TextDecoder().decode(b64(s));
const b64url = (u: Uint8Array | string) => btoa(typeof u === 'string' ? u : String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hex = (u: ArrayBuffer) => [...new Uint8Array(u)].map((x) => x.toString(16).padStart(2, '0')).join('');

// ---------- minimální čtení X.509 (DER) ----------
type Node = { tag: number; start: number; end: number; pos: number };
function tlv(b: Uint8Array, pos: number): Node {
  let len = b[pos + 1], off = pos + 2;
  if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = len * 256 + b[off + i]; off += n; }
  return { tag: b[pos], start: off, end: off + len, pos };
}
function kids(b: Uint8Array, n: Node): Node[] {
  const out: Node[] = []; let p = n.start;
  while (p < n.end) { const c = tlv(b, p); out.push(c); p = c.end; }
  return out;
}
function oid(b: Uint8Array, n: Node): string {
  const v = b.subarray(n.start, n.end), out = [Math.floor(v[0] / 40), v[0] % 40];
  let x = 0;
  for (let i = 1; i < v.length; i++) { x = x * 128 + (v[i] & 0x7f); if (!(v[i] & 0x80)) { out.push(x); x = 0; } }
  return out.join('.');
}
function time(b: Uint8Array, n: Node): number {
  let s = new TextDecoder().decode(b.subarray(n.start, n.end));
  if (n.tag === 0x17) s = (Number(s.slice(0, 2)) < 50 ? '20' : '19') + s;
  return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14));
}
const CURVES: Record<string, [string, number]> = { '1.2.840.10045.3.1.7': ['P-256', 32], '1.3.132.0.34': ['P-384', 48] };
const HASHES: Record<string, string> = { '1.2.840.10045.4.3.2': 'SHA-256', '1.2.840.10045.4.3.3': 'SHA-384' };
type Cert = { raw: Uint8Array; tbs: Uint8Array; sigAlg: string; sig: Uint8Array; spki: Uint8Array; curve: string; size: number; from: number; to: number; ext: Set<string> };
function cert(raw: Uint8Array): Cert {
  const top = kids(raw, tlv(raw, 0)), tbsN = top[0], t = kids(raw, tbsN);
  const o = t[0].tag === 0xa0 ? 1 : 0;
  const validity = kids(raw, t[o + 3]), spkiN = t[o + 5];
  const alg = kids(raw, kids(raw, spkiN)[0]);
  const c = CURVES[oid(raw, alg[1])];
  if (!c) throw fail(400, 'Nepodporovaný klíč certifikátu');
  const ext = new Set<string>();
  const extN = t.find((x) => x.tag === 0xa3);
  if (extN) kids(raw, kids(raw, extN)[0]).forEach((e) => ext.add(oid(raw, kids(raw, e)[0])));
  const sigBits = top[2];
  return {
    raw, tbs: raw.subarray(tbsN.pos, tbsN.end), sigAlg: oid(raw, kids(raw, top[1])[0]), sig: raw.subarray(sigBits.start + 1, sigBits.end),
    spki: raw.subarray(spkiN.pos, spkiN.end), curve: c[0], size: c[1], from: time(raw, validity[0]), to: time(raw, validity[1]), ext,
  };
}
// podpis ECDSA v DER (SEQUENCE { r, s }) → r||s pro WebCrypto
function rawSig(d: Uint8Array, size: number): Uint8Array {
  const [r, s] = kids(d, tlv(d, 0)).map((n) => d.subarray(n.start, n.end));
  const out = new Uint8Array(size * 2);
  const put = (v: Uint8Array, at: number) => { while (v.length > size && v[0] === 0) v = v.subarray(1); out.set(v, at + size - v.length); };
  put(r, 0); put(s, size);
  return out;
}
const keyOf = (c: Cert) => crypto.subtle.importKey('spki', c.spki, { name: 'ECDSA', namedCurve: c.curve }, false, ['verify']);
async function signedBy(c: Cert, issuer: Cert) {
  const hash = HASHES[c.sigAlg];
  if (!hash) throw fail(400, 'Nepodporovaný podpis certifikátu');
  return crypto.subtle.verify({ name: 'ECDSA', hash }, await keyOf(issuer), rawSig(c.sig, issuer.size), c.tbs);
}

// ---------- Apple: podepsaná data (JWS) ----------
// Řetěz x5c: list (OID 1.2.840.113635.100.6.11.1) ← mezilehlý Apple WWDR (1.2.840.113635.100.6.2.1) ← Apple Root CA G3.
export async function appleJws(jws: string, root = APPLE_ROOT, now = Date.now()): Promise<J> {
  const [h, p, s] = String(jws || '').split('.');
  if (!s) throw fail(400, 'Neplatná podepsaná data');
  const head = JSON.parse(b64text(h));
  if (head.alg !== 'ES256' || !Array.isArray(head.x5c) || head.x5c.length < 3) throw fail(400, 'Neplatná hlavička podpisu');
  const [leaf, mid, top] = head.x5c.slice(0, 3).map((x: string) => cert(b64(x)));
  if (hex(await crypto.subtle.digest('SHA-256', top.raw)) !== root) throw fail(401, 'Podpis nevede ke kořenovému certifikátu Applu');
  if (!leaf.ext.has('1.2.840.113635.100.6.11.1') || !mid.ext.has('1.2.840.113635.100.6.2.1')) throw fail(401, 'Certifikát nevydal Apple pro App Store');
  for (const c of [leaf, mid, top]) if (now < c.from || now > c.to) throw fail(401, 'Certifikát podpisu neplatí');
  if (!(await signedBy(leaf, mid)) || !(await signedBy(mid, top))) throw fail(401, 'Řetěz certifikátů nesedí');
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, await keyOf(leaf), b64(s), enc.encode(h + '.' + p));
  if (!ok) throw fail(401, 'Podpis dat nesedí');
  return JSON.parse(b64text(p));
}

const iso = (ms: number | string | null | undefined) => (ms == null || ms === '' ? null : new Date(typeof ms === 'string' && /^\d+$/.test(ms) ? Number(ms) : ms).toISOString());
const COUNTRY3: Record<string, string> = { CZE: 'CZ', SVK: 'SK', DEU: 'DE', AUT: 'AT', POL: 'PL', HUN: 'HU', USA: 'US', GBR: 'GB' };
const appleTrial = (tx: J) => tx.offerDiscountType === 'FREE_TRIAL' || (tx.offerType === 1 && !tx.price);

// Záznam pro store_record z transakce Applu (a případně informací o obnově a oznámení)
export function appleRecord(tx: J, rn: J | null, n: J | null, now = Date.now()): J {
  if (tx.bundleId && tx.bundleId !== BUNDLE) throw fail(400, 'Cizí aplikace');
  const trial = appleTrial(tx), exp = Number(tx.expiresDate) || 0;
  const price = tx.price != null ? Number(tx.price) / 1000 : null;
  let status = 'expired';
  if (tx.revocationDate) status = 'refunded';
  else if (exp > now) status = trial ? 'trial' : 'active';
  else if (rn && Number(rn.gracePeriodExpiresDate) > now) status = 'grace';
  else if (rn && rn.isInBillingRetryPeriod) status = 'retry';
  const sub: J = {
    id: 'ios:' + tx.originalTransactionId, platform: 'ios', product: tx.productId, status, trial,
    started_at: iso(tx.originalPurchaseDate || tx.purchaseDate), expires_at: iso(exp || null),
    country: COUNTRY3[tx.storefront] || (tx.storefront ? String(tx.storefront).slice(0, 2) : null),
    currency: tx.currency || null, price: trial ? null : price, env: tx.environment === 'Production' ? 'Production' : 'Sandbox',
  };
  if (rn) sub.will_renew = rn.autoRenewStatus === 1;
  const events: J[] = [{
    key: 'ios:tx:' + tx.transactionId, type: trial ? 'trial' : tx.transactionReason === 'PURCHASE' ? 'buy' : 'renew',
    at: iso(tx.purchaseDate), period_start: iso(tx.purchaseDate), period_end: iso(exp || null),
    amount: trial ? 0 : price || 0, currency: tx.currency || null,
  }];
  if (n) {
    const at = iso(n.signedDate) || new Date(now).toISOString(), key = 'ios:n:' + n.notificationUUID, d = [n.notificationType, n.subtype].filter(Boolean).join(' ');
    const t = ({ DID_FAIL_TO_RENEW: 'issue', EXPIRED: 'expire', GRACE_PERIOD_EXPIRED: 'expire', REVOKE: 'expire' } as Record<string, string>)[n.notificationType]
      || (n.notificationType === 'DID_CHANGE_RENEWAL_STATUS' ? (n.subtype === 'AUTO_RENEW_DISABLED' ? 'cancel' : 'uncancel') : null);
    if (t) events.push({ key, type: t, at, detail: d });
    if (n.notificationType === 'REFUND') events.push({ key: 'ios:refund:' + tx.transactionId, type: 'refund', at: iso(tx.revocationDate) || at, amount: -(price || 0), currency: tx.currency, detail: d });
  }
  return { sub, events, family: tx.appAccountToken || null };
}

// ---------- Google Play ----------
let gTok: { t: string; exp: number } | null = null;
async function googleToken(): Promise<string> {
  if (gTok && gTok.exp > Date.now() + 60e3) return gTok.t;
  const raw = env('GOOGLE_SERVICE_ACCOUNT');
  if (!raw) throw fail(503, 'Chybí GOOGLE_SERVICE_ACCOUNT (klíč servisního účtu Google Play)');
  const sa = JSON.parse(raw), now = Math.floor(Date.now() / 1000);
  const unsigned = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + b64url(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const pem = String(sa.private_key).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const key = await crypto.subtle.importKey('pkcs8', b64(pem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const jwt = unsigned + '.' + b64url(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(unsigned))));
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt });
  const j = await r.json();
  if (!r.ok) throw fail(502, 'Google nepřihlásil servisní účet: ' + (j.error_description || j.error || r.status));
  gTok = { t: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return gTok.t;
}
async function playSub(token: string): Promise<J> {
  const r = await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}/purchases/subscriptionsv2/tokens/${encodeURIComponent(token)}`, { headers: { Authorization: 'Bearer ' + (await googleToken()) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw fail(r.status === 404 || r.status === 410 ? 404 : 502, 'Google Play: ' + (j.error?.message || r.status));
  return j;
}
const money = (m: J) => (m ? Number(m.units || 0) + Number(m.nanos || 0) / 1e9 : null);
const minusMonth = (iso_: string) => { const d = new Date(iso_); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString(); };
// typy oznámení RTDN: https://developer.android.com/google/play/billing/rtdn-reference
const RTDN: Record<number, string> = { 3: 'cancel', 5: 'issue', 6: 'issue', 7: 'uncancel', 10: 'pause', 13: 'expire' };

// Záznam pro store_record ze stavu předplatného (purchases.subscriptionsv2) a případně oznámení
export function googleRecord(g: J, token: string, subId: string | null, note: J | null, now = Date.now()): J {
  const li = (g.lineItems || [])[0] || {};
  const exp = li.expiryTime ? Date.parse(li.expiryTime) : 0;
  const offer = li.offerDetails || {};
  const trial = li.offerPhase ? !!li.offerPhase.freeTrial : /trial|zkus/i.test(offer.offerId || '') && exp - Date.parse(g.startTime || 0) < 8 * 864e5;
  const st = String(g.subscriptionState || '').replace('SUBSCRIPTION_STATE_', '');
  let status = 'expired';
  if (st === 'ACTIVE' || (st === 'CANCELED' && exp > now)) status = trial ? 'trial' : 'active';
  else if (st === 'IN_GRACE_PERIOD') status = 'grace';
  else if (st === 'ON_HOLD') status = 'retry';
  else if (st === 'PAUSED') status = 'paused';
  const price = money(li.autoRenewingPlan?.recurringPrice), currency = li.autoRenewingPlan?.recurringPrice?.currencyCode || null;
  const sub: J = {
    id: subId || 'android:' + token, platform: 'android', product: [li.productId, offer.basePlanId].filter(Boolean).join(':'), status, trial,
    started_at: g.startTime || new Date(now).toISOString(), expires_at: iso(exp || null), will_renew: !!li.autoRenewingPlan?.autoRenewEnabled,
    country: g.regionCode || null, currency, price, env: g.testPurchase ? 'Sandbox' : 'Production', token,
  };
  const order = li.latestSuccessfulOrderId || g.latestOrderId, events: J[] = [];
  const at = note?.eventTimeMillis ? iso(note.eventTimeMillis) : new Date(now).toISOString();
  if (order && exp && !['PENDING', 'PENDING_PURCHASE_CANCELED'].includes(st)) {
    const first = !/\.\.\d+$/.test(order);
    events.push({
      key: 'android:order:' + order, type: trial ? 'trial' : first ? 'buy' : 'renew',
      at: trial || first ? g.startTime || at : at, period_start: trial ? g.startTime : minusMonth(li.expiryTime), period_end: li.expiryTime,
      amount: trial ? 0 : price || 0, currency,
    });
  }
  const t = note?.type && RTDN[note.type];
  if (t) events.push({ key: 'android:n:' + note.id, type: t, at, detail: 'RTDN ' + note.type });
  if (note?.type === 12) events.push({ key: 'android:refund:' + order, type: 'refund', at, amount: -(price || 0), currency, detail: 'RTDN 12 vráceno' });
  if (note?.voided) events.push({ key: 'android:refund:' + note.voided, type: 'refund', at, amount: -(price || 0), currency, detail: 'vrácená platba ' + note.voided });
  return { sub, events, family: g.externalAccountIdentifiers?.obfuscatedExternalAccountId || null };
}

// ---------- kurz ČNB (Kč za jednotku měny ke dni) ----------
const rates = new Map<string, Record<string, number>>();
async function cnb(day: string): Promise<Record<string, number>> {
  if (rates.has(day)) return rates.get(day)!;
  const [y, m, d] = day.split('-');
  const t = await (await fetch(`https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/denni_kurz.txt?date=${d}.${m}.${y}`)).text();
  const out: Record<string, number> = { CZK: 1 };
  for (const line of t.split('\n')) { const p = line.split('|'); if (p.length === 5 && /^[A-Z]{3}$/.test(p[3])) out[p[3]] = Number(p[4].replace(',', '.')) / Number(p[2]); }
  rates.set(day, out);
  return out;
}
async function withCzk(rec: J) {
  for (const e of rec.events) {
    if (!e.amount) { e.czk = 0; continue; }
    const cur = e.currency || 'CZK';
    let r = cur === 'CZK' ? 1 : null;
    if (r === null) r = (await cnb(String(e.at).slice(0, 10)).catch(() => ({} as Record<string, number>)))[cur] || ({ EUR: 25 } as Record<string, number>)[cur] || 0;
    e.czk = Math.round(e.amount * r * 100) / 100;
  }
  return rec;
}

// ---------- databáze ----------
const secretKey = () => (() => { try { return Object.values(JSON.parse(env('SUPABASE_SECRET_KEYS') || '{}'))[0] as string; } catch { return ''; } })() || env('SUPABASE_SERVICE_ROLE_KEY');
async function rpc(fn: string, args: J) {
  const key = secretKey();
  const headers: Record<string, string> = { apikey: key, 'Content-Type': 'application/json' };
  if (key.split('.').length === 3) headers.Authorization = 'Bearer ' + key; // starý klíč service_role je JWT
  const r = await fetch(`${env('SUPABASE_URL')}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw fail(500, 'Databáze: ' + ((j && j.message) || r.status));
  return j;
}
async function save(rec: J) { return rpc('store_record', { p: await withCzk(rec) }); }
async function caller(req: Request): Promise<string> {
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer /i, '');
  const r = await fetch(`${env('SUPABASE_URL')}/auth/v1/user`, { headers: { apikey: secretKey(), Authorization: 'Bearer ' + jwt } });
  const u = await r.json().catch(() => null);
  if (!r.ok || !u?.id) throw fail(401, 'Nejsi přihlášený.');
  return u.id;
}

// ---------- obsluha ----------
async function handle(req: Request, path: string): Promise<J> {
  if (path === 'app') {
    const uid = await caller(req), b = await req.json().catch(() => ({}));
    let rec: J;
    if (b.platform === 'ios') {
      const tx = await appleJws(b.jws);
      if (tx.bundleId !== BUNDLE) throw fail(400, 'Cizí aplikace');
      rec = appleRecord(tx, null, null);
    } else if (b.platform === 'android') {
      const token = String(b.token || '');
      if (!token) throw fail(400, 'Chybí purchase token');
      const g = await playSub(token);
      rec = googleRecord(g, token, await rpc('store_sub_by_token', { tokens: [token, g.linkedPurchaseToken].filter(Boolean) }), null);
    } else throw fail(400, 'Neznámá platforma');
    rec.family = uid; // nákup používá tahle rodina (i po obnovení na novém telefonu)
    return save(rec);
  }
  if (path === 'apple') {
    const b = await req.json().catch(() => ({}));
    const n = await appleJws(b.signedPayload);
    if (n.notificationType === 'TEST' || !n.data?.signedTransactionInfo) return { ok: true, test: n.notificationType === 'TEST' };
    if (n.data.bundleId !== BUNDLE) throw fail(400, 'Cizí aplikace');
    const tx = await appleJws(n.data.signedTransactionInfo);
    const rn = n.data.signedRenewalInfo ? await appleJws(n.data.signedRenewalInfo) : null;
    await save(appleRecord(tx, rn, n));
    return { ok: true };
  }
  if (path === 'google') {
    const secret = env('PUBSUB_SECRET');
    if (!secret || new URL(req.url).searchParams.get('secret') !== secret) throw fail(401, 'Neplatný klíč odběru');
    const b = await req.json().catch(() => ({}));
    const m = JSON.parse(b.message?.data ? b64text(b.message.data) : '{}');
    if (m.packageName && m.packageName !== PACKAGE) throw fail(400, 'Cizí aplikace');
    const sn = m.subscriptionNotification, vn = m.voidedPurchaseNotification;
    const token = sn?.purchaseToken || (vn?.productType === 1 && vn.purchaseToken);
    if (!token) return { ok: true, test: !!m.testNotification };
    let g: J;
    try { g = await playSub(token); } catch (e) { if ((e as J).status === 404) return { ok: true, gone: true }; throw e; }
    const id = await rpc('store_sub_by_token', { tokens: [token, g.linkedPurchaseToken].filter(Boolean) });
    await save(googleRecord(g, token, id, { id: b.message?.messageId || m.eventTimeMillis, type: sn?.notificationType, eventTimeMillis: m.eventTimeMillis, voided: vn?.orderId }));
    return { ok: true };
  }
  throw fail(404, 'Neznámá adresa');
}

if (G.Deno) {
  G.Deno.serve(async (req: Request) => {
    const origin = req.headers.get('origin');
    const h: Record<string, string> = {
      'Access-Control-Allow-Origin': origin && ORIGINS.includes(origin) ? origin : ORIGINS[0],
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Content-Type': 'application/json', Vary: 'Origin',
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    const path = new URL(req.url).pathname.split('/').filter(Boolean).pop() || '';
    try {
      if (req.method !== 'POST') throw fail(405, 'Jen POST.');
      return new Response(JSON.stringify(await handle(req, path)), { status: 200, headers: h });
    } catch (e) {
      const status = (e as J).status || 500;
      console.error(path, status, (e as Error).message);
      return new Response(JSON.stringify({ message: (e as Error).message }), { status, headers: h });
    }
  });
}
