// Test šifrování a podpisu bez sítě: node push-worker/test.mjs
// Prohlížeč (příjemce) je tu napodobený podle RFC 8291 z jeho strany: zprávu dešifruje svým soukromým klíčem,
// a podpis VAPID ověří Node.js stejně, jako by to udělala push služba.
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { encrypt, vapidHeader, sendPush, b64u } from './src/webpush.js';

const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const hkdf = (salt, ikm, info, len) => hmac(hmac(salt, ikm), Buffer.concat([info, Buffer.from([1])])).subarray(0, len);

// „prohlížeč“: klíče odběru jako z pushManager.subscribe()
const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
const authSecret = crypto.randomBytes(16);
const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/test', p256dh: ua.getPublicKey().toString('base64url'), auth: authSecret.toString('base64url') };

function decrypt(body) {
  const b = Buffer.from(body);
  const salt = b.subarray(0, 16), rs = b.readUInt32BE(16), idlen = b[20], asPublic = b.subarray(21, 21 + idlen), cipher = b.subarray(21 + idlen);
  assert.equal(rs, 4096); assert.equal(idlen, 65);
  const ecdh = ua.computeSecret(asPublic);
  const ikm = hkdf(authSecret, ecdh, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic]), 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(cipher.subarray(-16));
  const rec = Buffer.concat([d.update(cipher.subarray(0, -16)), d.final()]);
  assert.equal(rec[rec.length - 1], 2, 'chybí oddělovač posledního záznamu');
  return rec.subarray(0, -1).toString('utf8');
}

// 1) zašifrování a dešifrování, včetně češtiny a emoji
const msg = JSON.stringify({ title: 'Je čas na pohádku 🌙', body: 'Čeká na vás pohádka „{pohadka}“.', story: 'drak' });
assert.equal(decrypt(await encrypt(sub, msg)), msg);
// dvě zprávy se stejným obsahem musí vypadat jinak (nová sůl a dočasný klíč)
assert.notDeepEqual(await encrypt(sub, msg), await encrypt(sub, msg));
console.log('✓ šifrování aes128gcm: prohlížeč zprávu přečte');

// 2) VAPID: podpis ES256 ověřený veřejným klíčem, správné aud a exp
const v = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = v.privateKey.export({ format: 'jwk' });
const vapid = { publicKey: Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url'), privateKey: jwk.d };
const h = await vapidHeader(sub.endpoint, vapid);
const [, t, k] = h.match(/^vapid t=([^,]+), k=(.+)$/);
assert.equal(k, vapid.publicKey);
const [hd, pl, sig] = t.split('.');
assert.ok(crypto.verify('sha256', Buffer.from(hd + '.' + pl), { key: v.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')), 'podpis VAPID nesedí');
const claims = JSON.parse(Buffer.from(pl, 'base64url'));
assert.equal(claims.aud, 'https://fcm.googleapis.com');
assert.ok(claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 24 * 3600, 'exp musí být do 24 hodin');
assert.match(claims.sub, /^mailto:/);
console.log('✓ VAPID: podpis platí, aud a exp podle RFC 8292');

// 3) odeslání: hlavičky a vyhodnocení odpovědi push služby
let seen;
const fake = (status) => async (url, init) => { seen = { url, init }; return new Response(null, { status }); };
assert.equal(await sendPush(sub, { a: 1 }, vapid, { topic: 'pohadka-dne', fetchImpl: fake(201) }), 'ok');
assert.equal(seen.init.headers['Content-Encoding'], 'aes128gcm');
assert.equal(seen.init.headers.TTL, '10800');
assert.equal(seen.init.headers.Topic, 'pohadka-dne');
assert.equal(decrypt(seen.init.body), '{"a":1}');
assert.equal(await sendPush(sub, {}, vapid, { fetchImpl: fake(410) }), 'gone');
assert.equal(await sendPush(sub, {}, vapid, { fetchImpl: fake(404) }), 'gone');
assert.equal(await sendPush(sub, {}, vapid, { fetchImpl: fake(429) }), 'fail');
assert.equal(await sendPush({ ...sub, p256dh: 'xx' }, {}, vapid, { fetchImpl: fake(201) }), 'fail');
assert.equal(b64u.encode(b64u.decode(sub.p256dh)), sub.p256dh);
console.log('✓ odeslání: hlavičky, 201 = doručeno, 404/410 = zaniklý odběr, jiné = zkusit znovu');
