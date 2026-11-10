// Ospalek – hlas pohádek přes ElevenLabs.
// Cloudflare Worker drží API klíč (tajná hodnota ELEVENLABS_API_KEY), aby nebyl v kódu aplikace.
// Aplikace pošle POST /tts { text, voice, mood? } a dostane zpět MP3. Stejný text + hlas se podruhé neplatí:
// hotové nahrávky se ukládají do mezipaměti Cloudflaru, a pokud je připojené úložiště R2 (AUDIO), i natrvalo.
// Mezipaměť je společná pro všechny rodiny: věta „Dobrou noc, Toníku.“ se zaplatí jednou pro všechny Toníky.
// Přehrávač po větách (app/voice-player.js) posílá mood = nálada pohádky; Worker pak předřadí stejnou
// značku přednesu jako u nahrávek z tools/hlas, aby věty z Workeru seděly ke společným větám.
//
// Nastavení (wrangler.toml → [vars], klíč přes `npx wrangler secret put ELEVENLABS_API_KEY`):
//   ALLOWED_ORIGINS  čárkou oddělené adresy webu, odkud se smí volat
//   VOICES           JSON { "jana": "<voice_id>" } – jen tyhle hlasy jdou použít
//   MODEL_ID         model ElevenLabs (výchozí eleven_v4 – stejný jako nahrávky v audio/hlas)
//   STABILITY        stabilita hlasu 0–1 (výchozí 0.6, stejná jako nahrávky v audio/hlas)
//   MAX_CHARS        nejdelší povolený text v jednom požadavku (jeden odstavec pohádky)
//   LANGUAGE_CODE    volitelně "cs" – jen pro modely, které vynucení jazyka podporují

const API = 'https://api.elevenlabs.io/v1/text-to-speech/';
// musí být stejné jako MOOD_TAG v tools/hlas/lib.mjs
const MOOD_TAG = {
  lullaby: '[soft, calm, warm storyteller voice]',
  adventure: '[warm, lively storyteller voice]',
  road: '[cheerful, playful storyteller voice]',
};
const CACHE_HOST = 'https://tts-cache.ospalek.internal/';

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const allowed = list(env.ALLOWED_ORIGINS);
    const cors = allowed.includes(origin)
      ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }
      : { Vary: 'Origin' };
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: allowed.includes(origin) ? 204 : 403, headers: cors });
    if (request.method === 'GET' && url.pathname === '/') {
      return json({ ok: true, voices: Object.keys(voices(env)), model: model(env), key: !!env.ELEVENLABS_API_KEY }, 200, cors);
    }
    if (request.method !== 'POST' || url.pathname !== '/tts') return json({ error: 'Nenalezeno.' }, 404, cors);

    // prohlížeč vždy posílá Origin – cizí weby tak hlas nevyužijí (skript mimo prohlížeč ano, proto i limit kreditů u klíče)
    if (!allowed.includes(origin)) return json({ error: 'Tenhle web nemá povolený přístup.' }, 403, cors);
    if (!env.ELEVENLABS_API_KEY) return json({ error: 'Chybí API klíč ElevenLabs.' }, 500, cors);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'Neplatný požadavek.' }, 400, cors); }
    const text = String(body.text || '').trim();
    const maxChars = Number(env.MAX_CHARS) || 1500;
    if (!text) return json({ error: 'Chybí text.' }, 400, cors);
    if (text.length > maxChars) return json({ error: `Text je delší než ${maxChars} znaků.` }, 413, cors);
    const vs = voices(env);
    const voiceName = body.voice && vs[body.voice] ? body.voice : Object.keys(vs)[0];
    const voiceId = vs[voiceName];
    if (!voiceId) return json({ error: 'Není nastavený žádný hlas.' }, 500, cors);

    const tag = MOOD_TAG[body.mood] || '';
    const stability = Number(env.STABILITY ?? 0.6);
    // bez nálady zůstává klíč jako dřív, ať se neztratí už uložené odstavce
    const key = await sha256(tag ? `${model(env)}|${voiceId}|${stability}|${tag}|${text}` : `${model(env)}|${voiceId}|${text}`);
    const cacheKey = new Request(CACHE_HOST + key);
    const audioHeaders = { ...cors, 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=31536000, immutable' };

    // 1) rychlá mezipaměť Cloudflaru, 2) trvalé úložiště R2, 3) teprve pak ElevenLabs (stojí kredity)
    const cache = caches.default;
    const hit = await cache.match(cacheKey);
    if (hit) return new Response(hit.body, { headers: { ...audioHeaders, 'X-Ospalek-Cache': 'edge' } });
    if (env.AUDIO) {
      const obj = await env.AUDIO.get(key + '.mp3');
      if (obj) {
        const buf = await obj.arrayBuffer();
        ctx.waitUntil(cache.put(cacheKey, new Response(buf, { headers: audioHeaders })));
        return new Response(buf, { headers: { ...audioHeaders, 'X-Ospalek-Cache': 'r2' } });
      }
    }

    const res = await fetch(`${API}${voiceId}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      // language_code jen když je nastavený – vynutit jazyk umí jen některé modely (např. eleven_flash_v2_5)
      body: JSON.stringify({
        text: tag ? `${tag} ${text}` : text,
        model_id: model(env),
        ...(tag ? { voice_settings: { stability, similarity_boost: 0.75 } } : {}),
        ...(env.LANGUAGE_CODE ? { language_code: env.LANGUAGE_CODE } : {}),
      }),
    });
    if (!res.ok) {
      // podrobnosti jen do logu Workeru, aplikaci stačí obecná hláška
      console.log('ElevenLabs', res.status, (await res.text()).slice(0, 300));
      const msg = res.status === 401 ? 'API klíč ElevenLabs nefunguje.' : res.status === 402 ? 'Účet ElevenLabs potřebuje placený tarif (hlasy z knihovny jdou přes API jen s ním).' : res.status === 429 ? 'ElevenLabs je přetížený nebo došly kredity.' : 'ElevenLabs teď nevrátil zvuk.';
      return json({ error: msg }, 502, cors);
    }
    const buf = await res.arrayBuffer();
    ctx.waitUntil(cache.put(cacheKey, new Response(buf, { headers: audioHeaders })));
    if (env.AUDIO) ctx.waitUntil(env.AUDIO.put(key + '.mp3', buf, { httpMetadata: { contentType: 'audio/mpeg' } }));
    return new Response(buf, { headers: { ...audioHeaders, 'X-Ospalek-Cache': 'miss' } });
  },
};

const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const model = (env) => env.MODEL_ID || 'eleven_v4';
function voices(env) {
  try { return typeof env.VOICES === 'string' ? JSON.parse(env.VOICES) : env.VOICES || {}; } catch { return {}; }
}
function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });
}
async function sha256(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
