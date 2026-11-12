// Ospalek – administrace: kalendář sociálních sítí (záložka Kalendář v Sociálních sítích, navazuje na socialni-site.js).
// Tým naplánuje materiál z katalogu na den a čas a zaškrtne sítě. Ostrá data: tabulka socialni_plan v Supabase
// (supabase/migrations/20261114_socialni_kalendar.sql), v zadaný čas ji zveřejní Edge Function instagram (/cron,
// spouští pg_cron každou minutu): Instagram a facebooková stránka automaticky, TikTok kalendář jen připomene.
// Ukázková data: plán je jen v tomhle prohlížeči a nic se nezveřejňuje.

const CAL_KEY = 'ospalek.admin.social.plan.v1';
const CAL = { state: 'idle', rows: [], err: '', mesic: null, busy: false };
const CAL_SITE = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok' };
const CAL_STAV = { naplanovano: ['Naplánováno', 'sky'], zpracovava: ['Zveřejňuje se', 'honey'], hotovo: ['Zveřejněno', 'mint'], chyba: ['Chyba', 'peach'] };
const CAL_SIT_STAV = { ceka: 'čeká', zpracovava: 'Instagram zpracovává video', hotovo: 'zveřejněno', chyba: 'chyba', rucne: 'nahrát ručně' };
const CAL_DNY = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];
const CAL_MESICE = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];

const pad2 = (n) => String(n).padStart(2, '0');
const calDay = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; // místní datum YYYY-MM-DD
const calTime = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const calItems = () => (SOC.k ? SOC.k.polozky.filter((it) => it.ig) : []);
const calTitle = (it) => (it ? `${it.n ? it.n + '. ' : ''}${it.title}` : 'Materiál už v katalogu není');
const calWhen = (iso) => new Date(iso).toLocaleString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

// ---------- data ----------
async function calRest(method, q, body) {
  const a = await socAuth();
  const r = await fetch(`${LIVE.url}/rest/v1/socialni_plan${q}`, {
    method, headers: { ...a.h, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const m = (j && j.message) || String(r.status);
    throw new Error(/socialni_plan/.test(m) && /exist|schema cache/.test(m)
      ? 'V databázi chybí kalendář. Spusťte jednou migraci supabase/migrations/20261114_socialni_kalendar.sql.'
      : 'Kalendář: ' + m);
  }
  return j;
}
const calLocal = () => store.get(CAL_KEY) || [];
function calLoad() {
  if (CAL.state !== 'idle') return;
  CAL.state = 'loading';
  const since = new Date(Date.now() - 120 * 864e5).toISOString();
  (socStorage() ? calRest('GET', `?select=*&kdy=gte.${since}&order=kdy`) : Promise.resolve(calLocal()))
    .then((rows) => { CAL.rows = rows; CAL.state = 'ok'; CAL.err = ''; }, (e) => { CAL.state = 'err'; CAL.err = e.message; })
    .then(() => { if (route() === 'socialni' && SOC.view === 'kalendar' && !$('#modal .dialog')) render(); });
}
async function calInsert(rows) {
  if (!socStorage()) {
    let id = Math.max(0, ...calLocal().map((r) => r.id));
    store.set(CAL_KEY, [...calLocal(), ...rows.map((r) => ({ ...r, id: ++id, stav: 'naplanovano', vysledky: {} }))]);
    return;
  }
  await calRest('POST', '', rows);
}
async function calPatch(id, patch) {
  if (!socStorage()) { store.set(CAL_KEY, calLocal().map((r) => (r.id === id ? { ...r, ...patch } : r))); return; }
  const got = await calRest('PATCH', `?id=eq.${id}`, { ...patch, updated_at: new Date().toISOString() });
  if (!got.length) throw new Error('Příspěvek se právě zveřejňuje, upravit ani smazat ho teď nejde.');
}
async function calDelete(id) {
  if (!socStorage()) { store.set(CAL_KEY, calLocal().filter((r) => r.id !== id)); return; }
  const got = await calRest('DELETE', `?id=eq.${id}`);
  if (!got.length) throw new Error('Příspěvek se právě zveřejňuje, smazat ho teď nejde.');
}
const calReload = () => { CAL.state = 'idle'; render(); };

// ---------- sítě, které jde zaškrtnout ----------
function calNets() {
  const live = socStorage(), d = IG.d || {};
  return {
    instagram: !live ? '' : !d.propojeno ? 'Instagram není propojený (nahoře v Sociálních sítích).' : '',
    facebook: !live ? '' : !d.propojeno ? 'Instagram není propojený.' : !(d.facebook && d.facebook.muze) ? 'Pro Facebook propojte Instagram znovu a povolte všechna oprávnění.' : '',
    tiktok: '',
  };
}
const calProblems = (t, site) => (site.some((s) => s !== 'tiktok') ? igProblems(t) : []);

// ---------- stránka ----------
function calStyle() {
  if (document.getElementById('calStyle')) return;
  document.head.insertAdjacentHTML('beforeend', `<style id="calStyle">
    .cal-nav { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 16px; }
    .cal-nav h2 { min-width: 170px; text-align: center; font-size: 18px; }
    .cal-nav .sp { flex: 1; }
    .cal-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; margin-top: 12px; }
    .cal-dn { font-size: 12px; font-weight: 800; color: var(--ink-muted); text-align: center; padding: 4px 0; }
    .cal-cell { min-height: 112px; background: var(--surface-raised); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 6px; display: flex; flex-direction: column; gap: 4px; cursor: pointer; text-align: left; font: inherit; color: inherit; }
    .cal-cell:hover { border-color: var(--lavender); }
    .cal-cell.out { opacity: .45; }
    .cal-cell.today { box-shadow: inset 0 0 0 2px var(--lavender); }
    .cal-cell.past { background: transparent; }
    .cal-cell .d { font-size: 12px; font-weight: 800; }
    .cal-ev { display: block; width: 100%; border: 0; color: var(--on-pastel); border-radius: 8px; padding: 4px 6px; font: inherit; font-size: 12px; line-height: 1.25; text-align: left; cursor: pointer; overflow: hidden; }
    .cal-ev b { font-weight: 800; }
    .cal-ev .s { display: block; font-size: 11px; opacity: .8; }
    .cal-ev.sky { background: var(--sky); } .cal-ev.honey { background: var(--honey); } .cal-ev.mint { background: var(--mint); } .cal-ev.peach { background: var(--peach); }
    .cal-list { margin-top: 18px; }
    .cal-row { display: flex; gap: 12px; align-items: center; padding: 10px 0; border-top: 1px solid var(--line); flex-wrap: wrap; }
    .cal-row .w { min-width: 130px; font-weight: 800; font-size: 13px; }
    .cal-row .t { flex: 1; min-width: 180px; }
    .cal-form label.f { display: block; font-weight: 800; font-size: 13px; margin: 12px 0 6px; }
    .cal-form input[type=date], .cal-form input[type=time] { width: auto; }
    .cal-when { display: flex; gap: 10px; flex-wrap: wrap; }
    .cal-nets { display: flex; flex-direction: column; gap: 6px; }
    .cal-nets input { width: auto; }
    .cal-nets label { display: flex; gap: 8px; align-items: baseline; font-size: 14px; }
    .cal-nets small { color: var(--ink-muted); }
    #calText { min-height: 160px; resize: vertical; }
    .cal-res { margin: 10px 0; display: flex; flex-direction: column; gap: 6px; }
    .cal-res div { font-size: 14px; }
    @media (max-width: 760px) { .cal-grid { display: none; } }
  </style>`);
}

function pageCal(top, tabs) {
  calStyle();
  calLoad();
  if (!CAL.mesic) { const n = new Date(); CAL.mesic = new Date(n.getFullYear(), n.getMonth(), 1); }
  if (CAL.state === 'loading' || CAL.state === 'idle') return `${top()}${tabs}<section class="panel" style="margin-top:16px"><p class="muted">Načítám kalendář…</p></section>`;
  if (CAL.state === 'err') return `${top()}${tabs}<section class="panel" style="margin-top:16px"><h2>Kalendář se nenačetl</h2><p class="err">${esc(CAL.err)}</p><button class="btn white sm" data-a="calReload">Zkusit znovu</button></section>`;
  const m = CAL.mesic, today = calDay(new Date());
  const first = new Date(m.getFullYear(), m.getMonth(), 1 - ((m.getDay() + 6) % 7));
  const byDay = {};
  for (const r of CAL.rows) (byDay[calDay(new Date(r.kdy))] = byDay[calDay(new Date(r.kdy))] || []).push(r);
  const ev = (r) => {
    const [, cls] = CAL_STAV[r.stav] || CAL_STAV.naplanovano, it = socItem(r.polozka);
    const rucne = r.vysledky && r.vysledky.tiktok && r.vysledky.tiktok.stav === 'rucne';
    return `<button class="cal-ev ${cls}" data-a="calOpen" data-v="${r.id}" title="${esc(calTitle(it))}"><b>${calTime(new Date(r.kdy))}</b> ${esc(it ? it.title : r.polozka)}<span class="s">${r.site.map((s) => CAL_SITE[s]).join(' · ')}${rucne ? ' · TikTok ručně!' : ''}</span></button>`;
  };
  let cells = CAL_DNY.map((d) => `<div class="cal-dn">${d}</div>`).join('');
  for (let i = 0; i < 42; i++) {
    const d = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i), k = calDay(d);
    if (i === 35 && d.getMonth() !== m.getMonth()) break;
    const list = (byDay[k] || []).sort((a, b) => a.kdy.localeCompare(b.kdy));
    cells += `<div class="cal-cell${d.getMonth() !== m.getMonth() ? ' out' : ''}${k === today ? ' today' : ''}${k < today ? ' past' : ''}" data-a="calNew" data-v="${k}" role="button" tabindex="0" aria-label="Naplánovat na ${d.toLocaleDateString('cs-CZ')}"><span class="d">${d.getDate()}.</span>${list.map(ev).join('')}</div>`;
  }
  const upcoming = CAL.rows.filter((r) => r.stav !== 'hotovo' || (r.vysledky && r.vysledky.tiktok && r.vysledky.tiktok.stav === 'rucne'))
    .filter((r) => r.stav !== 'hotovo' || Date.now() - Date.parse(r.kdy) < 14 * 864e5);
  const row = (r) => {
    const [lbl, cls] = CAL_STAV[r.stav] || CAL_STAV.naplanovano, rucne = r.vysledky && r.vysledky.tiktok && r.vysledky.tiktok.stav === 'rucne';
    return `<div class="cal-row"><span class="w">${esc(calWhen(r.kdy))}</span><span class="t">${esc(calTitle(socItem(r.polozka)))}<br><span class="muted" style="font-size:13px">${r.site.map((s) => CAL_SITE[s]).join(' · ')}</span></span><span class="tag ${cls}">${lbl}</span>${rucne ? '<span class="tag peach">TikTok nahrát ručně</span>' : ''}<button class="btn white sm" data-a="calOpen" data-v="${r.id}">Otevřít</button></div>`;
  };
  const planned = CAL.rows.filter((r) => r.stav === 'naplanovano').length;
  return `${top(`${planned} naplánovaných příspěvků${socStorage() ? ' · zveřejňuje se automaticky v zadaný čas' : ' · ukázková data, nic se nezveřejní'}`)}${tabs}
    ${igBar()}
    <div class="cal-nav">
      <button class="btn white sm" data-a="calMonth" data-v="-1" aria-label="Předchozí měsíc">‹</button>
      <h2>${CAL_MESICE[m.getMonth()]} ${m.getFullYear()}</h2>
      <button class="btn white sm" data-a="calMonth" data-v="1" aria-label="Další měsíc">›</button>
      <button class="btn white sm" data-a="calMonth" data-v="0">Dnes</button>
      <span class="sp"></span>
      <button class="btn white sm" data-a="calBulk">Naplánovat podle doporučení</button>
      <button class="btn sm" data-a="calNew" data-v="">+ Naplánovat příspěvek</button>
    </div>
    <div class="cal-grid">${cells}</div>
    <section class="panel cal-list"><div class="panel-head"><h2>Nadcházející a k vyřízení</h2><button class="btn white sm" data-a="calReload">Obnovit</button></div>
      ${upcoming.length ? upcoming.map(row).join('') : '<p class="muted">Nic naplánovaného. Klikněte na den v kalendáři, nebo použijte Naplánovat podle doporučení.</p>'}
    </section>
    <p class="muted" style="margin-top:14px;font-size:13px">Instagram a facebookovou stránku zveřejní systém sám do minuty od zadaného času, i když administrace není otevřená. TikTok veřejné API pro zveřejňování nemá: v daný čas se u příspěvku objeví „TikTok nahrát ručně“, stáhněte video, nahrajte ho v aplikaci TikTok a označte jako hotové.</p>`;
}

// ---------- naplánovat / upravit ----------
function calForm(r, day) {
  const nets = calNets(), items = calItems();
  const edit = !!r, editable = !r || r.stav === 'naplanovano';
  const it0 = r ? socItem(r.polozka) : null;
  const d = r ? new Date(r.kdy) : null;
  const opts = items.map((it) => {
    const n = CAL.rows.filter((x) => x.polozka === it.id && x.stav !== 'chyba').length;
    return `<option value="${esc(it.id)}"${r && r.polozka === it.id ? ' selected' : ''}>${esc(calTitle(it))} · ${esc(it.format)}${SOC.used[it.id] ? ' · použito' : ''}${n ? ` · v kalendáři ${n}×` : ''}</option>`;
  }).join('');
  const site = r ? r.site : null;
  const net = (k) => {
    const on = site ? site.includes(k) : false;
    const why = nets[k], dis = !editable || (why && !on);
    return `<label><input type="checkbox" name="calSite" value="${k}"${on ? ' checked' : ''}${dis ? ' disabled' : ''}> <span><b>${CAL_SITE[k]}</b> <small>${k === 'tiktok' ? 'ručně, kalendář připomene' : why ? esc(why) : 'automaticky'}</small></span></label>`;
  };
  const res = r && r.stav !== 'naplanovano' ? `<div class="cal-res">${r.site.map((s) => {
    const v = (r.vysledky || {})[s] || { stav: 'ceka' };
    return `<div><b>${CAL_SITE[s]}:</b> ${esc(CAL_SIT_STAV[v.stav] || v.stav)}${v.odkaz && typeof v.odkaz === 'string' ? ` · <a href="${esc(v.odkaz)}" target="_blank" rel="noopener">otevřít ↗</a>` : ''}${v.chyba ? `<br><span class="err">${esc(v.chyba)}</span>` : ''}</div>`;
  }).join('')}</div>` : '';
  const rucne = r && r.vysledky && r.vysledky.tiktok && r.vysledky.tiktok.stav === 'rucne';
  const tik = rucne && it0 && it0.video ? `<a class="btn white" href="${socDl(it0.soubory[0])}" download="${esc(it0.soubory[0].nazev)}">${I.down}Video pro TikTok</a><button class="btn white" data-a="calCopyTik" data-v="${r.id}">${I.copy}Popisek pro TikTok</button><button class="btn" data-a="calTikDone" data-v="${r.id}">TikTok hotovo</button>` : '';
  modal(`<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="calT">
    <div class="dialog-head"><h2 id="calT">${edit ? (editable ? 'Upravit naplánovaný příspěvek' : calTitle(it0)) : 'Naplánovat příspěvek'}</h2><button class="x" data-a="close" aria-label="Zavřít">×</button></div>
    <div class="dialog-body cal-form">
      ${r && !editable ? `<p><span class="tag ${CAL_STAV[r.stav][1]}">${CAL_STAV[r.stav][0]}</span> <span class="muted">${esc(calWhen(r.kdy))} · ${r.site.map((s) => CAL_SITE[s]).join(', ')}</span></p>${res}` : ''}
      <div${editable ? '' : ' hidden'}>
        <label class="f" for="calItem">Materiál</label>
        <select id="calItem">${r ? '' : '<option value="">Vyberte z knihovny…</option>'}${opts}</select>
        <label class="f">Kdy</label>
        <div class="cal-when"><input type="date" id="calDate" value="${d ? calDay(d) : day || calDay(new Date(Date.now() + 864e5))}"><input type="time" id="calTime" value="${d ? calTime(d) : '20:00'}" step="300"></div>
        <label class="f">Sítě</label>
        <div class="cal-nets">${Object.keys(CAL_SITE).map(net).join('')}</div>
      </div>
      <label class="f" for="calText">Popisek (Instagram a Facebook)</label>
      <textarea id="calText"${editable ? '' : ' readonly'}>${esc(r ? r.popisek : '')}</textarea>
      <div class="ig-count"><span id="calProb" class="bad"></span><span id="calCount"></span></div>
    </div>
    <div class="dialog-foot"><div id="calStatus" class="muted"></div><div class="r">
      ${edit && r.stav !== 'zpracovava' ? `<button class="btn white" data-a="calDel" data-v="${r.id}">${r.stav === 'naplanovano' ? 'Smazat' : 'Odebrat z kalendáře'}</button>` : ''}
      ${r && r.stav === 'chyba' ? `<button class="btn white" data-a="calRetry" data-v="${r.id}">Zkusit znovu teď</button>` : ''}
      ${tik}
      ${editable ? `<button class="btn" id="calGo" data-a="calSave" data-v="${r ? r.id : ''}">${edit ? 'Uložit' : 'Naplánovat'}</button>` : '<button class="btn white" data-a="close">Zavřít</button>'}
    </div></div>
  </div>`);
  if (!editable) return;
  const sel = $('#calItem'), ta = $('#calText');
  let touched = !!r;
  const fill = () => {
    const it = socItem(sel.value);
    if (!it) return;
    if (!touched) ta.value = it.texty[0] ? it.texty[0].text : '';
    if (!r) document.querySelectorAll('[name=calSite]').forEach((c) => { c.checked = !c.disabled && it.site.includes(c.value); });
    upd();
  };
  const upd = () => {
    const t = ta.value, s = [...document.querySelectorAll('[name=calSite]:checked')].map((c) => c.value);
    const pr = [!sel.value && 'Vyberte materiál.', !s.length && 'Zaškrtněte aspoň jednu síť.', ...calProblems(t, s)].filter(Boolean);
    $('#calCount').textContent = `${t.length}/2200 znaků · ${(t.match(/#[^\s#]+/g) || []).length}/30 hashtagů`;
    $('#calProb').textContent = pr[0] || '';
    $('#calGo').disabled = !!pr.length || CAL.busy;
  };
  sel.addEventListener('change', fill);
  ta.addEventListener('input', () => { touched = true; upd(); });
  document.querySelectorAll('[name=calSite]').forEach((c) => c.addEventListener('change', upd));
  if (sel.value) fill(); else upd();
}
async function calSave(id) {
  const st = (m) => { const el = $('#calStatus'); if (el) { el.textContent = m; el.className = 'err'; } };
  const kdy = new Date(`${$('#calDate').value}T${$('#calTime').value || '20:00'}`);
  if (isNaN(kdy)) return st('Zadejte datum a čas.');
  if (kdy.getTime() < Date.now() + 60e3) return st('Čas musí být v budoucnu. Hned zveřejnit jde tlačítkem v detailu materiálu.');
  const row = { polozka: $('#calItem').value, kdy: kdy.toISOString(), site: [...document.querySelectorAll('[name=calSite]:checked')].map((c) => c.value), popisek: $('#calText').value.trim() };
  CAL.busy = true; $('#calGo').disabled = true;
  try {
    if (id) await calPatch(Number(id), row);
    else await calInsert([{ ...row, autor: (API.me && API.me.name) || '' }]);
    CAL.busy = false;
    closeModal(); toast(id ? 'Uloženo' : `Naplánováno na ${calWhen(row.kdy)}`);
    CAL.mesic = new Date(kdy.getFullYear(), kdy.getMonth(), 1);
    calReload();
  } catch (e) { CAL.busy = false; st(e.message); $('#calGo').disabled = false; }
}

// ---------- hromadně podle doporučeného plánu z katalogu (Týden 1 Po 20:00 …) ----------
function calBulkRows(start, skip) {
  const s = new Date(`${start}T00:00`), nets = calNets(), out = [], vynech = [];
  for (const it of calItems().filter((x) => x.plan)) {
    if (skip && (SOC.used[it.id] || CAL.rows.some((r) => r.polozka === it.id && r.stav !== 'chyba'))) continue;
    const site = it.site.filter((k) => CAL_SITE[k] && !nets[k]);
    const text = it.texty[0] ? it.texty[0].text : '';
    if (!site.length || calProblems(text, site).length) { vynech.push(it); continue; }
    const [h, mi] = it.plan.time.split(':').map(Number);
    const kdy = new Date(s.getFullYear(), s.getMonth(), s.getDate() + (it.plan.week - 1) * 7 + CAL_DNY.indexOf(it.plan.day), h, mi);
    if (kdy.getTime() < Date.now() + 60e3) { vynech.push(it); continue; }
    out.push({ polozka: it.id, kdy: kdy.toISOString(), site, popisek: text, autor: (API.me && API.me.name) || '' });
  }
  return { out, vynech };
}
function calBulk() {
  const n = new Date(), mon = new Date(n.getFullYear(), n.getMonth(), n.getDate() + (((8 - n.getDay()) % 7) || 7));
  modal(`<div class="dialog narrow" role="dialog" aria-modal="true" aria-labelledby="calBT">
    <div class="dialog-head"><h2 id="calBT">Naplánovat podle doporučení</h2><button class="x" data-a="close" aria-label="Zavřít">×</button></div>
    <div class="dialog-body cal-form">
      <p class="muted">Materiály mají doporučený den a čas (Týden 1 · Po 20:00 …). Vyberte pondělí, kterým začne týden 1, a kalendář se vyplní. Sítě se vezmou podle materiálu, popisek z katalogu. Potom jde každý příspěvek upravit.</p>
      <label class="f" for="calStart">Týden 1 začíná v pondělí</label>
      <input type="date" id="calStart" value="${calDay(mon)}">
      <label style="display:flex;gap:8px;margin-top:12px;font-size:14px"><input type="checkbox" id="calSkip" checked> Přeskočit použité a už naplánované</label>
      <p id="calBSum" style="margin-top:12px"></p>
    </div>
    <div class="dialog-foot"><div id="calStatus" class="muted"></div><div class="r"><button class="btn white" data-a="close">Zrušit</button><button class="btn" id="calBGo" data-a="calBulkGo">Naplánovat</button></div></div>
  </div>`);
  const upd = () => {
    const v = $('#calStart').value, ok = v && new Date(`${v}T00:00`).getDay() === 1;
    const { out, vynech } = ok ? calBulkRows(v, $('#calSkip').checked) : { out: [], vynech: [] };
    $('#calBSum').innerHTML = !ok ? '<span class="err">Vyberte pondělí.</span>'
      : `Naplánuje se <b>${out.length}</b> příspěvků${out.length ? `, ${esc(calWhen(out.reduce((a, b) => (a.kdy < b.kdy ? a : b)).kdy))} až ${esc(calWhen(out.reduce((a, b) => (a.kdy > b.kdy ? a : b)).kdy))}` : ''}.${vynech.length ? `<br><span class="muted">Vynechá ${vynech.length}: ${vynech.map((x) => esc(calTitle(x))).join(', ')} (zástupné texty k doplnění, čas v minulosti nebo žádná dostupná síť).</span>` : ''}`;
    $('#calBGo').disabled = !out.length;
  };
  $('#calStart').addEventListener('change', upd); $('#calSkip').addEventListener('change', upd); upd();
}

PAGES.socialniKalendar = pageCal;
Object.assign(ACTIONS, {
  calReload,
  calMonth: (v) => { const d = Number(v), m = CAL.mesic, n = new Date(); CAL.mesic = d ? new Date(m.getFullYear(), m.getMonth() + d, 1) : new Date(n.getFullYear(), n.getMonth(), 1); render(); },
  calNew: (v) => calForm(null, v || ''),
  calOpen: (v) => { const r = CAL.rows.find((x) => x.id === Number(v)); if (r) calForm(r); },
  calSave: (v) => calSave(v),
  calDel: (v) => {
    const r = CAL.rows.find((x) => x.id === Number(v));
    confirmBox(r.stav === 'naplanovano' ? 'Smazat naplánovaný příspěvek?' : 'Odebrat z kalendáře?', r.stav === 'naplanovano' ? 'Příspěvek se nezveřejní.' : 'Zveřejněné příspěvky na sítích zůstanou, zmizí jen z kalendáře.', r.stav === 'naplanovano' ? 'Smazat' : 'Odebrat', async () => {
      try { await calDelete(r.id); toast('Odebráno z kalendáře'); } catch (e) { toast(e.message); }
      calReload();
    });
  },
  calRetry: async (v) => {
    const r = CAL.rows.find((x) => x.id === Number(v));
    const vysledky = Object.fromEntries(Object.entries(r.vysledky || {}).filter(([, x]) => x.stav !== 'chyba'));
    try { await calPatch(r.id, { stav: 'naplanovano', vysledky, kdy: new Date().toISOString() }); closeModal(); toast('Zkusí se znovu do minuty'); } catch (e) { toast(e.message); }
    calReload();
  },
  calTikDone: async (v) => {
    const r = CAL.rows.find((x) => x.id === Number(v));
    try {
      await calPatch(r.id, { vysledky: { ...r.vysledky, tiktok: { stav: 'hotovo', at: new Date().toISOString() } } });
      if (!SOC.used[r.polozka]) await socMark(r.polozka, true).catch(() => {});
      closeModal(); toast('TikTok označený jako hotový');
    } catch (e) { toast(e.message); }
    calReload();
  },
  calCopyTik: (v) => {
    const r = CAL.rows.find((x) => x.id === Number(v)), it = socItem(r.polozka);
    const t = (it.texty.find((x) => /tiktok/i.test(x.nazev)) || it.texty[0] || { text: r.popisek }).text;
    copy(t, 'Popisek pro TikTok: zkopírováno');
  },
  calBulk: () => calBulk(),
  calBulkGo: async () => {
    const { out } = calBulkRows($('#calStart').value, $('#calSkip').checked);
    if (!out.length) return;
    $('#calBGo').disabled = true;
    try { await calInsert(out); closeModal(); toast(`Naplánováno ${out.length} příspěvků`); const f = new Date(out[0].kdy); CAL.mesic = new Date(f.getFullYear(), f.getMonth(), 1); }
    catch (e) { const el = $('#calStatus'); el.textContent = e.message; el.className = 'err'; $('#calBGo').disabled = false; }
    calReload();
  },
  // z detailu materiálu: otevře kalendář a formulář s tím materiálem
  calSchedule: (v) => {
    closeModal(); SOC.view = 'kalendar'; render();
    calForm(null, '');
    const sel = $('#calItem'); sel.value = v; sel.dispatchEvent(new Event('change'));
  },
});
