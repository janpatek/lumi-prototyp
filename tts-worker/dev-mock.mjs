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
const realFetch = globalThis.fetch;
const DAY = 864e5;
globalThis.fetch = async (url, init) => {
  url = String(url);
  // GET /naklady: databáze jde na skutečnou (lokální) supabase/dev-server.mjs, ElevenLabs a ČNB jsou vymyšlené
  if (url.startsWith(env.SUPABASE_URL)) return realFetch(url, init);
  if (url.includes('cnb.cz')) return new Response('10.11.2026 #218\nzemě|měna|množství|kód|kurz\nEMU|euro|1|EUR|24,315\nUSA|dolar|1|USD|22,870\n');
  if (url.includes('/v1/user/subscription')) return Response.json({ tier: 'creator', status: 'active', currency: 'usd', character_limit: 100000, character_count: 41234, next_character_count_reset_unix: Math.floor((Date.now() + 18 * DAY) / 1000), next_invoice: { amount_due_cents: 2200, next_payment_attempt_unix: Math.floor((Date.now() + 18 * DAY) / 1000) } });
  if (url.includes('/v1/usage/character-stats')) {
    const t0 = Math.floor((Date.now() - 20 * DAY) / DAY) * DAY, time = [], all = [];
    for (let i = 0; i <= 20; i++) { time.push(t0 + i * DAY); all.push(i < 2 ? 0 : Math.round(800 + 3000 * Math.abs(Math.sin(i)))); }
    return Response.json({ time, usage: { All: all } });
  }
  if (!url.startsWith('https://api.elevenlabs.io/')) throw new Error('Mock zná jen ElevenLabs.');
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
  SUPABASE_URL: process.env.SUPABASE_URL || 'http://localhost:54321',
  SUPABASE_KEY: 'dev',
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
