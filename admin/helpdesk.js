// ---------- Helpdesk ----------
// Tři sloupce: pohledy (fronty), virtualizovaný seznam ticketů, detail s konverzací a kontextem rodiny.
// Přepnutí ticketu mění jen detail a zvýraznění v seznamu, seznam se znovu nenačítá.
// Klávesy: j / k další a předchozí ticket, r odpověď, e vyřešit, a vzít si ticket, / hledat.

const HD = { view: 'open', q: '', sel: null, mode: 'agent', draft: {}, vt: null };
const AGENTS = () => API.staff.filter((s) => API.ROLES[s.role].perms.includes('tickets.reply'));

function hdStats() {
  const since = Date.now() - 30 * 864e5;
  const recent = API.tickets.all().filter((t) => t.created >= since);
  const resp = recent.filter((t) => t.firstResp).map((t) => t.firstResp - t.created).sort((a, b) => a - b);
  const met = recent.filter((t) => t.firstResp && API.tickets.sla(t).state === 'ok').length;
  const rated = recent.filter((t) => t.csat);
  const csat = rated.length ? rated.filter((t) => t.csat >= 4).length / rated.length : 0;
  return `<div class="hd-stats">
    <div><span class="muted">Nové za 30 dní</span><b>${fmt(recent.length)}</b></div>
    <div><span class="muted">Medián 1. odpovědi</span><b>${resp.length ? hm(resp[Math.floor(resp.length / 2)]) : '–'}</b></div>
    <div><span class="muted">SLA dodrženo</span><b>${pct(met, resp.length)}</b></div>
    <div><span class="muted">Spokojenost (4–5 ★)</span><b>${rated.length ? pct(csat * rated.length, rated.length) : '–'}</b></div>
  </div>`;
}
function hdViews() {
  const c = API.tickets.counts();
  return `<h2 style="margin:2px 4px 8px">Fronty</h2>
    ${Object.entries(API.VIEWS).map(([k, v]) => `<a href="#helpdesk/${k}" class="${HD.view === k ? 'on' : ''} ${k === 'breach' && c[k] ? 'hot' : ''}"><span>${v.label}</span><span class="n">${fmt(c[k])}</span></a>`).join('')}
    <button class="btn white sm" style="margin-top:12px" data-a="tTpls">Šablony odpovědí</button>
    ${hdStats()}`;
}

function ticketRow(t) {
  const f = API.families.get(t.fam);
  const who = t.assignee ? API.staffName(t.assignee) : '';
  return `<div class="tk ${t.status === 'new' ? 'unread' : ''}">
    <div class="l1"><i class="dot pri-${t.pri}" title="Priorita: ${API.TPRI[t.pri]}"></i><span class="s">${esc(t.subject)}</span><span class="t">${ago(t.updated)}</span></div>
    <div class="l2"><span class="mono">#${t.id}</span><span class="fam">${esc(famName(f))}</span>${slaChip(t)}${tStatus(t)}${who ? `<span class="av" title="Řeší ${esc(who)}">${initials(who)}</span>` : ''}</div>
  </div>`;
}

function msgHtml(m) {
  const lbl = { family: 'Rodina', agent: 'Podpora', note: 'Interní poznámka', system: '' }[m.from];
  return `<div class="msg ${m.from}"><div class="by"><span>${esc(m.author || lbl)}</span><span>· ${lbl}</span><span class="muted" style="margin-left:auto">${fdate(m.at)} ${m.at.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}</span></div><p>${esc(m.text)}</p></div>`;
}

function hdContext(t, f) {
  if (!f) return '<h3>Rodina</h3><p class="muted">Rodina už byla smazaná.</p>';
  const pays = API.can('billing.read') ? API.families.payments(f.id) : [];
  const others = API.families.tickets(f.id).filter((x) => x.id !== t.id);
  return `
    <h3>Rodina</h3>
    <p style="margin-bottom:4px">${famLink(f)}</p>
    <p class="muted" style="font-size:12px;margin-bottom:8px">${esc(famMail(f))}</p>
    <div style="margin-bottom:8px">${subTag(f)} ${f.tags.map((x) => `<span class="tag line">${esc(x)}</span>`).join(' ')}</div>
    <div style="margin-bottom:8px">${kidsHtml(f)}</div>
    <dl class="kv">
      <dt>Bydliště</dt><dd>${esc(f.town)} ${f.country}</dd>
      <dt>Zařízení</dt><dd>${f.platform} ${f.appVer === 'web' ? '' : f.appVer}</dd>
      <dt>Registrace</dt><dd>${fdate(f.created)}</dd>
      <dt>Naposledy</dt><dd>${ago(f.lastSeen)}</dd>
      <dt>Přehrání 30 d</dt><dd>${fmt(f.plays30)}</dd>
      <dt>Zdraví</dt><dd>${healthTag(f.health)}</dd>
    </dl>
    ${API.can('billing.read') ? `<h3>Platby</h3>${pays.length ? `<dl class="kv">${pays.slice(0, 4).map((p) => `<dt>${fdate(p.at)}</dt><dd>${kc(p.czk)} <span class="${p.status === 'zaplaceno' ? 'muted' : 'down'}">${p.status}</span></dd>`).join('')}</dl>` : '<p class="muted">Zatím žádné.</p>'}` : ''}
    <h3>Další tickety</h3>
    ${others.length ? others.slice(0, 6).map((x) => `<p style="margin-bottom:5px"><a class="link" href="#helpdesk/${x.id}">#${x.id} ${esc(x.subject)}</a> ${tStatus(x)}</p>`).join('') : '<p class="muted">Žádné.</p>'}`;
}

function hdComposer(t) {
  if (!API.can('tickets.reply')) return `<div class="composer"><p class="muted">Role ${API.ROLES[API.viewAs].label} může helpdesk jen číst.</p></div>`;
  const note = HD.mode === 'note';
  return `<div class="composer ${note ? 'note' : ''}">
    <div class="row">
      <div class="seg"><button data-a="tMode" data-v="agent" class="${note ? '' : 'on'}">Odpověď rodině</button><button data-a="tMode" data-v="note" class="${note ? 'on' : ''}">Interní poznámka</button></div>
      <select data-f="tTpl" aria-label="Vložit šablonu"><option value="">Vložit šablonu…</option>${API.tickets.templates().map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>
    </div>
    <textarea id="tText" data-f="tText" placeholder="${note ? 'Poznámku uvidí jen tým, rodina ne.' : 'Napiš odpověď… (r)'}">${esc(HD.draft[t.id] || '')}</textarea>
    <div class="row" style="margin-top:8px">
      <span class="hint">⌘↵ odeslat · ⌘⇧↵ odeslat a vyřešit · ukázka, nic se neodesílá</span>
      <div class="r">${note ? '<button class="btn sm" data-a="tSend" data-v="note">Uložit poznámku</button>' : '<button class="btn white sm" data-a="tSend" data-v="solved">Odeslat a vyřešit</button><button class="btn sm" data-a="tSend" data-v="waiting">Odeslat</button>'}</div>
    </div>
  </div>`;
}

function hdDetail() {
  const t = HD.sel && API.tickets.get(HD.sel);
  if (!t) return `<div class="hd-empty"><img src="../brand/maskot-3d/web/ospalek-spi.webp" alt=""><b>Vyber ticket ze seznamu</b><p class="hint" style="margin-top:6px">j / k další a předchozí · r odpovědět · e vyřešit · a vzít si</p></div>`;
  const f = API.families.get(t.fam), canR = API.can('tickets.reply');
  const sel = (k, opts, v) => `<select data-tprop="${k}" ${canR ? '' : 'disabled'}>${opts.map(([val, l]) => `<option value="${val}" ${val === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  return `
    <div class="td-head">
      <div style="display:flex;gap:8px;align-items:flex-start">
        <a class="btn white sm back" href="#helpdesk/${HD.view}">${I.back}Zpět</a>
        <div style="flex:1;min-width:0"><h2>${esc(t.subject)}</h2>
        <div class="td-meta">#${t.id} · ${esc(D.ticketCats[t.cat])} · přes ${esc(t.channel)} · založeno ${fdate(t.created)} ${t.created.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })} (${ago(t.created)})</div></div>
      </div>
      <div class="td-props">
        <label>Stav ${sel('status', Object.entries(API.TSTATUS), t.status)}</label>
        <label>Priorita ${sel('pri', Object.entries(API.TPRI), t.pri)}</label>
        <label>Řeší ${sel('assignee', [['', 'Nikdo'], ...AGENTS().map((s) => [s.id, s.name])], t.assignee || '')}</label>
        <span style="margin-left:auto;text-align:right">${slaChip(t) || '<span class="sla ok">Odpověď není potřeba</span>'}<div class="hint">SLA první odpovědi ${t.slaH} h</div></span>
      </div>
    </div>
    <div class="td-main">
      <div style="display:flex;flex-direction:column;min-height:0">
        <div class="thread" id="thread">${t.msgs.map(msgHtml).join('')}${t.csat ? `<div class="msg system">Hodnocení podpory od rodiny: ${'★'.repeat(t.csat)}${'☆'.repeat(5 - t.csat)}</div>` : ''}</div>
        ${hdComposer(t)}
      </div>
      <aside class="td-ctx">${hdContext(t, f)}</aside>
    </div>`;
}

function hdPaintDetail() {
  const el = $('#hdDetail'); if (!el) return;
  el.innerHTML = hdDetail();
  $('#hd').classList.toggle('has-sel', !!HD.sel);
  const th = $('#thread'); if (th) th.scrollTop = th.scrollHeight;
}
function hdPaintSide() { const v = $('#hdViews'); if (v) v.innerHTML = hdViews(); renderNav(); }

function pageHelpdesk() {
  const p = routeParam();
  if (/^\d+$/.test(p)) HD.sel = Number(p);
  else if (API.VIEWS[p]) { HD.view = p; HD.sel = null; }
  after.push(() => {
    HD.vt = vtable($('#hdList'), {
      cols: [{ k: 't', label: 'Ticket', w: 'minmax(0, 1fr)', html: ticketRow }], noHead: true,
      rowH: 62, limit: 200, key: (t) => t.id, selected: HD.sel, openOnMove: true,
      fetch: (c, l) => API.tickets.list({ view: HD.view, q: HD.q }, c, l),
      onOpen: (t) => go('helpdesk/' + t.id),
      empty: 'V téhle frontě nic není.',
      foot: (s) => `${fmt(s.total)} ${plural(s.total, 'ticket', 'tickety', 'ticketů')} · dotaz ${dec(s.ms)} ms`,
    });
    onLeave(() => { HD.vt.destroy(); HD.vt = null; });
    hdPaintDetail();
  });
  return `<div class="hd" id="hd">
    <aside class="panel hd-views" id="hdViews">${hdViews()}</aside>
    <section class="panel hd-list">
      <div class="panel-head" style="margin-bottom:8px"><h2 id="hdTitle">${API.VIEWS[HD.view].label}</h2><button class="btn sm" data-a="tNew" ${API.can('tickets.reply') ? '' : 'disabled'}>${I.plus}Nový</button></div>
      <div class="filters">
        <input type="search" id="hdQ" data-f="hdq" placeholder="Hledat #číslo, předmět, rodinu" value="${esc(HD.q)}" aria-label="Hledat v ticketech">
        <select data-f="hdview" class="hd-viewsel" aria-label="Fronta">${Object.entries(API.VIEWS).map(([k, v]) => `<option value="${k}" ${HD.view === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
      </div>
      <div class="vt-host" id="hdList"></div>
    </section>
    <section class="panel hd-detail" id="hdDetail"></section>
  </div>`;
}
pageHelpdesk.onParam = (p) => {
  if (!HD.vt) return false;
  if (/^\d+$/.test(p)) { HD.sel = Number(p); HD.vt.select(HD.sel); hdPaintDetail(); return true; }
  if (API.VIEWS[p] || !p) {
    HD.view = p || 'open'; HD.sel = null;
    $('#hdTitle').textContent = API.VIEWS[HD.view].label;
    HD.vt.reset(); hdPaintSide(); hdPaintDetail();
    return true;
  }
  return false;
};
PAGES.helpdesk = pageHelpdesk;

// po změně ticketu překreslit detail, viditelné řádky a počty ve frontách
const hdChanged = () => { hdPaintDetail(); HD.vt && HD.vt.refresh(); hdPaintSide(); };
let hdT;
Object.assign(ACTIONS, {
  tMode: (v) => { HD.mode = v; hdPaintDetail(); $('#tText')?.focus(); },
  tSend: (v) => {
    const ta = $('#tText'), text = ta && ta.value.trim();
    if (!text) { toast('Nejdřív něco napiš'); ta?.focus(); return; }
    API.tickets.reply(HD.sel, text, v === 'note' ? 'note' : 'agent', v === 'note' ? null : v);
    delete HD.draft[HD.sel];
    hdChanged();
    toast(v === 'note' ? 'Poznámka je uložená' : v === 'solved' ? 'Odpověď uložená a ticket vyřešený (ukázka)' : 'Odpověď uložená (ukázka, nic se neodeslalo)');
  },
  tTpls: () => openTemplates(),
  tNew: () => openNewTicket(),
  tPickFam: (v) => { $('#ntFam').value = v; $('#ntFamQ').value = famName(API.families.get(v)); $('#ntRes').innerHTML = ''; },
  tplAdd: () => { const box = $('#tplList'); box.insertAdjacentHTML('beforeend', tplRow({ id: 't' + Date.now(), name: '', text: '' })); },
  tplDel: (v, t) => t.closest('.tplrow').remove(),
  tplSave: () => {
    const list = [...document.querySelectorAll('.tplrow')].map((r) => ({ id: r.dataset.id, name: r.querySelector('input').value.trim(), text: r.querySelector('textarea').value })).filter((x) => x.name);
    API.tickets.saveTemplates(list); closeModal(); hdPaintDetail(); toast('Šablony jsou uložené');
  },
  ntSave: () => {
    const famId = $('#ntFam').value, subject = $('#ntSub').value.trim(), text = $('#ntText').value.trim();
    if (!famId || !subject || !text) { $('#ntErr').textContent = 'Vyber rodinu a vyplň předmět i zprávu.'; return; }
    const t = API.tickets.create({ famId, subject, text, pri: $('#ntPri').value, cat: $('#ntCat').value });
    closeModal(); HD.view = 'open'; HD.q = '';
    if (route() === 'helpdesk' && HD.vt) { $('#hdQ').value = ''; HD.vt.reset(); hdPaintSide(); }
    go('helpdesk/' + t.id); toast(`Ticket #${t.id} je založený`);
  },
});

document.addEventListener('input', (ev) => {
  const t = ev.target, f = t.dataset.f;
  if (f === 'hdq') { clearTimeout(hdT); hdT = setTimeout(() => { HD.q = t.value; HD.vt && HD.vt.reset(); }, 120); }
  if (f === 'tText' && HD.sel) HD.draft[HD.sel] = t.value;
  if (f === 'ntFamQ') {
    const r = API.families.list({ q: t.value, seg: 'all' }, null, 8).items.filter((x) => x.email);
    $('#ntRes').innerHTML = t.value.trim() ? r.map((x) => `<button type="button" class="chip" data-a="tPickFam" data-v="${x.id}">${esc(famName(x))} <span class="muted">${esc(x.town)}</span></button>`).join('') || '<span class="hint">Nic nenalezeno.</span>' : '';
  }
});
document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.dataset.tprop && HD.sel) {
    API.tickets.update(HD.sel, { [t.dataset.tprop]: t.value || null });
    hdChanged(); toast('Ticket je upravený');
  }
  if (t.dataset.f === 'tTpl' && t.value) {
    const tpl = API.tickets.templates().find((x) => x.id === t.value), ta = $('#tText');
    const text = API.tickets.fillTpl(tpl.text, API.tickets.get(HD.sel));
    const pos = ta.selectionStart ?? ta.value.length;
    ta.value = ta.value.slice(0, pos) + text + ta.value.slice(ta.selectionEnd ?? pos);
    HD.draft[HD.sel] = ta.value; t.value = ''; ta.focus();
  }
  if (t.dataset.f === 'hdview') go('helpdesk/' + t.value);
});

// klávesové zkratky v helpdesku
function hdKeys(ev, typing) {
  if (route() !== 'helpdesk' || !HD.vt) return false;
  if (typing && ev.target.id === 'tText' && ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); ACTIONS.tSend(HD.mode === 'note' ? 'note' : ev.shiftKey ? 'solved' : 'waiting'); return true; }
  if (typing) return false;
  const k = ev.key;
  if (k === 'j' || k === 'k') { HD.vt.move(k === 'j' ? 1 : -1, true); return true; }
  if (k === '/') { ev.preventDefault(); $('#hdQ').focus(); return true; }
  if (!HD.sel || !API.can('tickets.reply')) return false;
  if (k === 'r') { ev.preventDefault(); HD.mode = 'agent'; hdPaintDetail(); $('#tText').focus(); return true; }
  if (k === 'n') { ev.preventDefault(); HD.mode = 'note'; hdPaintDetail(); $('#tText').focus(); return true; }
  if (k === 'e') { API.tickets.update(HD.sel, { status: 'solved' }); hdChanged(); toast('Ticket je vyřešený'); return true; }
  if (k === 'a') { API.tickets.update(HD.sel, { assignee: API.me.id, ...(API.tickets.get(HD.sel).status === 'new' ? { status: 'open' } : {}) }); hdChanged(); toast('Ticket řešíš ty'); return true; }
  return false;
}

const tplRow = (x) => `<div class="tplrow panel" data-id="${esc(x.id)}" style="padding:10px 12px;margin-top:8px">
  <div style="display:flex;gap:8px"><input value="${esc(x.name)}" placeholder="Název šablony" aria-label="Název šablony"><button class="btn danger sm" data-a="tplDel">Smazat</button></div>
  <textarea rows="4" style="font-family:var(--body);font-size:13px;margin-top:6px" aria-label="Text šablony">${esc(x.text)}</textarea></div>`;
function openTemplates() {
  const canE = API.can('tickets.reply');
  modal(`<div class="dialog" style="max-width:720px" role="dialog" aria-modal="true" aria-labelledby="tplT">
    <div class="dialog-head"><h2 id="tplT">Šablony odpovědí</h2><button class="x" data-a="close" aria-label="Zavřít">×</button></div>
    <div class="dialog-body"><p class="hint">Zástupné značky se při vložení nahradí údaji rodiny: {jmeno} {dite} {obchod} {verze} {castka} {ticket}</p>
      <div id="tplList">${API.tickets.templates().map(tplRow).join('')}</div></div>
    <div class="dialog-foot">${canE ? `<button class="btn white" data-a="tplAdd">${I.plus}Přidat</button>` : ''}<div class="r"><button class="btn white" data-a="close">Zavřít</button>${canE ? '<button class="btn" data-a="tplSave">Uložit</button>' : ''}</div></div></div>`);
}
function openNewTicket() {
  const f = route() === 'rodiny' && /^f\d+/.test(routeParam()) ? API.families.get(routeParam()) : null;
  modal(`<div class="dialog narrow" role="dialog" aria-modal="true" aria-labelledby="ntT">
    <div class="dialog-head"><h2 id="ntT">Nový ticket</h2><button class="x" data-a="close" aria-label="Zavřít">×</button></div>
    <div class="dialog-body">
      <label for="ntFamQ">Rodina</label><input id="ntFamQ" data-f="ntFamQ" placeholder="Jméno, e-mail, město nebo id" autocomplete="off" value="${f ? esc(famName(f)) : ''}"><input type="hidden" id="ntFam" value="${f ? f.id : ''}">
      <div class="chips" id="ntRes" style="margin-top:6px"></div>
      <label for="ntSub">Předmět</label><input id="ntSub" placeholder="Např. Telefonát: nejde přehrát pohádka">
      <div class="fields2">
        <div><label for="ntCat">Kategorie</label><select id="ntCat">${Object.entries(D.ticketCats).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <div><label for="ntPri">Priorita</label><select id="ntPri">${Object.entries(API.TPRI).map(([k, v]) => `<option value="${k}" ${k === 'normal' ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      </div>
      <label for="ntText">Co rodina potřebuje</label><textarea id="ntText" rows="4" style="font-family:var(--body);font-size:13px"></textarea>
      <p class="err" id="ntErr"></p>
    </div>
    <div class="dialog-foot"><div class="r"><button class="btn white" data-a="close">Zrušit</button><button class="btn" data-a="ntSave">Založit ticket</button></div></div></div>`);
  $(f ? '#ntSub' : '#ntFamQ').focus();
}
