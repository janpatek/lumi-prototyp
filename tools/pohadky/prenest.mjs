// Přenese schválené koncepty do aplikace: node tools/pohadky/prenest.mjs a b c …
// Vezme pole pohádek z koncepty/pohadky/<písmeno>.js, vynechá pomocná pole (delka, pro, pozn, pouceni)
// a vloží je na konec window.STORIES v app/stories.cs.js. Pohádky, jejichž id už v aplikaci je, přeskočí.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const target = path.join(root, 'app/stories.cs.js');
let app = fs.readFileSync(target, 'utf8');
const have = new Set([...app.matchAll(/^    id: '([^']+)'/gm)].map((m) => m[1]));
let out = '';
let n = 0;
for (const b of process.argv.slice(2)) {
  const src = fs.readFileSync(path.join(root, 'koncepty/pohadky', b + '.js'), 'utf8');
  const body = src.slice(src.indexOf('concat([') + 'concat(['.length, src.lastIndexOf(']);'));
  // pohádky začínají řádkem „  {“ na úrovni pole
  const items = body.split(/\n(?=  \{\n)/).filter((s) => s.trim().startsWith('{'));
  for (const it of items) {
    const id = (it.match(/^    id: '([^']+)'/m) || [])[1];
    if (!id || have.has(id)) { console.log('přeskočeno', id); continue; }
    out += '\n' + it.replace(/^    (delka|pro|pozn|pouceni): .*\n/gm, '').replace(/\s*$/, '').replace(/,?$/, ',');
    have.add(id);
    n++;
  }
}
const end = app.lastIndexOf('\n];');
app = app.slice(0, end) + out + app.slice(end);
fs.writeFileSync(target, app);
console.log(`přeneseno ${n} pohádek`);
