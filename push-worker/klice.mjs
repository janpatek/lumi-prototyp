// Vyrobí klíče VAPID pro večerní upozornění (jednou na začátku): node push-worker/klice.mjs
//  - soukromý klíč pošle rovnou do Cloudflaru (`wrangler secret put VAPID_PRIVATE_KEY`), nikde se nevypíše ani neuloží,
//  - veřejný klíč zapíše do config.js (pushKey) a push-worker/wrangler.toml (VAPID_PUBLIC_KEY).
// Nové klíče zneplatní všechny dosavadní odběry (rodiny by musely připomínku zapnout znovu), proto skript
// klíče nepřepíše, pokud v config.js už nějaký je. Výjimka jen vědomě: node push-worker/klice.mjs --znovu
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = path.join(here, '..', 'config.js');
const TOML = path.join(here, 'wrangler.toml');

const cfg = fs.readFileSync(CONFIG, 'utf8');
if (/pushKey:\s*'[^']+'/.test(cfg) && !process.argv.includes('--znovu')) {
  console.log('V config.js už klíč je. Nové klíče by zrušily všechny odběry upozornění.');
  console.log('Pokud to opravdu chceš: node push-worker/klice.mjs --znovu');
  process.exit(1);
}

const k = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = k.privateKey.export({ format: 'jwk' });
const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url');

console.log('Ukládám soukromý klíč do Workeru ospalek-push (wrangler se může zeptat na přihlášení do Cloudflaru)…');
const r = spawnSync('npx', ['wrangler', 'secret', 'put', 'VAPID_PRIVATE_KEY'], { cwd: here, input: jwk.d, stdio: ['pipe', 'inherit', 'inherit'] });
if (r.status !== 0) {
  console.error('\nSoukromý klíč se do Workeru nepodařilo uložit, nic jsem nezměnil. Zkus to znovu (Worker musí být jednou nasazený: cd push-worker && npx wrangler deploy).');
  process.exit(1);
}
fs.writeFileSync(CONFIG, cfg.replace(/pushKey:\s*'[^']*'/, `pushKey: '${pub}'`));
fs.writeFileSync(TOML, fs.readFileSync(TOML, 'utf8').replace(/VAPID_PUBLIC_KEY = "[^"]*"/, `VAPID_PUBLIC_KEY = "${pub}"`));
console.log(`\nHotovo. Veřejný klíč je v config.js a wrangler.toml:\n  ${pub}\nTeď ještě: cd push-worker && npx wrangler deploy, a změny v config.js nahraj na web (commit + push).`);
