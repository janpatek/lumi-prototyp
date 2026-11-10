// ---------- Tým a role, Audit log, hledání (⌘K) a klávesové zkratky ----------

const ACTION_LABEL = { auth: 'Přihlášení', ticket: 'Helpdesk', family: 'Rodiny', payment: 'Platby', story: 'Pohádky', team: 'Tým', promo: 'Kódy', tts: 'Hlas' };

function pageTeam() {
  // ostrá data: tým spravuje vlastník (účty a hesla přes Edge Function staff-admin, role a kód přes databázi)
  const canM = API.can('team.manage') && (!D.live || (D.me.role === 'owner' && !!D.team));
  const roles = Object.entries(API.ROLES);
  const row = (s) => {
    const me = s.id === API.me.id;
    const acts = D.live && canM ? `<div class="row-acts">
        <button class="btn white sm" data-a="teamPw" data-v="${esc(s.id)}">Nastavit heslo</button>
        ${!me && s.twofa ? `<button class="btn white sm" data-a="teamMfa" data-v="${esc(s.id)}">Zrušit kód</button>` : ''}
        ${!me ? `<button class="btn danger sm" data-a="teamRemove" data-v="${esc(s.id)}">Odebrat</button>` : ''}</div>` : '';
    return `<tr><td><span class="av">${initials(s.name)}</span> <b>${esc(s.name)}</b>${me ? ' <span class="tag">ty</span>' : ''}${s.invited ? ' <span class="tag honey">pozvánka</span>' : ''}</td><td class="muted">${esc(s.email)}</td>
      <td>${canM && !me ? `<select data-f="staffRole" data-id="${s.id}" style="width:auto;padding:4px 8px">${roles.map(([k, r]) => `<option value="${k}" ${s.role === k ? 'selected' : ''}>${r.label}</option>`).join('')}</select>` : API.ROLES[s.role].label}</td>
      <td>${s.twofa ? '<span class="status-ok">zapnuto</span>' : (D.live ? '<span class="status-warn">nastaví při přihlášení</span>' : '<span class="status-bad">vypnuto</span>')}</td><td class="muted">${s.last ? ago(s.last) : '–'}</td>${D.live && canM ? `<td>${acts}</td>` : ''}</tr>`;
  };
  const btn = canM ? (D.live ? `<button class="btn" data-a="teamAdd">${I.plus}Přidat člena týmu</button>` : `<button class="btn" data-a="invite">${I.plus}Pozvat člena týmu</button>`) : '';
  return `
    ${head('Tým a role', 'Kdo má do administrace přístup a co smí', btn)}
    ${D.live
      ? `<div class="notice"><img src="../brand/maskot-3d/web/ospalek-hlava.webp" alt=""><div><b>Přihlášení do administrace:</b> e-mail, heslo a kód z Google Authenticatoru. Nový člen týmu dostane od tebe e-mail a heslo, při prvním přihlášení si naskenuje QR kód. Heslo si může kdykoli změnit přes „Zapomenuté heslo“. ${canM ? '' : 'Tým spravuje vlastník.'}</div></div>`
      : `<div class="notice"><img src="../brand/maskot-3d/web/ospalek-hlava.webp" alt=""><div><b>Role si můžeš vyzkoušet.</b> Vlevo dole přepni „Zobrazit jako role“ a administrace se schová nebo zamkne podle oprávnění, včetně skrývání e-mailů. U ukázkových dat jde jen o ukázku v prohlížeči, u ostrých dat oprávnění hlídá databáze.</div></div>`}
    <section class="panel"><div class="panel-head"><h2>Členové týmu</h2><span class="muted">${API.staff.length} lidí</span></div>
      <div class="table-wrap"><table><thead><tr><th>Jméno</th><th>E-mail</th><th>Role</th><th>Google Authenticator</th><th>Naposledy</th>${D.live && canM ? '<th></th>' : ''}</tr></thead><tbody>
      ${API.staff.map(row).join('')}
      </tbody></table></div>
    </section>
    <section class="panel"><div class="panel-head"><h2>Oprávnění rolí</h2></div>
      <div class="table-wrap"><table class="matrix"><thead><tr><th>Oprávnění</th>${roles.map(([, r]) => `<th>${r.label}</th>`).join('')}</tr></thead><tbody>
      ${Object.entries(API.PERMS).map(([p, l]) => `<tr><td>${l} <span class="mono muted">${p}</span></td>${roles.map(([, r]) => `<td>${r.perms.includes(p) ? '<span class="yes-ico" aria-label="ano">✓</span>' : '<span class="no-ico" aria-label="ne">·</span>'}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div>
    </section>`;
}
PAGES.tym = pageTeam;

// ---------- Správa týmu nad ostrými daty ----------
const staffById = (id) => API.staff.find((s) => s.id === id);
async function teamRefresh() {
  const fresh = await D.team.list();
  API.staff.splice(0, API.staff.length, ...fresh.sort((a, b) => (a.id === API.me.id ? -1 : b.id === API.me.id ? 1 : 0)));
  render();
}
// společný průběh: tlačítko se zamkne, chyba se ukáže v dialogu, po úspěchu se tým načte znovu
async function teamRun(btn, errEl, work, done) {
  btn.disabled = true; errEl.textContent = '';
  try { await work(); closeModal(); await teamRefresh(); toast(done); } catch (e) { errEl.textContent = e.message; btn.disabled = false; }
}
const pwFields = `<label for="tPw">Heslo</label><input id="tPw" type="password" autocomplete="new-password" minlength="12">
  <label for="tPw2">Heslo znovu</label><input id="tPw2" type="password" autocomplete="new-password">
  <p class="hint">Aspoň 12 znaků. Heslo předej osobně nebo jiným kanálem než e-mail, ať neleží v jedné zprávě s adresou.</p>`;
const readPw = () => {
  const pw = $('#tPw').value;
  if (pw.length < 12) throw new Error('Heslo musí mít aspoň 12 znaků.');
  if (pw !== $('#tPw2').value) throw new Error('Hesla se neshodují.');
  return pw;
};
Object.assign(ACTIONS, {
  teamAdd: () => {
    modal(`<div class="dialog narrow" role="dialog" aria-modal="true" aria-labelledby="taT">
      <div class="dialog-head"><h2 id="taT">Přidat člena týmu</h2><button class="x" data-a="close" aria-label="Zavřít">×</button></div>
      <div class="dialog-body"><label for="tName">Jméno</label><input id="tName" autocomplete="off" placeholder="Klára">
        <label for="tMail">E-mail</label><input id="tMail" type="email" autocomplete="off" placeholder="jmeno@example.cz">
        <label for="tRole">Role</label><select id="tRole">${Object.entries(API.ROLES).map(([k, r]) => `<option value="${k}" ${k === 'support' ? 'selected' : ''}>${r.label}</option>`).join('')}</select>
        ${pwFields}<p class="err" id="tErr"></p></div>
      <div class="dialog-foot"><div class="r"><button class="btn white" data-a="close">Zrušit</button><button class="btn" id="tOk">Přidat</button></div></div></div>`);
    $('#tName').focus();
    $('#tOk').onclick = (ev) => teamRun(ev.currentTarget, $('#tErr'), () => {
      const name = $('#tName').value.trim(), email = $('#tMail').value.trim();
      if (!name) throw new Error('Zadej jméno.');
      if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) throw new Error('Zadej platný e-mail.');
      return D.team.create({ name, email, role: $('#tRole').value, password: readPw() });
    }, 'Člen týmu je přidaný');
  },
  teamPw: (id) => {
    const s = staffById(id); if (!s) return;
    modal(`<div class="dialog narrow" role="dialog" aria-modal="true" aria-labelledby="tpT">
      <div class="dialog-head"><h2 id="tpT">Nové heslo: ${esc(s.name)}</h2><button class="x" data-a="close" aria-label="Zavřít">×</button></div>
      <div class="dialog-body">${pwFields}<p class="err" id="tErr"></p></div>
      <div class="dialog-foot"><div class="r"><button class="btn white" data-a="close">Zrušit</button><button class="btn" id="tOk">Uložit heslo</button></div></div></div>`);
    $('#tPw').focus();
    $('#tOk').onclick = (ev) => teamRun(ev.currentTarget, $('#tErr'), () => D.team.password(id, readPw()), 'Heslo je nastavené');
  },
  teamMfa: (id) => {
    const s = staffById(id); if (!s) return;
    confirmBox('Zrušit kód z Google Authenticatoru?', `${esc(s.name)} si při dalším přihlášení naskenuje nový QR kód. Hodí se, když ztratí telefon.`, 'Zrušit kód',
      () => D.team.resetMfa(id).then(teamRefresh).then(() => toast('Ověření kódem je zrušené'), (e) => toast(e.message)));
  },
  teamRemove: (id) => {
    const s = staffById(id); if (!s) return;
    confirmBox('Odebrat z týmu?', `${esc(s.name)} (${esc(s.email)}) přijde o přístup do administrace a jeho účet se smaže. Vrátit to nejde, jen ho přidat znovu.`, 'Odebrat',
      () => D.team.remove(id).then(teamRefresh).then(() => toast('Člen týmu je odebraný'), (e) => toast(e.message)));
  },
});

// ---------- Napojení dat ----------
function pageData() {
  const live = D.live;
  const counts = [['Rodiny', D.families.length], ['Dětské profily', D.families.reduce((n, f) => n + f.kids.length, 0)], ['Přehrání celkem', D.families.reduce((n, f) => n + f.plays, 0)], ['Rodin s poslechem za 30 dní', D.families.filter((f) => f.days30 > 0).length]];
  return `
    ${head('Napojení dat', live ? 'Administrace čte ostrá data ze Supabase' : 'Administrace teď ukazuje ukázková data')}
    <div class="grid2 data-page" style="margin-top:0">
      <section class="panel"><div class="panel-head"><h2>Stav</h2>${live ? '<span class="tag mint">Ostrá data</span>' : '<span class="tag honey">Ukázková data</span>'}</div>
        <dl class="kv">
          <dt>Databáze</dt><dd>${LIVE.configured ? esc(LIVE.url) : 'nenastavená (config.js)'}</dd>
          ${live ? `<dt>Přihlášen</dt><dd>${esc(D.me.name)} · ${esc(API.ROLES[D.me.role].label)}</dd><dt>Načteno</dt><dd>${D.loadedAt.toLocaleTimeString('cs-CZ')} · ${Math.round(D.fetchMs)} ms</dd>` : ''}
          ${counts.map(([l, v]) => `<dt>${l}</dt><dd>${fmt(v)}</dd>`).join('')}
        </dl>
        <div class="head-actions" style="margin-top:14px">
          ${live ? '<button class="btn sm" data-a="dataReload">Načíst znovu</button><button class="btn white sm" data-a="dataMode" data-v="demo">Přepnout na ukázková data</button><button class="btn white sm" data-a="dataSignOut">Odhlásit z databáze</button>'
            : LIVE.configured ? '<button class="btn sm" data-a="dataMode" data-v="live">Přepnout na ostrá data</button>' : ''}
        </div>
      </section>
      <section class="panel"><div class="panel-head"><h2>Co je napojené</h2></div>
        <div class="table-wrap"><table><tbody>
          ${[['Rodiny, děti, obec, zařízení', 'ano', 'aplikace posílá po každém uložení'], ['Poslechy (pohádka, délka, dohráno)', 'ano', 'začátek a konec poslechu'], ['Používání, retence, heatmapa, výkon pohádek', 'ano', 'předpočítané souhrny v databázi'], ['Audit log', 'ano', 'zapisuje administrace'], ['Předplatné a platby', 'ne', 'v aplikaci zatím simulované; RevenueCat a Stripe'], ['Helpdesk', 'ne', 'příjem e-mailů a zpráv z aplikace'], ['Návštěvy webu', 'ne', 'Plausible'], ['Kupony v aplikaci', 'ne', 'pole na kód při registraci']].map(([a, b, c]) => `<tr><td>${a}</td><td class="${b === 'ano' ? 'status-ok' : 'status-warn'}">${b}</td><td class="muted">${c}</td></tr>`).join('')}
        </tbody></table></div>
      </section>
    </div>
    ${LIVE.configured ? '' : `<section class="panel" style="margin-top:12px"><div class="panel-head"><h2>Jak zapnout ostrá data</h2></div>
      <ol class="steps">
        <li>Založ projekt na <b>supabase.com</b> v regionu <b>EU</b> (Irsko nebo Frankfurt).</li>
        <li>V SQL Editoru spusť celý soubor <code>supabase/schema.sql</code>.</li>
        <li>V Authentication → Sign In / Providers zapni <b>Anonymous sign-ins</b> (rodiny nemusí zadávat e-mail).</li>
        <li>V Authentication → Users vytvoř svůj účet (e-mail a heslo) a v SQL přidej sebe do týmu: <code>insert into staff (user_id, name, role) select id, 'Jan', 'owner' from auth.users where email = 'tvuj@email';</code></li>
        <li>Do <code>config.js</code> v kořeni webu vlož Project URL a anon key (Project Settings → API) a nasaď.</li>
      </ol>
      <p class="hint" style="margin-top:10px">Podrobně v <code>supabase/README.md</code>. Lokálně se dá vyzkoušet bez účtu: <code>node supabase/dev-server.mjs</code> a admin/?db=http://localhost:54321.</p></section>`}`;
}
PAGES.data = pageData;

const AUD = { q: '', actor: 'all', kind: 'all', vt: null };
function pageAudit() {
  after.push(() => {
    AUD.vt = vtable($('#audList'), {
      cols: [
        { k: 'at', label: 'Kdy', w: '150px', html: (e) => `<span class="num">${fdate(e.at)} <span class="muted">${e.at.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}</span></span>` },
        { k: 'actor', label: 'Kdo', w: '130px', html: (e) => `<span class="av">${initials(API.staffName(e.actor))}</span>${esc(API.staffName(e.actor))}` },
        { k: 'action', label: 'Akce', w: '150px', html: (e) => `<span class="tag ${e.live ? 'honey' : 'line'}">${ACTION_LABEL[e.action.split('.')[0]] || e.action}</span> <span class="mono muted">${e.action.split('.')[1]}</span>` },
        { k: 'target', label: 'Objekt', w: '140px', html: (e) => (/^#\d+$/.test(e.target) ? `<a class="link" href="#helpdesk/${e.target.slice(1)}">${e.target}</a>` : /^f\d+$/.test(e.target) ? `<a class="link mono" href="#rodiny/${e.target}">${e.target}</a>` : esc(e.target)) },
        { k: 'detail', label: 'Detail', w: 'minmax(240px, 1fr)', html: (e) => `<span class="ell">${esc(e.detail)}</span>` },
      ],
      rowH: 38, key: (e) => e.at.getTime() + e.action,
      fetch: (c, l) => API.audit.list({ q: AUD.q, actor: AUD.actor, kind: AUD.kind }, c, l),
      foot: (s) => `${fmt(s.total)} záznamů · dotaz ${dec(s.ms)} ms · žlutě akce z tohoto prohlížeče`,
    });
    onLeave(() => { AUD.vt.destroy(); AUD.vt = null; });
  });
  const opt = (k, v, l) => `<option value="${v}" ${AUD[k] === v ? 'selected' : ''}>${esc(l)}</option>`;
  return `
    ${head('Audit log', 'Kdo co v administraci udělal. Záznamy nejdou upravit ani smazat.')}
    ${demoBar('Ve skutečnosti zapisuje backend do tabulky jen pro přidávání (append-only).')}
    <section class="panel">
      <div class="filters">
        <input type="search" data-f="audq" placeholder="Hledat objekt nebo detail" value="${esc(AUD.q)}" aria-label="Hledat v audit logu">
        <select data-f="audactor" aria-label="Kdo">${opt('actor', 'all', 'Všichni')}${API.staff.map((s) => opt('actor', s.id, s.name)).join('')}</select>
        <select data-f="audkind" aria-label="Oblast">${opt('kind', 'all', 'Všechny oblasti')}${Object.entries(ACTION_LABEL).map(([k, l]) => opt('kind', k, l)).join('')}</select>
      </div>
      <div class="vt-host" id="audList"></div>
    </section>`;
}
PAGES.audit = pageAudit;

// ---------- Hledání napříč administrací (⌘K) ----------
let PAL = null;
function openPalette() {
  modal(`<div class="palette" role="dialog" aria-modal="true" aria-label="Hledat">
    <input id="palQ" placeholder="Rodina, e-mail, dítě, #ticket, pohádka nebo stránka…" autocomplete="off" aria-label="Hledat">
    <div class="res" id="palRes" role="listbox"></div>
    <div class="foot"><span><kbd>↑↓</kbd> vybrat</span><span><kbd>↵</kbd> otevřít</span><span><kbd>Esc</kbd> zavřít</span><span style="margin-left:auto"><kbd>?</kbd> zkratky</span></div></div>`);
  PAL = { items: [], i: 0 };
  $('#palQ').focus();
  palSearch('');
}
function palSearch(q) {
  const nq = D.deacc(q.trim()), out = [];
  const add = (grp, href, label, sub) => out.push({ grp, href, label, sub });
  ROUTES.filter((r) => r.id && allowed(r) && (!nq || D.deacc(r.label).includes(nq))).slice(0, nq ? 4 : 12).forEach((r) => add('Stránky', '#' + r.id, r.label, ''));
  if (nq) {
    const m = nq.match(/^#?(\d{3,})$/);
    if (API.can('tickets.read')) {
      const ts = m ? [API.tickets.get(m[1])].filter(Boolean) : API.tickets.list({ view: 'all', q }, null, 6).items;
      ts.slice(0, 6).forEach((t) => add('Tickety', `#helpdesk/${t.id}`, `#${t.id} ${t.subject}`, API.TSTATUS[t.status]));
    }
    if (API.can('families.read')) API.families.list({ q, seg: 'all' }, null, 6).items.forEach((f) => add('Rodiny', `#rodiny/${f.id}`, famName(f), `${f.town} · ${f.kids.map((k) => k.name).join(', ')}`));
    if (API.can('content.edit')) STORIES.filter((s) => D.deacc(safeTitle(s) + ' ' + s.id).includes(nq)).slice(0, 4).forEach((s) => add('Pohádky', '#pohadky', safeTitle(s), s.id));
  }
  PAL.items = out; PAL.i = 0;
  let g = null;
  $('#palRes').innerHTML = out.map((x, i) => `${x.grp !== g ? `<div class="grp">${(g = x.grp)}</div>` : ''}<a href="${x.href}" role="option" data-pi="${i}" class="${i === 0 ? 'on' : ''}">${esc(x.label)}<small>${esc(x.sub)}</small></a>`).join('') || '<p class="muted" style="padding:14px">Nic nenalezeno.</p>';
}
function palMove(d) {
  if (!PAL.items.length) return;
  PAL.i = (PAL.i + d + PAL.items.length) % PAL.items.length;
  document.querySelectorAll('#palRes a').forEach((a) => a.classList.toggle('on', Number(a.dataset.pi) === PAL.i));
  $(`#palRes a[data-pi="${PAL.i}"]`).scrollIntoView({ block: 'nearest' });
}
function openHelp() {
  const k = (keys, t) => `<tr><td>${keys.map((x) => `<kbd>${x}</kbd>`).join(' ')}</td><td>${t}</td></tr>`;
  modal(`<div class="dialog narrow" role="dialog" aria-modal="true" aria-labelledby="hlpT">
    <div class="dialog-head"><h2 id="hlpT">Klávesové zkratky</h2><button class="x" data-a="close" aria-label="Zavřít">×</button></div>
    <div class="dialog-body"><table><tbody>
      ${k(['⌘ K'], 'Hledat cokoli (rodiny, tickety, stránky)')}${k(['g', 'h'], 'Helpdesk')}${k(['g', 'r'], 'Rodiny')}${k(['g', 'p'], 'Přehled')}${k(['g', 'u'], 'Používání')}${k(['g', 'f'], 'Platby')}
      ${k(['j', 'k'], 'Další / předchozí ticket')}${k(['r'], 'Odpovědět')}${k(['n'], 'Interní poznámka')}${k(['e'], 'Vyřešit ticket')}${k(['a'], 'Vzít si ticket')}${k(['/'], 'Hledat v seznamu')}${k(['⌘ ↵'], 'Odeslat odpověď')}${k(['↑', '↓', '↵'], 'Pohyb v tabulce a otevření řádku')}
    </tbody></table></div></div>`);
}

Object.assign(ACTIONS, {
  palette: () => openPalette(),
  invite: () => modal(`<div class="dialog narrow" role="dialog" aria-modal="true" aria-labelledby="invT">
    <div class="dialog-head"><h2 id="invT">Pozvat člena týmu</h2><button class="x" data-a="close" aria-label="Zavřít">×</button></div>
    <div class="dialog-body"><label for="invMail">E-mail</label><input id="invMail" type="email" placeholder="jmeno@example.cz"><label for="invRole">Role</label><select id="invRole">${Object.entries(API.ROLES).filter(([k]) => k !== 'owner').map(([k, r]) => `<option value="${k}">${r.label}</option>`).join('')}</select><p class="err" id="invErr"></p><p class="hint">Ukázka: pozvánka se nikam neposílá, jen se přidá do seznamu a audit logu.</p></div>
    <div class="dialog-foot"><div class="r"><button class="btn white" data-a="close">Zrušit</button><button class="btn" data-a="inviteSave">Pozvat</button></div></div></div>`),
  inviteSave: () => {
    const m = $('#invMail').value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(m)) { $('#invErr').textContent = 'Zadej platný e-mail.'; return; }
    API.invite(m, $('#invRole').value); closeModal(); render(); toast('Pozvánka je zapsaná (ukázka)');
  },
});

let audT;
document.addEventListener('input', (ev) => {
  const t = ev.target, f = t.dataset.f;
  if (t.id === 'palQ') palSearch(t.value);
  if (f === 'audq') { clearTimeout(audT); audT = setTimeout(() => { AUD.q = t.value; AUD.vt && AUD.vt.reset(); }, 120); }
});
document.addEventListener('change', (ev) => {
  const t = ev.target, f = t.dataset.f;
  if (f === 'audactor' || f === 'audkind') { AUD[f.slice(3)] = t.value; AUD.vt && AUD.vt.reset(); }
  if (f === 'staffRole') {
    if (D.live) D.team.role(t.dataset.id, t.value).then(teamRefresh).then(() => toast('Role je změněná'), (e) => { toast(e.message); render(); });
    else { API.setRole(t.dataset.id, t.value); toast('Role je změněná'); }
  }
  if (t.id === 'viewAs') { API.setViewAs(t.value); render(); toast(`Administrace jako: ${API.ROLES[t.value].label}`); }
});

// stav dat vlevo dole
$('#viewAs').insertAdjacentHTML('beforebegin', `<a class="mode ${D.live ? 'live' : ''}" href="#data" style="text-decoration:none"><i></i>${D.live ? 'Ostrá data' : 'Ukázková data'}</a>`);
Object.assign(ACTIONS, {
  dataReload: () => location.reload(),
  dataMode: (v) => { LIVE.setMode(v); location.reload(); },
  dataSignOut: () => { LIVE.signOut(); location.reload(); },
});
// role switcher vlevo dole
$('#viewAs').innerHTML = Object.entries(API.ROLES).map(([k, r]) => `<option value="${k}" ${API.viewAs === k ? 'selected' : ''}>${r.label}</option>`).join('');

let gPending = 0;
document.addEventListener('keydown', (ev) => {
  const t = ev.target;
  const typing = t.matches && t.matches('input, textarea, select, [contenteditable]');
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); if ($('#palQ')) closeModal(); else openPalette(); return; }
  if (PAL && t.id === 'palQ') {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); palMove(ev.key === 'ArrowDown' ? 1 : -1); return; }
    if (ev.key === 'Enter') { ev.preventDefault(); const it = PAL.items[PAL.i]; if (it) { closeModal(); location.hash = it.href; } return; }
  }
  if (document.body.classList.contains('locked') || $('#modal').innerHTML) return;
  if (hdKeys(ev, typing)) return;
  if (typing || ev.metaKey || ev.ctrlKey || ev.altKey) return;
  if (ev.key === '?') { openHelp(); return; }
  if (ev.key === 'g') { gPending = Date.now(); return; }
  if (Date.now() - gPending < 900) {
    const to = { h: 'helpdesk', r: 'rodiny', p: 'prehled', u: 'pouzivani', f: 'platby', a: 'audit', t: 'tym', o: 'pohadky', v: 'hlas' }[ev.key];
    gPending = 0; if (to) go(to);
  }
});
document.addEventListener('click', (ev) => { if (ev.target.closest('#palRes a')) closeModal(); });
// živé odpočty SLA v helpdesku bez přenačítání (jen viditelné řádky)
setInterval(() => { if (route() === 'helpdesk' && HD.vt && !document.hidden) HD.vt.refresh(); }, 60000);
