// Vytvoří otisk nového hesla do administrace: node admin/heslo.js "nové heslo"
// Vypsané hodnoty salt a hash vlož do AUTH v admin/login.js. Samotné heslo nikam neukládej.
const crypto = require('crypto');
const pw = process.argv[2];
if (!pw || pw.length < 12) { console.error('Zadej heslo aspoň o 12 znacích: node admin/heslo.js "nové heslo"'); process.exit(1); }
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.pbkdf2Sync(pw, Buffer.from(salt, 'hex'), 250000, 32, 'sha256').toString('hex');
console.log(`salt: '${salt}',\nhash: '${hash}',`);
