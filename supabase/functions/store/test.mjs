// Test ověření podpisu Applu a převodu událostí: node supabase/functions/store/test.mjs <složka s testovacími certifikáty>
// Testovací řetěz (root P-384 → mezilehlý s OID Applu → list P-256 s OID Applu) vyrobí openssl, postup v supabase/README.md.
import { readFileSync } from 'node:fs';
import { createHash, createSign } from 'node:crypto';
import assert from 'node:assert/strict';
const { appleJws, appleRecord, googleRecord } = await import('./index.ts');
const dir = process.argv[2];
const der = (f) => Buffer.from(readFileSync(`${dir}/${f}`, 'utf8').replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64');
const x5c = ['leaf.pem', 'mid.pem', 'root.pem'].map((f) => der(f).toString('base64'));
const rootHash = createHash('sha256').update(der('root.pem')).digest('hex');
const u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (payload, chain = x5c) => {
  const h = u({ alg: 'ES256', x5c: chain }), p = u(payload);
  const s = createSign('SHA256').update(h + '.' + p).sign({ key: readFileSync(`${dir}/leaf.key`), dsaEncoding: 'ieee-p1363' });
  return `${h}.${p}.${s.toString('base64url')}`;
};
const now = Date.now(), day = 864e5;
const tx = { transactionId: '2000001', originalTransactionId: '2000000', bundleId: 'cz.ospalek.app', productId: 'ospalek_plus_mesicne', purchaseDate: now - 2 * day, originalPurchaseDate: now - 5 * day, expiresDate: now + 28 * day, price: 129000, currency: 'CZK', storefront: 'CZE', environment: 'Production', transactionReason: 'RENEWAL', appAccountToken: '11111111-2222-3333-4444-555555555555' };

// 1) platný podpis projde a vrátí data
assert.deepEqual(await appleJws(sign(tx), rootHash), tx);
// 2) skutečný kořen Applu testovací řetěz odmítne
await assert.rejects(appleJws(sign(tx)), /kořenovému certifikátu/);
// 3) změněná data → podpis nesedí
const bad = sign(tx).split('.'); bad[1] = u({ ...tx, price: 1 });
await assert.rejects(appleJws(bad.join('.'), rootHash), /Podpis dat nesedí/);
// 4) prohozené certifikáty → řetěz nesedí
await assert.rejects(appleJws(sign(tx, [x5c[1], x5c[1], x5c[2]]), rootHash), /nevydal Apple|Řetěz/);

// 5) převod: obnovení s cenou, oznámení o vypnutí obnovy
const rec = appleRecord(tx, { autoRenewStatus: 0 }, { notificationType: 'DID_CHANGE_RENEWAL_STATUS', subtype: 'AUTO_RENEW_DISABLED', notificationUUID: 'n1', signedDate: now }, now);
assert.equal(rec.sub.id, 'ios:2000000'); assert.equal(rec.sub.status, 'active'); assert.equal(rec.sub.will_renew, false); assert.equal(rec.sub.country, 'CZ');
assert.deepEqual(rec.events.map((e) => [e.type, e.amount]), [['renew', 129], ['cancel', undefined]]);
assert.equal(rec.family, tx.appAccountToken);
// 6) zkušební doba
const tr = appleRecord({ ...tx, offerType: 1, offerDiscountType: 'FREE_TRIAL', price: 0, transactionReason: 'PURCHASE', expiresDate: now + day }, null, null, now);
assert.equal(tr.sub.status, 'trial'); assert.equal(tr.events[0].type, 'trial'); assert.equal(tr.events[0].amount, 0);
// 7) vrácení peněz
const rf = appleRecord({ ...tx, revocationDate: now }, null, { notificationType: 'REFUND', notificationUUID: 'n2', signedDate: now }, now);
assert.equal(rf.sub.status, 'refunded'); assert.deepEqual(rf.events.at(-1).amount, -129);

// 8) Google: zkušební doba a pak první platba
const g = { startTime: new Date(now - 3 * day).toISOString(), regionCode: 'SK', subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE', latestOrderId: 'GPA.1234-5678-9012-34567', externalAccountIdentifiers: { obfuscatedExternalAccountId: 'fam-uuid' },
  lineItems: [{ productId: 'ospalek_plus', expiryTime: new Date(now + day).toISOString(), offerDetails: { basePlanId: 'mesicne', offerId: 'zkusebni-3-dny' }, offerPhase: { freeTrial: {} }, autoRenewingPlan: { autoRenewEnabled: true, recurringPrice: { currencyCode: 'EUR', units: '4', nanos: 990000000 } } }] };
const g1 = googleRecord(g, 'tok1', null, null, now);
assert.equal(g1.sub.id, 'android:tok1'); assert.equal(g1.sub.status, 'trial'); assert.equal(g1.events[0].type, 'trial'); assert.equal(g1.family, 'fam-uuid'); assert.equal(g1.sub.price, 4.99);
const g2 = googleRecord({ ...g, latestOrderId: 'GPA.1234-5678-9012-34567..0', lineItems: [{ ...g.lineItems[0], offerPhase: { basePrice: {} }, expiryTime: new Date(now + 30 * day).toISOString() }] }, 'tok1', 'android:tok1', { id: 'm1', type: 2, eventTimeMillis: String(now) }, now);
assert.equal(g2.sub.status, 'active'); assert.deepEqual(g2.events.map((e) => [e.type, e.amount, e.currency]), [['renew', 4.99, 'EUR']]);
const g3 = googleRecord({ ...g, subscriptionState: 'SUBSCRIPTION_STATE_CANCELED', lineItems: [{ ...g.lineItems[0], offerPhase: { basePrice: {} }, autoRenewingPlan: { autoRenewEnabled: false } }] }, 'tok1', 'android:tok1', { id: 'm2', type: 3, eventTimeMillis: String(now) }, now);
assert.equal(g3.sub.will_renew, false); assert.ok(g3.events.some((e) => e.type === 'cancel'));
console.log('OK: 8 testů prošlo');
