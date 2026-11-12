// Ospalek – generátor pohádek pro administraci (Supabase Edge Function „story-gen“).
// Text pohádky píše Claude (Anthropic API) tady na serveru. Klíč ANTHROPIC_API_KEY je jen v Secrets Supabase,
// nikdy v repozitáři ani na webu. Pustí jen člena týmu s rolí Vlastník nebo Obsah, přihlášeného i kódem z Google
// Authenticatoru (hlídá to databázová funkce admin_role přes require_staff).
// Funkce nic neukládá: text vrátí administraci, ta ho po kontrole uloží do zásobníku (admin_story_draft_save).
//
// Nasazení: supabase/README.md, část „Generátor pohádek“. Soubor pohadka.js musí být nasazený vedle tohoto.
//
// POST { category, topic, length: 5 | 10 | 15, ages?, pro?, avoid?: ['id – název'], revise?: { id, titleSrc, textSrc, note, problems } }
// → 200 { story, brief } | 503 { code: 'no_key' } když chybí klíč

import Anthropic from 'npm:@anthropic-ai/sdk@1.8.0';
import { generate, readInput } from './pohadka.js';

const ORIGINS = ['https://ospalek.cz', 'https://www.ospalek.cz'];
const cors = (origin: string | null) => ({
  'Access-Control-Allow-Origin': origin && (ORIGINS.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin)) ? origin : ORIGINS[0],
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
});
class Fail extends Error { constructor(public status: number, msg: string, public code = '') { super(msg); } }

// volání databáze jménem přihlášeného člena týmu (jeho token a veřejný klíč z požadavku), bez tajného klíče
async function rpc(req: Request, fn: string, args: Record<string, unknown> = {}) {
  const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: req.headers.get('apikey') || '', Authorization: req.headers.get('authorization') || '', 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Fail(r.status === 401 ? 401 : 403, r.status === 401 ? 'Nejsi přihlášený.' : 'Generovat pohádky smí jen tým s ověřením kódem.');
  return j;
}

Deno.serve(async (req) => {
  const h = { ...cors(req.headers.get('origin')), 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  try {
    if (req.method !== 'POST') throw new Fail(405, 'Jen POST.');
    const role = await rpc(req, 'admin_role');
    if (!['owner', 'content'].includes(role)) throw new Fail(403, 'Generovat pohádky smí jen role Vlastník nebo Obsah.');
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Fail(503, 'Generátor zatím nemá klíč. Ulož ANTHROPIC_API_KEY do Supabase → Edge Functions → Secrets.', 'no_key');

    const input = readInput(await req.json().catch(() => ({})));
    const out = await generate(new Anthropic({ apiKey, timeout: 380_000, maxRetries: 1 }), input);
    // spotřeba do auditu, ať jde dohledat, kolik generování stálo
    await rpc(req, 'admin_log', { action: 'content.generate', target: out.story.id, detail: `${input.length} min · ${out.brief.model} · ${out.brief.usage.input} + ${out.brief.usage.output} tokenů` }).catch(() => {});
    return new Response(JSON.stringify(out), { headers: h });
  } catch (e) {
    let status = e instanceof Fail ? e.status : Number((e as { status?: number }).status) || 500, msg = (e as Error).message, code = e instanceof Fail ? e.code : '';
    if (e instanceof Anthropic.RateLimitError) { status = 429; msg = 'Generátor je teď přetížený. Zkus to za chvíli.'; }
    else if (e instanceof Anthropic.AuthenticationError) { status = 503; code = 'bad_key'; msg = 'Klíč ANTHROPIC_API_KEY v Secrets neplatí. Vlož nový.'; }
    else if (e instanceof Anthropic.APIError) { status = 502; msg = 'Generování se nepovedlo: ' + msg; }
    if (status >= 500) console.error(e);
    return new Response(JSON.stringify({ message: msg, code }), { status, headers: h });
  }
});
