// Lokální zkouška bez účtu a bez kreditů: spustí worker na http://localhost:8787
// a místo ElevenLabs vrací kus ukázkové nahrávky (audio/hvezdicka-jana.mp3), dlouhý podle textu.
//   node tts-worker/dev-mock.mjs
// Aplikaci pak otevři s ?tts=http://localhost:8787 (např. http://localhost:5174/?tts=http://localhost:8787).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import worker from './src/worker.js';

const PORT = Number(process.env.PORT) || 8787;
const sample = await readFile(new URL('../audio/hvezdicka-jana.mp3', import.meta.url));
const SAMPLE_SECONDS = 100; // délka ukázky
let calls = 0;

// náhrada ElevenLabs: zhruba 14 znaků za sekundu
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith('https://api.elevenlabs.io/')) throw new Error('Mock zná jen ElevenLabs.');
  calls++;
  const { text } = JSON.parse(init.body);
  const seconds = Math.min(SAMPLE_SECONDS, Math.max(2, text.length / 14));
  const bytes = Math.round((sample.length * seconds) / SAMPLE_SECONDS);
  console.log(`  → ElevenLabs (mock) #${calls}: ${text.length} znaků, ${seconds.toFixed(1)} s – ${text.slice(0, 60)}`);
  return new Response(sample.subarray(0, bytes), { headers: { 'Content-Type': 'audio/mpeg' } });
};
// náhrada mezipaměti Cloudflaru
const store = new Map();
globalThis.caches = { default: {
  match: async (req) => (store.has(req.url) ? new Response(store.get(req.url)) : undefined),
  put: async (req, res) => { store.set(req.url, await res.arrayBuffer()); },
} };

const env = {
  ELEVENLABS_API_KEY: 'mock',
  ALLOWED_ORIGINS: 'http://localhost:5174',
  VOICES: '{"jana":"mock-voice"}',
  MODEL_ID: 'eleven_v4',
  MAX_CHARS: '1500',
};

createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const request = new Request(`http://localhost:${PORT}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : Buffer.concat(chunks),
  });
  const pending = [];
  const out = await worker.fetch(request, env, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  console.log(`${req.method} ${req.url} → ${out.status}${out.headers.get('X-Ospalek-Cache') ? ' (' + out.headers.get('X-Ospalek-Cache') + ')' : ''}`);
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(Buffer.from(await out.arrayBuffer()));
}).listen(PORT, () => console.log(`Ospalek TTS (mock) běží na http://localhost:${PORT}`));
