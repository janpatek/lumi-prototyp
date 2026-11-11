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
//   STABILITY        stabilita hlasu 0–1 (wrangler.toml má 0.75; hotové věty v audio/hlas vznikly se stejnou hodnotou)
//   MAX_CHARS        nejdelší povolený text v jednom požadavku (jedna věta pohádky; nejdelší má ~190 znaků)
//   TTS_LIMIT        (binding ratelimits) kolik nových vět smí jedna IP adresa vygenerovat za minutu
//   LANGUAGE_CODE    volitelně "cs" – jen pro modely, které vynucení jazyka podporují
//   SUPABASE_URL, SUPABASE_KEY  databáze administrace (veřejný publishable klíč); GET /naklady podle ní pozná člena týmu
//
// GET /naklady (pro administraci): spotřeba kreditů ElevenLabs po dnech od začátku, tarif a kurz ČNB.
// Pustí jen člena týmu přihlášeného i kódem z Google Authenticatoru (token Supabase v hlavičce Authorization).
// Klíč ElevenLabs k tomu potřebuje oprávnění „User: Read“ (tarif) a „Usage“ / „Workspace analytics: Read“ (spotřeba).

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
      ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }
      : { Vary: 'Origin' };
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: allowed.includes(origin) ? 204 : 403, headers: cors });
    if (request.method === 'GET' && url.pathname === '/') {
      return json({ ok: true, voices: Object.keys(voices(env)), model: model(env), key: !!env.ELEVENLABS_API_KEY }, 200, cors);
    }
    if (request.method === 'GET' && url.pathname === '/naklady') return costs(request, env, ctx, cors);
    if (request.method !== 'POST' || url.pathname !== '/tts') return json({ error: 'Nenalezeno.' }, 404, cors);

    // prohlížeč vždy posílá Origin – cizí weby tak hlas nevyužijí (skript mimo prohlížeč ano, proto i limit kreditů u klíče)
    if (!allowed.includes(origin)) return json({ error: 'Tenhle web nemá povolený přístup.' }, 403, cors);
    if (!env.ELEVENLABS_API_KEY) return json({ error: 'Chybí API klíč ElevenLabs.' }, 500, cors);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'Neplatný požadavek.' }, 400, cors); }
    const text = String(body.text || '').trim();
    const maxChars = Number(env.MAX_CHARS) || 400;
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

    // Limit nových vět na jednu IP adresu (Cloudflare Rate Limiting, wrangler.toml → TTS_LIMIT). Počítá se jen to,
    // co jde do ElevenLabs; věty z mezipaměti jsou zdarma a neomezené. Celkový strop drží limit kreditů u klíče.
    if (env.TTS_LIMIT) {
      const { success } = await env.TTS_LIMIT.limit({ key: request.headers.get('CF-Connecting-IP') || 'neznama' });
      if (!success) return json({ error: 'Příliš mnoho nových vět najednou. Zkus to za chvilku.' }, 429, cors);
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

// ---------- Náklady na kredity (administrace) ----------
const COST_ROLES = ['owner', 'finance', 'analyst', 'content'];
const START = Date.UTC(2026, 0, 1); // od kdy hledat spotřebu (před založením Ospalku nic nebylo)
async function costs(request, env, ctx, cors) {
  // 1) kdo se ptá: databáze vrátí roli jen členovi týmu s kódem (aal2), jinak chybu
  const auth = request.headers.get('Authorization') || '';
  if (!env.SUPABASE_URL || !env.SUPABASE_KEY) return json({ error: 'Worker nemá nastavenou databázi (SUPABASE_URL).' }, 500, cors);
  const who = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/admin_role`, { method: 'POST', headers: { apikey: env.SUPABASE_KEY, Authorization: auth, 'Content-Type': 'application/json' }, body: '{}' });
  const role = who.ok ? await who.json().catch(() => null) : null;
  if (!COST_ROLES.includes(role)) return json({ error: 'Náklady vidí jen přihlášený člen týmu s oprávněním.' }, 403, cors);
  if (!env.ELEVENLABS_API_KEY) return json({ error: 'Chybí API klíč ElevenLabs.' }, 500, cors);

  // 2) výsledek se drží 10 minut, ať se ElevenLabs a ČNB neptáme při každém otevření stránky
  const cacheKey = new Request(CACHE_HOST + 'naklady/' + Math.floor(Date.now() / 6e5));
  const hit = await caches.default.match(cacheKey);
  if (hit) return new Response(hit.body, { headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });

  const el = (path) => fetch('https://api.elevenlabs.io/v1/' + path, { headers: { 'xi-api-key': env.ELEVENLABS_API_KEY } })
    .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 401 ? 'klíč nemá oprávnění' : 'chyba ' + r.status))));
  const now = Date.now(), errors = [];
  const [sub, usage, rates] = await Promise.all([
    el('user/subscription').catch((e) => { errors.push('Tarif: ' + e.message + ' (User: Read)'); return null; }),
    el(`usage/character-stats?start_unix=${START}&end_unix=${now}&aggregation_interval=day&metric=credits`).catch((e) => { errors.push('Spotřeba: ' + e.message + ' (Usage)'); return null; }),
    cnb().catch(() => { errors.push('Kurz ČNB se nepodařilo načíst, použit odhad.'); return { USD: 23, EUR: 25, date: null }; }),
  ]);
  const days = [];
  if (usage && Array.isArray(usage.time)) {
    const series = Object.values(usage.usage || {});
    usage.time.forEach((t, i) => {
      const credits = series.reduce((a, s) => a + (Number(s[i]) || 0), 0);
      if (credits || days.length) days.push({ day: new Date(t).toISOString().slice(0, 10), credits });
    });
  }
  const out = {
    fetched_at: new Date(now).toISOString(), model: model(env), errors, rates,
    plan: sub && {
      tier: sub.tier, status: sub.status, currency: (sub.currency || (sub.next_invoice && sub.next_invoice.currency) || 'usd').toUpperCase(),
      credits_limit: sub.character_limit, credits_used: sub.character_count, reset_at: sub.next_character_count_reset_unix ? new Date(sub.next_character_count_reset_unix * 1000).toISOString() : null,
      billing_period: sub.billing_period || null,
      next_invoice: sub.next_invoice ? { amount: (sub.next_invoice.amount_due_cents || 0) / 100, at: sub.next_invoice.next_payment_attempt_unix ? new Date(sub.next_invoice.next_payment_attempt_unix * 1000).toISOString() : null } : null,
    },
    days,
  };
  const body = JSON.stringify(out);
  ctx.waitUntil(caches.default.put(cacheKey, new Response(body, { headers: { 'Cache-Control': 'max-age=600' } })));
  return new Response(body, { headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
}
// denní kurz ČNB (text: „země|měna|množství|kód|kurz“)
async function cnb() {
  const t = await (await fetch('https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/denni_kurz.txt')).text();
  const out = { date: t.split('\n')[0].split(' ')[0] };
  for (const line of t.split('\n')) {
    const p = line.split('|');
    if (p.length === 5 && (p[3] === 'USD' || p[3] === 'EUR')) out[p[3]] = Number(p[4].replace(',', '.')) / Number(p[2]);
  }
  if (!out.USD) throw new Error('kurz');
  return out;
}

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
