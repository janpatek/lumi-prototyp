// Sestaví stránku ke schválení konceptů: node tools/pohadky/nahled.mjs [písmena dávek…] [--out nahled-2.html]
// Výstup koncepty/pohadky/nahled.html (vloží voice-lines.js a vybrané nebo všechny koncepty/pohadky/*.js).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = path.join(root, 'koncepty/pohadky');
const args = process.argv.slice(2);
const oi = args.indexOf('--out');
const out = oi >= 0 ? args.splice(oi, 2)[1] : 'nahled.html';
const only = new Set(args);
const drafts = fs.readdirSync(dir).filter((f) => /^[a-z]\.js$/.test(f) && (!only.size || only.has(f[0]))).sort().map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
const helpers = fs.readFileSync(path.join(root, 'app/stories.cs.js'), 'utf8').split('\n').filter((l) => /^const (cap|listCz) =/.test(l)).join('\n');
const data = [helpers, fs.readFileSync(path.join(root, 'app/voice-lines.js'), 'utf8'), ...drafts].join('\n;\n').replace(/<\/script/gi, '<\\/script');
const html = fs.readFileSync(path.join(root, 'tools/pohadky/nahled.template.html'), 'utf8').replace('/*DATA*/', () => data);
fs.writeFileSync(path.join(dir, out), html);
console.log('koncepty/pohadky/' + out, Math.round(html.length / 1024) + ' kB', drafts.length + ' dávek');
