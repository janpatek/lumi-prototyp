// Web Push bez knihoven, jen WebCrypto (běží v Cloudflare Workeru i v Node 20+).
// - zašifrování zprávy pro prohlížeč: RFC 8291 (Message Encryption for Web Push) s kódováním aes128gcm (RFC 8188)
// - podpis odesílatele VAPID: RFC 8292 (JWT ES256 podepsaný soukromým klíčem, veřejný klíč zná aplikace)
// Odběr = { endpoint, p256dh, auth } tak, jak ho vrátí pushManager.subscribe() v prohlížeči.

const enc = new TextEncoder();
const subtle = crypto.subtle;

export const b64u = {
  encode(buf) {
    const b = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(str) {
    const s = atob(String(str).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(str).length + 3) % 4));
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  },
};

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

async function hmac(key, data) {
  const k = await subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle.sign('HMAC', k, data));
}
// HKDF v jednom kroku (výstup do 32 bajtů): extract + expand s čítačem 1
const hkdf = async (salt, ikm, info, len) => (await hmac(await hmac(salt, ikm), concat(info, new Uint8Array([1])))).slice(0, len);

// Zašifruje zprávu pro jeden odběr. asKeys a salt jdou podstrčit kvůli testu, jinak se pokaždé vyrobí nové.
export async function encrypt(sub, plaintext, { asKeys, salt } = {}) {
  const uaPublic = b64u.decode(sub.p256dh);
  const authSecret = b64u.decode(sub.auth);
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error('Neplatné klíče odběru.');
  const as = asKeys || await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await subtle.exportKey('raw', as.publicKey));
  const uaKey = await subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));

  const ikm = await hkdf(authSecret, ecdh, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const s = salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(s, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(s, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  // jeden záznam: zpráva + oddělovač posledního záznamu 0x02, bez výplně
  const record = concat(typeof plaintext === 'string' ? enc.encode(plaintext) : plaintext, new Uint8Array([2]));
  const key = await subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, record));

  const rs = new Uint8Array([0, 0, 16, 0]); // velikost záznamu 4096
  return concat(s, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

// VAPID: hlavička Authorization pro konkrétní push službu (aud = její origin)
const jwtCache = new Map();
export async function vapidHeader(endpoint, vapid) {
  const aud = new URL(endpoint).origin;
  const hit = jwtCache.get(aud);
  const now = Math.floor(Date.now() / 1000);
  if (hit && hit.exp - now > 3600) return hit.header;
  const pub = b64u.decode(vapid.publicKey);
  if (pub.length !== 65) throw new Error('Neplatný veřejný klíč VAPID.');
  const key = await subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256', d: vapid.privateKey, x: b64u.encode(pub.slice(1, 33)), y: b64u.encode(pub.slice(33, 65)), ext: true,
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const exp = now + 12 * 3600;
  const head = b64u.encode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u.encode(enc.encode(JSON.stringify({ aud, exp, sub: vapid.subject || 'mailto:support@ospalek.cz' })));
  const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + body));
  const header = `vapid t=${head}.${body}.${b64u.encode(sig)}, k=${vapid.publicKey}`;
  jwtCache.set(aud, { exp, header });
  return header;
}

// Odešle jednu zprávu. Vrací 'ok', 'gone' (odběr zanikl, smazat) nebo 'fail' (zkusit příště).
export async function sendPush(sub, payload, vapid, { ttl = 10800, topic, fetchImpl = fetch } = {}) {
  try {
    const body = await encrypt(sub, JSON.stringify(payload));
    const headers = {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      TTL: String(ttl),
      Urgency: 'normal',
      Authorization: await vapidHeader(sub.endpoint, vapid),
    };
    if (topic) headers.Topic = topic;
    const r = await fetchImpl(sub.endpoint, { method: 'POST', headers, body });
    if (r.status === 404 || r.status === 410) return 'gone';
    return r.ok ? 'ok' : 'fail';
  } catch (e) {
    return 'fail';
  }
}
