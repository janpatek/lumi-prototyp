// ---------- Sociální sítě: materiály ke stažení ----------
// Reels, příspěvky na Instagram, profilové obrázky a podklady pro Google Play na jednom místě: náhled,
// texty ke zkopírování a soubory ke stažení. Spravuje vlastník a role Obsah (content.edit).
//  – ostrá data: katalog.json a soubory leží v soukromém úložišti Supabase (bucket marketing, nahrává je
//    node marketing/nahrat.mjs). Číst je smí jen vlastník a role Obsah s kódem (supabase/migrations/20261112_marketing_uloziste.sql),
//    administrace si na ně vyžádá podepsané odkazy platné 6 hodin.
//  – ukázková data a lokální databáze (?db=…): katalog a soubory přímo z ../marketing/ (node marketing/katalog.mjs).
//
// Zveřejnění na Instagram (reels a příspěvky) jde tlačítkem v detailu přes Edge Function instagram
// (supabase/functions/instagram), kde žije i přístupový token. Jen v ostré administraci. Facebook a TikTok zatím ručně.
// Položky mají stálé id (např. reel-jmeno, ig-soutez), podle kterého se vede stav a zveřejněné příspěvky.

const SOC_LOCAL = '../marketing/';
const SOC_TTL = 6 * 3600;
const SOC = { state: 'idle', err: '', k: null, f: 'vse', urls: null, at: 0, used: {}, skryt: false, view: 'materialy' };
const SOC_USED_KEY = 'ospalek.admin.social.used.v1';
const SOC_KANAL = { reels: 'Reels', instagram: 'Instagram', profil: 'Profil', 'google-play': 'Google Play' };
const SOC_SITE = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', 'google-play': 'Google Play' };
const SOC_TAG = { reel: 'honey', karusel: 'sky', 'obrázek': 'mint', 'záznam v obchodě': 'peach' };
const socStorage = () => !!(D.live && !D.dev);
const socUrl = (p) => (SOC.urls ? SOC.urls[p] || '' : SOC_LOCAL + p.split('/').map(encodeURIComponent).join('/'));
// odkaz ke stažení: z úložiště s ?download= (jiný původ, atribut download by prohlížeč ignoroval)
const socDl = (f) => (SOC.urls ? `${socUrl(f.cesta)}&download=${encodeURIComponent(f.nazev)}` : socUrl(f.cesta));
const socMB = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1e3))} kB`);
const socItem = (id) => SOC.k.polozky.find((x) => x.id === id);
// všechny soubory položek k nahrání do úložiště, včetně JPG pro Instagram
const socPaths = (k) => [...new Set(k.polozky.flatMap((it) => [it.nahled, it.video, ...it.obrazky, ...it.soubory.map((f) => f.cesta), ...(it.ig ? [it.ig.cover, ...it.ig.obrazky] : [])]).filter(Boolean))];

ROUTES.splice(ROUTES.findIndex((x) => x.id === 'hlas'), 0, { id: 'socialni', label: 'Sociální sítě', ico: '<svg class="ico" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17 7h0"/></svg>', perm: 'content.edit' });

function socLocal() {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = SOC_LOCAL + 'katalog.js?t=' + Date.now();
    s.onload = () => (window.MARKETING_KATALOG ? res(window.MARKETING_KATALOG) : rej(new Error('Soubor katalog.js je prázdný.')));
    s.onerror = () => rej(new Error('Nenašel se marketing/katalog.js. Vytvoří ho příkaz node marketing/katalog.mjs.'));
    document.body.appendChild(s);
  });
}
// admin_role ověří člena týmu s kódem a případně obnoví přihlášení, token se pak vezme z uloženého přihlášení
async function socAuth() {
  await LIVE.rpc('admin_role');
  let tok = null;
  try { tok = JSON.parse(localStorage.getItem('ospalek.admin.sb.v1')).access_token; } catch (e) {}
  if (!tok) throw new Error('Nejsi přihlášený do databáze.');
  return { base: LIVE.url + '/storage/v1', h: { apikey: window.OSPALEK_CONFIG.supabaseAnonKey, Authorization: 'Bearer ' + tok } };
}
// Nahrání z místní složky marketing/ do úložiště pod přihlášeným členem týmu (jen administrace spuštěná z localhost,
// kde jsou soubory vedle ní). Stejné pravidlo jako čtení: vlastník a role Obsah s kódem.
const SOC_CAN_UPLOAD = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const SOC_UP = { busy: false, done: 0, total: 0, mb: 0, err: '' };
async function socUpload() {
  if (SOC_UP.busy) return;
  Object.assign(SOC_UP, { busy: true, done: 0, total: 0, mb: 0, err: '' });
  const paint = () => { const el = document.getElementById('socUp'); if (el) el.textContent = SOC_UP.err || `Nahrávám ${SOC_UP.done}/${SOC_UP.total} (${SOC_UP.mb.toFixed(0)} MB)…`; };
  render();
  try {
    const r0 = await fetch(SOC_LOCAL + 'katalog.json?t=' + Date.now());
    if (!r0.ok) throw new Error('Nenašel se marketing/katalog.json. Vytvoří ho node marketing/katalog.mjs.');
    const kat = await r0.text();
    const k = JSON.parse(kat);
    const paths = socPaths(k);
    SOC_UP.total = paths.length + 1; paint();
    let a = await socAuth(), at = Date.now();
    const put = async (p, body, type) => {
      if (Date.now() - at > 20 * 60e3) { a = await socAuth(); at = Date.now(); } // přihlášení platí hodinu
      for (let i = 1; ; i++) {
        const r = await fetch(`${a.base}/object/marketing/${p.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', headers: { ...a.h, 'Content-Type': type || 'application/octet-stream', 'x-upsert': 'true', 'Cache-Control': '3600' }, body });
        if (r.ok) return;
        const t = await r.text();
        if (i >= 3 || r.status === 400 || r.status === 403) throw new Error(`${p}: ${r.status} ${t.slice(0, 160)}${/row-level|Unauthorized|403/.test(t) ? ' (je spuštěné SQL s pravidlem pro nahrávání?)' : ''}`);
        await new Promise((res) => setTimeout(res, 1500 * i));
      }
    };
    const queue = [...paths];
    await Promise.all(Array.from({ length: 3 }, async () => {
      while (queue.length) {
        const p = queue.shift();
        const f = await fetch(SOC_LOCAL + p.split('/').map(encodeURIComponent).join('/'));
        if (!f.ok) throw new Error(`Chybí místní soubor ${p}. Přegenerujte katalog.`);
        const blob = await f.blob();
        await put(p, blob, p.endsWith('.txt') ? 'text/plain; charset=utf-8' : blob.type);
        SOC_UP.done++; SOC_UP.mb += blob.size / 1e6; paint();
      }
    }));
    await put('katalog.json', kat, 'application/json');
    SOC_UP.done++;
    toast(`Nahráno ${SOC_UP.done} souborů do úložiště`);
    SOC.state = 'idle'; SOC.urls = null;
  } catch (e) { SOC_UP.err = 'Nahrávání se zastavilo: ' + e.message; }
  SOC_UP.busy = false;
  render();
}
const socUpBtn = () => (SOC_CAN_UPLOAD && socStorage() ? `<div style="margin-top:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button class="btn sm" data-a="socUpload"${SOC_UP.busy ? ' disabled' : ''}>${I.down}Nahrát z místní složky do úložiště</button><span class="${SOC_UP.err ? 'err' : 'muted'}" id="socUp">${esc(SOC_UP.err || (SOC_UP.busy ? `Nahrávám ${SOC_UP.done}/${SOC_UP.total}…` : 'Nahraje nové materiály z marketing/ pod vaším přihlášením.'))}</span></div>` : '');
async function socRemote() {
  const { base, h } = await socAuth();
  const r = await fetch(`${base}/object/authenticated/marketing/katalog.json?t=${Date.now()}`, { headers: h });
  if (!r.ok) {
    throw new Error(r.status === 400 || r.status === 404
      ? 'V úložišti zatím nic není. Soubory nahraje node marketing/nahrat.mjs (a jednou migrace supabase/migrations/20261112_marketing_uloziste.sql).'
      : `Úložiště odmítlo katalog (${r.status}). Číst ho smí vlastník a role Obsah.`);
  }
  const k = await r.json();
  const paths = [...new Set(k.polozky.flatMap((it) => [it.nahled, it.video, ...it.obrazky, ...it.soubory.map((f) => f.cesta)]).filter(Boolean))];
  const sr = await fetch(`${base}/object/sign/marketing`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: SOC_TTL, paths }) });
  const signed = await sr.json().catch(() => null);
  if (!sr.ok || !Array.isArray(signed)) throw new Error('Nepodařilo se získat odkazy na soubory (' + sr.status + ').');
  SOC.urls = Object.fromEntries(signed.filter((x) => x.signedURL).map((x) => [x.path, base + x.signedURL]));
  return k;
}
// ---------- Použité materiály (zaškrtnutí) ----------
// Ostrá data: stav.json v úložišti marketing, sdílený celým týmem ({ id: { at, by } }). Před každým zápisem se
// načte znovu, aby se nepřepsalo, co mezitím zaškrtl kolega. Ukázková data: jen v tomhle prohlížeči.
async function socUsedGet(a) {
  const r = await fetch(`${a.base}/object/authenticated/marketing/stav.json?t=${Date.now()}`, { headers: a.h });
  if (r.status === 400 || r.status === 404) return {};
  if (!r.ok) throw new Error('Stav použitých materiálů se nenačetl (' + r.status + ').');
  return (await r.json()).used || {};
}
async function socMark(id, on) {
  const by = (API.me && API.me.name) || '';
  const apply = (u) => { if (on) u[id] = { at: new Date().toISOString(), by }; else delete u[id]; return u; };
  if (!socStorage()) { SOC.used = apply({ ...(store.get(SOC_USED_KEY) || {}) }); store.set(SOC_USED_KEY, SOC.used); return; }
  const a = await socAuth();
  const used = apply(await socUsedGet(a));
  const r = await fetch(`${a.base}/object/marketing/stav.json`, { method: 'POST', headers: { ...a.h, 'Content-Type': 'application/json', 'x-upsert': 'true', 'Cache-Control': '0' }, body: JSON.stringify({ used }) });
  if (!r.ok) throw new Error('Zaškrtnutí se neuložilo (' + r.status + ').');
  SOC.used = used;
}
const socUsedLabel = (u) => (u ? `Použito ${new Date(u.at).toLocaleDateString('cs-CZ')}${u.by ? ` · ${u.by}` : ''}` : 'Použito');

// ---------- Zveřejnění na Instagram (Edge Function instagram) ----------
// Token Instagramu zná jen funkce. Administrace jí posílá id materiálu a popisek, funkce si soubory podepíše sama.
const IG = { state: 'idle', d: null, err: '', busy: false };
const IG_MISSING = 'Funkce instagram v Supabase ještě není nasazená (postup v supabase/README.md, Zveřejňování na Instagram).';
async function igCall(akce, body) {
  const a = await socAuth();
  let r;
  try { r = await fetch(`${LIVE.url}/functions/v1/instagram/${akce}`, { method: 'POST', headers: { ...a.h, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); }
  catch (e) { throw new Error(IG_MISSING); } // nenasazená funkce odpoví bez CORS hlaviček, prohlížeč to hlásí jako síťovou chybu
  const j = await r.json().catch(() => ({}));
  if (r.status === 404 && !j.message) throw new Error(IG_MISSING);
  if (!r.ok) throw new Error(j.message || `Funkce instagram odpověděla ${r.status}.`);
  return j;
}
function loadIg() {
  if (!socStorage() || IG.state !== 'idle') return;
  IG.state = 'loading';
  igCall('stav').then((d) => { IG.d = d; IG.state = 'ok'; }, (e) => { IG.state = 'err'; IG.err = e.message; IG.d = null; })
    .then(() => { if (route() === 'socialni' && !$('#modal .dialog')) render(); });
}
const igUsed = (id) => (SOC.used[id] && typeof SOC.used[id].ig === 'string' ? SOC.used[id].ig : '');
const igLink = (id, cls) => (igUsed(id) ? `<a class="${cls}" href="${esc(igUsed(id))}" target="_blank" rel="noopener">na Instagramu ↗</a>` : '');
function igBar() {
  if (!socStorage()) return '';
  const d = IG.d, uri = d ? `<span>Adresa pro přesměrování v aplikaci Meta: <code>${esc(d.presmerovani)}</code></span><button class="btn white sm" data-a="igCopyUri">${I.copy}Zkopírovat</button>` : '';
  let body;
  if (IG.state === 'loading' || IG.state === 'idle') body = '<span class="muted">Instagram: zjišťuji propojení…</span>';
  else if (IG.state === 'err') body = `<b>Instagram</b><span class="muted">${esc(IG.err)}</span><button class="btn white sm" data-a="igReload">Zkusit znovu</button>`;
  else if (!d.nastaveno) body = `<b>Instagram</b><span class="muted">V Supabase → Edge Functions → Secrets chybí IG_APP_ID a IG_APP_SECRET.</span>${uri}`;
  else if (!d.propojeno) body = `<b>Instagram</b><span class="muted">${d.vyprsel ? 'Propojení vypršelo (Meta ho po 90 dnech chce obnovit).' : 'Není propojený.'}</span><button class="btn sm" data-a="igConnect">Propojit Instagram</button>${uri}`;
  else body = `<b>Instagram @${esc(d.username)}</b><span class="muted">propojený, propojení obnovte do ${new Date(d.expires_at).toLocaleDateString('cs-CZ')}</span><button class="btn white sm" data-a="igDisconnect">Odpojit</button>`;
  return `<section class="panel soc-ig">${body}</section>`;
}
const IG_TYP = { REELS: 'Reel (video)', CAROUSEL: 'Karusel', IMAGE: 'Obrázek' };
const igProblems = (t) => [
  t.length > 2200 && `Popisek má ${t.length} znaků, Instagram povolí nejvýš 2200.`,
  (t.match(/#[^\s#]+/g) || []).length > 30 && 'Instagram povolí nejvýš 30 hashtagů.',
  /\[[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ ]+\]/.test(t) && 'V popisku jsou zástupné texty v hranatých závorkách, doplňte je.',
  !t.trim() && 'Popisek je prázdný.',
].filter(Boolean);
function igCompose(id) {
  const it = socItem(id);
  if (!it || !it.ig) return;
  const ig = it.ig, u = SOC.used[id];
  const thumbs = (ig.typ === 'REELS' ? [it.nahled] : it.obrazky).map((p) => `<img src="${socUrl(p)}" alt="">`).join('');
  modal(`<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="igT">
    <div class="dialog-head"><h2 id="igT">Zveřejnit na Instagramu</h2><button class="x" data-a="close" aria-label="Zavřít">×</button></div>
    <div class="dialog-body">
      <p class="muted" style="margin-bottom:10px">${esc(`${it.n ? it.n + '. ' : ''}${it.title}`)} · ${IG_TYP[ig.typ]}${ig.typ === 'CAROUSEL' ? `, ${ig.obrazky.length} snímků` : ''} · účet @${esc(IG.d.username)}</p>
      <div class="ig-sum">${thumbs}</div>
      ${u ? `<div class="soc-warn">Tenhle materiál už je označený jako použitý (${esc(socUsedLabel(u))}${igUsed(id) ? ', zveřejněný přes administraci' : ''}). Zveřejněním vznikne další příspěvek.</div>` : ''}
      <label for="igText" style="font-weight:800;font-size:13px;display:block;margin-bottom:6px">Popisek</label>
      <textarea id="igText">${esc(it.texty[0] ? it.texty[0].text : '')}</textarea>
      <div class="ig-count"><span id="igProb" class="bad"></span><span id="igCount"></span></div>
      <p class="muted" style="font-size:13px;margin-top:10px">Příspěvek se zveřejní hned. Hudbu z knihovny Instagramu ani označení lidí přes API přidat nejde, upravit popisek jde i potom v aplikaci Instagram.</p>
    </div>
    <div class="dialog-foot"><div id="igStatus" class="muted"></div><div class="r"><button class="btn white" data-a="close">Zrušit</button><button class="btn" id="igGo" data-a="igGo" data-v="${esc(id)}">Zveřejnit teď</button></div></div>
  </div>`);
  const ta = $('#igText'), upd = () => {
    const t = ta.value, pr = igProblems(t);
    $('#igCount').textContent = `${t.length}/2200 znaků · ${(t.match(/#[^\s#]+/g) || []).length}/30 hashtagů`;
    $('#igProb').textContent = pr[0] || '';
    $('#igGo').disabled = !!pr.length || IG.busy;
  };
  ta.addEventListener('input', upd); upd();
}
async function igPublish(id) {
  const t = $('#igText').value.trim(), it = socItem(id);
  if (IG.busy || igProblems(t).length) return;
  IG.busy = true;
  const st = (m, err) => { const el = $('#igStatus'); if (el) { el.textContent = m; el.className = err ? 'err' : 'muted'; } };
  $('#igGo').disabled = true; $('#igText').readOnly = true;
  try {
    st('Posílám na Instagram…');
    const k = await igCall('zverejnit', { id, popisek: t });
    const t0 = Date.now();
    let r;
    for (;;) {
      await new Promise((res) => setTimeout(res, k.typ === 'REELS' ? 5000 : 2000));
      r = await igCall('dokoncit', { kontejner: k.kontejner, id, typ: k.typ, popisek: t });
      if (!r.ceka) break;
      const s = Math.round((Date.now() - t0) / 1000);
      if (s > 15 * 60) throw new Error('Instagram video zpracovává přes 15 minut. Zkontrolujte účet v aplikaci, případně to zkuste znovu.');
      st(`Instagram zpracovává ${k.typ === 'REELS' ? 'video' : 'obrázky'}… ${s} s`);
    }
    if (r.used) SOC.used = r.used;
    IG.busy = false;
    render();
    modal(`<div class="dialog narrow" role="dialog" aria-modal="true" aria-labelledby="igOk">
      <div class="dialog-head"><h2 id="igOk">Zveřejněno na Instagramu</h2><button class="x" data-a="close" aria-label="Zavřít">×</button></div>
      <div class="dialog-body"><p>${esc(it.title)} je venku a v seznamu je označený jako použitý.</p></div>
      <div class="dialog-foot"><div class="r"><button class="btn white" data-a="close">Zavřít</button>${r.permalink ? `<a class="btn" href="${esc(r.permalink)}" target="_blank" rel="noopener">Otevřít na Instagramu ↗</a>` : ''}</div></div></div>`);
    toast('Zveřejněno na Instagramu');
  } catch (e) {
    IG.busy = false;
    st(e.message, true);
    if (!$('#igStatus')) toast(e.message);
    const go = $('#igGo'); if (go) go.disabled = false;
    const ta = $('#igText'); if (ta) ta.readOnly = false;
  }
}
// návrat z přihlášení do Instagramu: ?ig=ok nebo ?ig=chyba&zprava=…
(() => {
  const q = new URLSearchParams(location.search);
  if (!q.has('ig')) return;
  const ok = q.get('ig') === 'ok', msg = q.get('zprava') || '';
  history.replaceState(null, '', location.pathname + location.hash);
  setTimeout(() => toast(ok ? 'Instagram je propojený' : 'Propojení s Instagramem se nepovedlo: ' + msg), 800);
})();

function loadSoc() {
  // podepsané odkazy platí 6 hodin, po 5 hodinách se katalog načte znovu
  if (SOC.state === 'ok' && SOC.urls && Date.now() - SOC.at > (SOC_TTL - 3600) * 1000) SOC.state = 'idle';
  if (SOC.state !== 'idle') return;
  SOC.state = 'loading';
  (socStorage() ? socRemote() : socLocal()).then(async (k) => { SOC.used = socStorage() ? await socUsedGet(await socAuth()) : store.get(SOC_USED_KEY) || {}; SOC.k = k; SOC.state = 'ok'; SOC.err = ''; SOC.at = Date.now(); }, (e) => { SOC.state = 'err'; SOC.err = e.message; SOC.urls = null; })
    .then(() => { if (route() === 'socialni') render(); });
}

function socStyle() {
  if (document.getElementById('socStyle')) return;
  document.head.insertAdjacentHTML('beforeend', `<style id="socStyle">
    .soc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 16px; margin-top: 16px; }
    .soc-card { display: flex; flex-direction: column; gap: 8px; padding: 12px; }
    .soc-thumb { display: block; position: relative; border-radius: var(--radius-sm); overflow: hidden; background: var(--line); aspect-ratio: 4 / 5; cursor: pointer; padding: 0; width: 100%; }
    .soc-thumb.w { aspect-ratio: 16 / 9; }
    .soc-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .soc-thumb .play { position: absolute; left: 10px; bottom: 10px; width: 34px; height: 34px; border-radius: 50%; background: rgba(20, 20, 40, .6); display: grid; place-items: center; }
    .soc-thumb .play::after { content: ""; border-left: 12px solid #fff; border-top: 7px solid transparent; border-bottom: 7px solid transparent; margin-left: 3px; }
    .soc-card h3 { font-size: 15px; line-height: 1.3; }
    .soc-card .meta { font-size: 12px; color: var(--ink-muted); display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .soc-card .acts { display: flex; gap: 6px; margin-top: auto; flex-wrap: wrap; }
    .soc-detail { display: grid; grid-template-columns: minmax(220px, 340px) 1fr; gap: 20px; align-items: start; }
    .soc-media video, .soc-media > img { width: 100%; border-radius: var(--radius-sm); display: block; background: #1C1E33; }
    .soc-strip { display: flex; gap: 6px; margin-top: 8px; overflow-x: auto; }
    .soc-strip button { flex: none; width: 54px; border-radius: 8px; overflow: hidden; padding: 0; opacity: .6; }
    .soc-strip button.on { opacity: 1; box-shadow: 0 0 0 2px var(--lavender-ink); }
    .soc-strip img { width: 100%; display: block; }
    .soc-text { margin-bottom: 14px; }
    .soc-text .lbl { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-weight: 800; font-size: 13px; margin-bottom: 6px; }
    .soc-text pre { white-space: pre-wrap; font: inherit; font-size: 14px; background: var(--surface-raised); border: 2px solid var(--line); border-radius: var(--radius-sm); padding: 10px 12px; max-height: 260px; overflow: auto; margin: 0; }
    .soc-files { display: grid; gap: 6px; }
    .soc-files a { display: flex; justify-content: space-between; gap: 10px; padding: 8px 12px; border-radius: var(--radius-sm); background: var(--surface-raised); border: 2px solid var(--line); color: var(--ink); text-decoration: none; font-size: 13px; font-weight: 700; }
    .soc-files a span { color: var(--ink-muted); font-weight: 600; white-space: nowrap; }
    .soc-warn { background: var(--peach); color: var(--on-pastel); border-radius: var(--radius-sm); padding: 10px 12px; font-weight: 700; font-size: 13px; margin-bottom: 12px; }
    .soc-card.used .soc-thumb img { opacity: .4; filter: grayscale(.6); }
    .soc-card.used .soc-thumb::after { content: "✓"; position: absolute; inset: 0; display: grid; place-items: center; font-size: 64px; font-weight: 900; color: var(--lavender-ink); text-shadow: 0 2px 12px rgba(255,255,255,.6); }
    .soc-check { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 800; cursor: pointer; user-select: none; padding: 6px 2px 0; border-top: 2px dashed var(--line); }
    .soc-check input { width: 18px; height: 18px; margin: 0; }
    .soc-card.used .soc-check { color: var(--lavender-ink); }
    .soc-filter label { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; color: var(--ink-muted); cursor: pointer; }
    .soc-filter label input { width: auto; margin: 0; }
    .soc-filter .seg { max-width: 100%; overflow-x: auto; }
    .soc-ig { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 14px; padding: 10px 14px; font-size: 13px; }
    .soc-ig b { font-weight: 800; }
    .soc-ig code { font-size: 12px; word-break: break-all; }
    .ig-sum { display: flex; gap: 6px; overflow-x: auto; margin-bottom: 12px; }
    .ig-sum img { height: 96px; border-radius: 8px; flex: none; }
    #igText { font-family: inherit; font-size: 14px; min-height: 220px; }
    .ig-count { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; color: var(--ink-muted); margin-top: 6px; }
    .ig-count .bad { color: var(--danger, #c0392b); font-weight: 800; }
    .soc-profile { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
    @media (max-width: 720px) { .soc-detail { grid-template-columns: 1fr; } .soc-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); } }
  </style>`);
}

const socPlan = (p) => (p ? `Týden ${p.week} · ${p.day} ${p.time}` : '');
const socTexts = (texty, pre) => texty.map((t, i) => `<div class="soc-text"><div class="lbl"><span>${esc(t.nazev)}</span><button class="btn white sm" data-a="socCopy" data-v="${pre}:${i}">${I.copy}Zkopírovat</button></div><pre>${esc(t.text)}</pre></div>`).join('');

function pageSoc() {
  socStyle();
  loadSoc();
  loadIg();
  const top = (sub = '') => head('Sociální sítě', sub || 'Reels, příspěvky, profil a podklady pro Google Play ke stažení');
  if (SOC.state === 'loading' || SOC.state === 'idle') return `${top()}<section class="panel"><p class="muted">Načítám katalog…</p></section>`;
  if (SOC.state === 'err') return `${top()}<section class="panel"><h2>Katalog se nenačetl</h2><p class="err">${esc(SOC.err)}</p><button class="btn white sm" data-a="socReload">Zkusit znovu</button>${socUpBtn()}</section>`;
  // záložky Materiály / Kalendář (kalendář je v socialni-kalendar.js)
  const tabs = PAGES.socialniKalendar ? `<div class="seg" style="margin-top:4px">${[['materialy', 'Materiály'], ['kalendar', 'Kalendář']].map(([v, l]) => `<button data-a="socView" data-v="${v}" class="${SOC.view === v ? 'on' : ''}">${l}</button>`).join('')}</div>` : '';
  if (SOC.view === 'kalendar' && PAGES.socialniKalendar) return PAGES.socialniKalendar(top, tabs);
  const K = SOC.k, all = K.polozky;
  const total = all.reduce((a, it) => a + it.soubory.reduce((b, f) => b + f.velikost, 0), 0);
  const usedN = all.filter((it) => SOC.used[it.id]).length;
  const list = all.filter((it) => (SOC.f === 'vse' || it.kanal === SOC.f) && !(SOC.skryt && SOC.used[it.id]))
    .sort((a, b) => (SOC.f === 'vse' && a.plan && b.plan ? a.plan.week - b.plan.week || 'PoÚtStČtPáSoNe'.indexOf(a.plan.day) - 'PoÚtStČtPáSoNe'.indexOf(b.plan.day) : 0));
  const counts = Object.fromEntries(Object.keys(SOC_KANAL).map((k) => [k, all.filter((x) => x.kanal === k).length]));
  const seg = `<div class="seg">${[['vse', `Vše ${all.length}`], ...Object.entries(SOC_KANAL).map(([k, l]) => [k, `${l} ${counts[k]}`])].map(([v, l]) => `<button data-a="socFilter" data-v="${v}" class="${SOC.f === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const profile = SOC.f === 'profil' ? `<section class="panel" style="margin-top:16px"><div class="panel-head"><h2>Texty profilu</h2><span class="muted">${esc(K.profil.handle)} na Instagramu, TikToku i Facebooku</span></div><div class="soc-profile">${socTexts(K.profil.texty, 'profil')}</div></section>` : '';
  const card = (it) => `<article class="panel soc-card${SOC.used[it.id] ? ' used' : ''}">
      <button class="soc-thumb${it.kanal === 'google-play' || it.id.includes('facebook-cover') ? ' w' : ''}" data-a="socOpen" data-v="${esc(it.id)}" aria-label="Detail: ${esc(it.title)}"><img src="${socUrl(it.nahled)}" alt="" loading="lazy">${it.video ? '<span class="play"></span>' : ''}</button>
      <div class="meta"><span class="tag ${SOC_TAG[it.format] || 'line'}">${esc(it.format)}</span>${it.plan ? `<span>${socPlan(it.plan)}</span>` : ''}${it.pozor ? '<span class="tag peach">doplnit</span>' : ''}${igLink(it.id, 'tag mint')}</div>
      <h3>${it.n ? `${it.n}. ` : ''}${esc(it.title)}</h3>
      <div class="meta">${it.site.map((s) => SOC_SITE[s]).join(' · ')}</div>
      <div class="acts"><button class="btn sm" data-a="socOpen" data-v="${esc(it.id)}">Detail a texty</button><a class="btn white sm" href="${socDl(it.soubory[0])}" download="${esc(it.soubory[0].nazev)}">${I.down}${it.video ? 'MP4' : 'Stáhnout'}</a></div>
      <label class="soc-check" title="Zaškrtněte, až materiál zveřejníte"><input type="checkbox" data-soc-used="${esc(it.id)}"${SOC.used[it.id] ? ' checked' : ''}>${esc(socUsedLabel(SOC.used[it.id]))}</label>
    </article>`;
  return `${top(`${all.length} materiálů · použito ${usedN} · ${socMB(total)} · katalog z ${new Date(K.vygenerovano).toLocaleDateString('cs-CZ')}`)}
    ${tabs}
    <div class="head-actions soc-filter">${seg}<label><input type="checkbox" data-soc-skryt${SOC.skryt ? ' checked' : ''}>Skrýt použité</label></div>
    ${igBar()}
    ${profile}
    <div class="soc-grid">${list.map(card).join('')}</div>
    <p class="muted" style="margin-top:18px;font-size:13px">${socStorage() ? 'Reels a příspěvky jde zveřejnit na Instagram tlačítkem v detailu, nebo je v Kalendáři naplánovat na Instagram a Facebook. Na TikTok' : 'Zveřejnění na Instagram tlačítkem funguje jen v ostré administraci. Jinak'} se zveřejňuje ručně: stáhněte soubor, zkopírujte popisek a nahrajte ho v aplikaci sítě. ${socStorage() ? 'Soubory jsou v soukromém úložišti Supabase, odkazy platí 6 hodin. Nové materiály se tu objeví po <code>node marketing/katalog.mjs</code> a nahrání (tlačítko v administraci spuštěné z localhost, nebo <code>node marketing/nahrat.mjs</code>).' : 'Ukázková data: soubory jsou z místní složky marketing/ (v gitu nejsou). Nové materiály se tu objeví po <code>node marketing/katalog.mjs</code>.'}</p>${socUpBtn()}`;
}

function socOpen(id) {
  const it = socItem(id);
  if (!it) return;
  const media = it.video
    ? `<video src="${socUrl(it.video)}" poster="${socUrl(it.nahled)}" controls playsinline preload="metadata"></video>`
    : `<img id="socBig" src="${socUrl(it.obrazky[0] || it.nahled)}" alt="">${it.obrazky.length > 1 ? `<div class="soc-strip">${it.obrazky.map((p, i) => `<button class="${i ? '' : 'on'}" data-a="socSlide" data-v="${esc(p)}" aria-label="Snímek ${i + 1}"><img src="${socUrl(p)}" alt=""></button>`).join('')}</div>` : ''}`;
  const all = it.soubory.length > 1 ? `<button class="btn sm" data-a="socAll" data-v="${esc(it.id)}">${I.down}Stáhnout vše (${it.soubory.length})</button>` : '';
  modal(`<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="socT">
    <div class="dialog-head"><h2 id="socT">${it.n ? `${it.n}. ` : ''}${esc(it.title)}</h2><button class="x" data-a="close" aria-label="Zavřít">×</button></div>
    <div class="dialog-body"><div class="soc-detail">
      <div class="soc-media">${media}</div>
      <div>
        <p class="muted" style="margin-bottom:12px">${[SOC_KANAL[it.kanal], it.format, socPlan(it.plan), it.site.map((s) => SOC_SITE[s]).join(', ')].filter(Boolean).map(esc).join(' · ')}${it.popis ? `<br>${esc(it.popis)}` : ''}</p>
        ${it.pozor ? `<div class="soc-warn">${esc(it.pozor)}</div>` : ''}
        ${socTexts(it.texty, it.id)}
        ${it.tip ? `<p style="margin-bottom:14px"><b>Tip:</b> ${esc(it.tip)}</p>` : ''}
        <div class="panel-head" style="margin-bottom:8px"><h2>Soubory</h2>${all}</div>
        <div class="soc-files">${it.soubory.map((f) => `<a href="${socDl(f)}" download="${esc(f.nazev)}">${esc(f.nazev)}<span>${socMB(f.velikost)}</span></a>`).join('')}</div>
      </div>
    </div></div>
    <div class="dialog-foot"><label class="soc-check" style="border:0;padding:0"><input type="checkbox" data-soc-used="${esc(it.id)}"${SOC.used[it.id] ? ' checked' : ''}>${esc(socUsedLabel(SOC.used[it.id]))}</label>${igLink(it.id, 'link')}<div class="r"><button class="btn white" data-a="close">Zavřít</button>${it.ig && PAGES.socialniKalendar ? `<button class="btn white" data-a="calSchedule" data-v="${esc(it.id)}">Naplánovat</button>` : ''}${it.ig && socStorage() ? `<button class="btn" data-a="igCompose" data-v="${esc(it.id)}"${IG.d && IG.d.propojeno ? '' : ' disabled title="Nejdřív propojte Instagram (nad seznamem materiálů)"'}>Zveřejnit na Instagramu</button>` : ''}</div></div>
  </div>`);
}

PAGES.socialni = pageSoc;
Object.assign(ACTIONS, {
  socFilter: (v) => { SOC.f = v; render(); },
  socView: (v) => { SOC.view = v; render(); },
  socUpload: () => socUpload(),
  socReload: () => { SOC.state = 'idle'; SOC.urls = null; IG.state = 'idle'; if (typeof CAL !== 'undefined') CAL.state = 'idle'; render(); },
  igReload: () => { IG.state = 'idle'; render(); },
  igCopyUri: () => copy(IG.d.presmerovani, 'Adresa pro přesměrování: zkopírováno'),
  igConnect: async () => {
    try { location.href = (await igCall('propojit', { navrat: location.origin + location.pathname })).url; } catch (e) { toast(e.message); }
  },
  igDisconnect: () => confirmBox('Odpojit Instagram?', 'Administrace zapomene přihlášení k účtu @' + esc(IG.d.username) + '. Zveřejněné příspěvky zůstanou, znovu propojit jde kdykoli.', 'Odpojit', async () => {
    try { await igCall('odpojit'); toast('Instagram odpojený'); } catch (e) { toast(e.message); }
    IG.state = 'idle'; render();
  }),
  igCompose: (v) => igCompose(v),
  igGo: (v) => igPublish(v),
  socOpen: (v) => socOpen(v),
  socSlide: (v, t) => { $('#socBig').src = socUrl(v); t.parentNode.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === t)); },
  socCopy: (v) => {
    const [id, i] = [v.slice(0, v.lastIndexOf(':')), Number(v.slice(v.lastIndexOf(':') + 1))];
    const t = id === 'profil' ? SOC.k.profil.texty[i] : socItem(id).texty[i];
    copy(t.text, `${t.nazev}: zkopírováno`);
  },
  // prohlížeč stáhne soubory jeden po druhém (napoprvé se může zeptat, jestli povolit víc stažení)
  socAll: async (v) => {
    const it = socItem(v);
    for (const f of it.soubory) {
      const a = document.createElement('a'); a.href = socDl(f); a.download = f.nazev; document.body.append(a); a.click(); a.remove();
      await new Promise((r) => setTimeout(r, 400));
    }
    toast(`Stahuje se ${it.soubory.length} souborů`);
  },
});

// zaškrtnutí „Použito“ (na kartě i v detailu) a přepínač Skrýt použité
document.addEventListener('change', async (ev) => {
  const t = ev.target;
  if (t.matches('[data-soc-skryt]')) { SOC.skryt = t.checked; render(); return; }
  if (!t.matches('[data-soc-used]')) return;
  const id = t.dataset.socUsed, on = t.checked;
  t.disabled = true;
  try {
    await socMark(id, on);
    toast(on ? 'Označeno jako použité' : 'Zaškrtnutí zrušeno');
  } catch (e) { toast(e.message); }
  const inModal = !!t.closest('.dialog');
  render();
  if (inModal) socOpen(id);
});

