// Zkouška generátoru pohádek bez klíče a bez internetu: SDK posílá požadavek na atrapu Anthropic API,
// která zkontroluje tvar požadavku a vrátí připravenou odpověď. node supabase/test-story-gen.mjs
import http from 'node:http';
import Anthropic from '@anthropic-ai/sdk';
import { generate, readInput } from './functions/story-gen/pohadka.js';

const answer = {
  id: 'Ježek Bodlinka', title: '${c.H} a ježek Bodlinka', cats: ['noc', 'zvirata'], ages_od: 3, ages_do: 6, mood: 'lullaby', pro: 'vse', emoji: '🦔', g1: '#1d2b64', g2: '#6a4c93',
  pozn: 'Ježek se bojí tmy.', pouceni: 'Tma je jen noc bez světla.',
  paragraphs: [{ t: 'Bylo nebylo, ${c.inTown} ${c.g(\'bydlel\', \'bydlela\', \'bydleli\')} ${c.H}.', sfx: 'owl', pause: 0 }, { t: 'Dobrou noc, ${c.h.voc}.', sfx: '', pause: 0 }],
};
let seen = null;
const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
    seen = { url: req.url, beta: req.headers['anthropic-beta'], body: JSON.parse(b) };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } });
    ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: JSON.stringify(answer) } });
    ev('content_block_stop', { index: 0 });
    ev('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 500 } });
    ev('message_stop', {});
    res.end();
  });
}).listen(0);
const client = new Anthropic({ apiKey: 'test', baseURL: `http://localhost:${srv.address().port}` });
const out = await generate(client, readInput({ category: 'noc', topic: 'o ježkovi, který se bál tmy', length: 5 }));
srv.close();
const b = seen.body;
const ok = (c, m) => { if (!c) { console.error('✗ ' + m); process.exitCode = 1; } else console.log('✓ ' + m); };
ok(seen.url.startsWith('/v1/messages'), 'POST /v1/messages ' + seen.url);
ok(b.stream === true && b.model === 'claude-opus-5-5', 'stream, model claude-opus-5-5');
ok(/server-side-fallback-2026-07-01/.test(seen.beta || '') && b.fallbacks === 'default', 'záložní model při odmítnutí');
ok(b.output_config?.format?.type === 'json_schema' && b.output_config.effort === 'medium', 'structured outputs + effort');
ok(b.thinking?.type === 'adaptive', 'adaptive thinking');
ok(out.story.id === 'jezek-bodlinka' && out.story.textSrc.includes("sfx: 'owl'") && out.story.titleSrc === '(c) => `${c.H} a ježek Bodlinka`', 'převod na šablonu');
ok(out.brief.usage.output === 500 && out.brief.model === 'claude-opus-5-5', 'spotřeba a model');
