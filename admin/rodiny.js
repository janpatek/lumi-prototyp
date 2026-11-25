// ---------- Uživatelé (CRM; v kódu a databázi pořád „families“) ----------
// Seznam je virtualizovaný a čte se po stránkách; čísla ve sloupcích jsou z předpočítaného souhrnu rodiny.
// Detail rodiny dopočítá aktivitu až při otevření (v backendu endpoint /families/:id/activity).

const FAM = { q: '', seg: 'all', country: 'all', platform: 'all', sort: 'created', dir: -1, vt: null };

const famCols = () => [
  { k: 'name', label: 'Uživatel', w: 'minmax(190px, 1.5fr)', sort: true, html: (f) => `<span class="av">${f.email ? esc(initials(famName(f))) : 'H'}</span><span class="ell"><b>${esc(famName(f))}</b> <span class="muted">${esc(famMail(f)) || esc(f.id)}</span></span>` },
  { k: 'kids', label: 'Děti', w: 'minmax(120px, 1fr)', sort: true, html: kidsHtml },
  { k: 'town', label: 'Bydliště', w: '124px', sort: true, html: (f) => `<span class="ell">${esc(f.town)}</span> <span class="muted">${esc(f.country)}</span>` },
  { k: 'plan', label: 'Tarif', w: '136px', html: subTag },
  { k: 'plays30', label: 'Přehrání 30 d', w: '92px', cls: 'r', sort: true, html: (f) => (f.analytics === false ? '<span class="muted" title="Bez souhlasu se statistikami">–</span>' : fmt(f.plays30)) },
  { k: 'min30', label: 'Minut 30 d', w: '84px', cls: 'r', sort: true, html: (f) => (f.analytics === false ? '<span class="muted">–</span>' : fmt(f.min30)) },
  { k: 'days30', label: 'Aktivní dny', w: '110px', sort: true, html: (f) => `<span class="meter" style="width:44px"><i style="width:${(f.days30 / 30) * 100}%"></i></span><span class="num">${f.days30}/30</span>` },
  { k: 'health', label: 'Zdraví', w: '64px', cls: 'r', sort: true, html: (f) => healthTag(f.health) },
  { k: 'cost30', label: 'Náklady 30 d', w: '96px', cls: 'r', sort: true, html: (f) => costCell(f) },
  { k: 'last', label: 'Naposledy', w: '100px', sort: true, html: (f) => `<span class="muted">${ago(f.lastSeen)}</span>` },
  { k: 'created', label: 'Registrace', w: '92px', sort: true, html: (f) => `<span class="num">${fdate(f.created)}</span>` },
];
// Variabilní náklady uživatele: kredity ElevenLabs za věty, které se kvůli němu opravdu namluvily (ne z mezipaměti).
// Kč = kredity × cena kreditu (ostře podle tarifu z tts-workeru, jinak ručně zadaná cena ze stránky Hlas a náklady).
function creditKc() {
  const manual = (Number(store.get(TTS_KEY)) || 4) / 1000;
  if (!D.live) return manual;
  loadCosts();
  return COST.state === 'ok' ? creditPrice(COST.data).perCredit : manual;
}
const kcSmall = (v) => (v >= 10 ? kc(v) : `${dec(v, 2)} Kč`);
const costCell = (f) => (!f.usage || !f.usage.chars30 ? '<span class="muted">0 Kč</span>' : `<span class="num" title="${fmt(f.usage.chars30)} kreditů · ${fmt(f.usage.clips30)} vět · ${fmt(f.usage.changes30)} změn">${kcSmall(f.usage.chars30 * creditKc())}</span>`);
const famQuery = () => ({ q: FAM.q, seg: FAM.seg, country: FAM.country, platform: FAM.platform, sort: FAM.sort, dir: FAM.dir });

function pageFamilies() {
  const p = routeParam();
  if (/^f\d+$/.test(p)) return pageFamily(p);
  if (p.startsWith('segment-') && API.SEGMENTS[p.slice(8)]) FAM.seg = p.slice(8);
  const opt = (k, v, l) => `<option value="${v}" ${FAM[k] === v ? 'selected' : ''}>${l}</option>`;
  after.push(() => {
    FAM.vt = vtable($('#famList'), {
      cols: famCols(), rowH: 40, key: (f) => f.id, sort: { k: FAM.sort, dir: FAM.dir },
      fetch: (c, l) => API.families.list(famQuery(), c, l),
      onOpen: (f) => go('uzivatele/' + f.id),
      onSort: (k) => { FAM.dir = FAM.sort === k ? -FAM.dir : -1; FAM.sort = k; render(); },
      foot: (s) => `${fmt(s.total)} ${plural(s.total, 'uživatel', 'uživatelé', 'uživatelů')} · načteno ${fmt(s.loaded)} · dotaz ${dec(s.ms)} ms · v DOM jen viditelné řádky`,
    });
    const vt = FAM.vt;
    onLeave(() => { vt.destroy(); if (FAM.vt === vt) FAM.vt = null; });
  });
  const localNote = LOCAL ? `<div class="notice" style="margin:0 0 12px"><img src="../brand/maskot-3d/web/ospalek-hlava.webp" alt=""><div>V tomhle prohlížeči je uložená i skutečný uživatel z aplikace: ${LOCAL.kids} ${plural(LOCAL.kids, 'dítě', 'děti', 'dětí')}, ${esc(LOCAL.town)}${LOCAL.premium ? ', předplatné (demo)' : ''}. Do seznamu se nepočítá.</div></div>` : '';
  return `
    ${head('Uživatelé', 'Účty, děti a jak aplikaci používají', `${API.can('tickets.reply') ? `<button class="btn white" data-a="tNew">${I.chat}Nový ticket</button>` : ''}<button class="btn white" data-a="famCsv">${I.down}Export CSV</button>`)}
    ${demoBar()}
    ${localNote}
    ${costSummary()}
    <div class="chips tight" style="margin-bottom:10px">${Object.entries(API.SEGMENTS).filter(([k]) => k !== 'test' || (D.live && D.testFamilies)).map(([k, v]) => `<button class="chip ${FAM.seg === k ? 'on' : ''}" data-a="famSeg" data-v="${k}">${v.label} <span class="n">${fmt(API.families.count(k))}</span></button>`).join('')}</div>
    <section class="panel">
      <div class="filters">
        <input type="search" data-f="famq" placeholder="Hledat jméno, e-mail, dítě, město nebo id" value="${esc(FAM.q)}" aria-label="Hledat uživatele">
        <select data-f="famcountry" aria-label="Země">${opt('country', 'all', 'ČR i SR')}${opt('country', 'CZ', 'Česko')}${opt('country', 'SK', 'Slovensko')}</select>
        <select data-f="famplatform" aria-label="Zařízení">${opt('platform', 'all', 'Všechna zařízení')}${opt('platform', 'iOS', 'iOS')}${opt('platform', 'Android', 'Android')}${opt('platform', 'Web', 'Web')}</select>
      </div>
      <div class="vt-host" id="famList"></div>
    </section>`;
}
PAGES.rodiny = pageFamilies;
// Souhrn variabilních nákladů nad seznamem (30 dní)
function costSummary() {
  const per = creditKc(), act = D.families.filter((f) => f.days30 > 0);
  const chars = D.families.reduce((s, f) => s + (f.usage ? f.usage.chars30 : 0), 0);
  const changers = D.families.filter((f) => f.usage && f.usage.changes30 >= 3).length;
  const top = [...D.families].filter((f) => f.usage && f.usage.chars30).sort((x, y) => y.usage.chars30 - x.usage.chars30);
  const top10 = top.slice(0, Math.max(1, Math.ceil(top.length / 10))).reduce((s, f) => s + f.usage.chars30, 0);
  return `<div class="tiles" style="margin-bottom:12px">
    ${tile('Náklady na hlas za 30 dní', kcSmall(chars * per), `${fmt(chars)} kreditů, jen věty se jmény`)}
    ${tile('Na aktivního uživatele', kcSmall((chars * per) / Math.max(1, act.length)), `${fmt(act.length)} aktivních za 30 dní`)}
    ${tile('Nejdražších 10 %', chars ? pct(top10, chars) : '–', 'podíl na nákladech za 30 dní')}
    ${tile('Často mění údaje', fmt(changers), `<a class="link" href="#uzivatele/segment-changers">3+ změny jmen, dětí nebo obce za 30 dní</a>`)}
  </div>`;
}

// Kalendář aktivity (posledních 26 týdnů), sloupec = týden, řádek = den v týdnu
function calHeat(plays) {
  const N = D.days, cell = 13, gap = 3, weeks = 26;
  const lastW = D.weekOf(N - 1);
  const max = Math.max(1, ...plays);
  let s = '';
  for (let i = N - 1; i >= 0; i--) {
    const w = weeks - 1 - (lastW - D.weekOf(i)); if (w < 0) break;
    const dow = (D.dayAt(i).getDay() + 6) % 7, v = plays[i];
    s += `<rect x="${24 + w * (cell + gap)}" y="${dow * (cell + gap)}" width="${cell}" height="${cell}" fill="${v ? 'var(--s1)' : 'var(--lavender-soft)'}" fill-opacity="${v ? 0.25 + 0.75 * (v / max) : 1}"><title>${fday(D.dayAt(i))}: ${v} ${plural(v, 'přehrání', 'přehrání', 'přehrání')}</title></rect>`;
  }
  ['po', '', 'st', '', 'pá', '', 'ne'].forEach((l, d) => { if (l) s += `<text x="0" y="${d * (cell + gap) + 10}" font-size="10" fill="var(--ink-muted)">${l}</text>`; });
  const W = 24 + weeks * (cell + gap), H = 7 * (cell + gap);
  return `<svg class="cal" viewBox="0 0 ${W} ${H}" role="img" aria-label="Kalendář poslechu za 26 týdnů">${s}</svg>`;
}
const miniBars = (vals, labels) => {
  const mx = Math.max(1, ...vals);
  return `<div class="mini-bars">${vals.map((v, i) => `<i style="height:${(v / mx) * 100}%" title="${esc(labels[i])}: ${fmt(v)}"></i>`).join('')}</div>`;
};

function pageFamily(id) {
  const f = API.families.get(id);
  if (!f) return `${head('Uživatel nenalezen')}<p><a class="link" href="#uzivatele">Zpět na uživatele</a></p>`;
  const t0 = performance.now();
  // bez souhlasu se statistikami nejsou poslechy rodiny v databázi přiřazené, detail ukáže jen CRM údaje
  const noStats = D.live && f.analytics === false;
  const a = noStats ? emptyActivity(f) : API.families.activity(id);
  const ms = performance.now() - t0;
  if (!a) {
    // ostrý režim: poslechy rodiny se načtou z databáze a stránka se pak vykreslí znovu
    API.families.loadActivity(id).then(() => { if (route() === 'rodiny' && routeParam() === id) render(); }, (e) => { const el = $('#famLoading'); if (el) el.textContent = 'Poslechy se nepodařilo načíst: ' + e.message; });
    return `${head(esc(famName(f)))}<p class="muted" id="famLoading">Načítám poslechy uživatele…</p>`;
  }
  const pays = API.can('billing.read') ? API.families.payments(id) : [];
  const tks = API.can('tickets.read') ? API.families.tickets(id) : [];
  const gifts = API.families.gifts(id);
  const N = D.days;
  // týdenní poslech za posledních 12 týdnů
  const wk = Array.from({ length: 12 }, (_, k) => { const end = N - 1 - (11 - k) * 7; let p = 0, m = 0; for (let i = end - 6; i <= end; i++) if (i >= 0) { p += a.series.plays[i]; m += a.series.minutes[i]; } return { p, m: Math.round(m), l: fshort(D.dayAt(Math.max(0, end - 6))) }; });
  after.push(() => chart($('#chFam'), { type: 'bar', labels: wk.map((w) => w.l), titles: wk.map((w) => `Týden od ${w.l}`), series: [{ name: 'Minut poslechu', color: 'var(--s1)', values: wk.map((w) => w.m) }] }));
  const catMin = D.catIds.map((c, i) => [catLabel(c), a.cat[i]]).sort((x, y) => y[1] - x[1]);
  const cmax = Math.max(1, ...catMin.map((x) => x[1]));
  const bystory = {};
  a.series.events.forEach((e) => { const s = bystory[e.story] || (bystory[e.story] = { n: 0, done: 0, min: 0 }); s.n++; s.min += e.min; if (e.done) s.done++; });
  const stRows = Object.entries(bystory).sort((x, y) => y[1].n - x[1].n);
  const title = (sid) => { const s = STORIES.find((x) => x.id === sid); return s ? safeTitle(s, f.kids[0]?.g === 'f' ? 'f' : 'm') : sid; };
  const tl = [
    { at: f.created, c: 'var(--s1)', t: `Registrace (${esc(f.source)}, ${esc(f.platform)})` },
    f.trialI >= 0 && { at: D.dayAt(f.trialI), c: 'var(--honey)', t: 'Začal zkušební týden' },
    f.subI >= 0 && f.plan !== 'dárek' && { at: D.dayAt(f.subI), c: 'var(--s3)', t: 'Předplatné (129 Kč měsíčně)' },
    f.subEnd >= 0 && { at: D.dayAt(f.subEnd), c: 'var(--s2)', t: 'Zrušení předplatného' },
    ...pays.map((p) => ({ at: p.at, c: p.status === 'zaplaceno' ? 'var(--s3)' : 'var(--s2)', t: `Platba ${kc(p.czk)} · ${esc(p.status)}` })),
    ...tks.map((t) => ({ at: t.created, c: 'var(--s4)', t: `Ticket <a class="link" href="#helpdesk/${esc(t.id)}">#${esc(t.id)} ${esc(t.subject)}</a>` })),
    ...gifts.map((g) => ({ at: g.at, c: 'var(--honey)', t: `Dárek: ${esc(g.months)} ${plural(g.months, 'měsíc', 'měsíce', 'měsíců')} zdarma` })),
    { at: f.lastSeen, c: 'var(--line)', t: 'Naposledy v aplikaci' },
  ].filter(Boolean).sort((x, y) => y.at - x.at);
  const canE = API.can('families.edit'), canDel = API.can('families.delete'), canGift = API.can('billing.refund');
  return `
    <div class="head">
      <div class="fam-head">
        <a class="btn white sm" href="#uzivatele">${I.back}Uživatelé</a>
        <div class="avatar">${f.email ? esc(initials(famName(f))) : 'H'}</div>
        <div><h1>${esc(famName(f))}</h1><p>${esc(famMail(f)) || 'Bez e-mailu (host)'} · <span class="mono">${esc(f.id)}</span> · ${esc(f.town)} ${esc(f.country)} · ${subTag(f)} ${f.tags.map((x) => `<span class="tag line">${esc(x)}</span>`).join(' ')}</p></div>
      </div>
      <div class="head-actions">
        ${API.can('tickets.reply') && f.email ? `<button class="btn white sm" data-a="tNew">${I.chat}Nový ticket</button>` : ''}
        ${canGift && f.email ? `<button class="btn white sm" data-a="famGift" data-v="${esc(f.id)}">${I.gift}Darovat měsíc</button>` : ''}
        ${D.live && D.setTest && API.can('families.edit') ? `<button class="btn white sm" data-a="famTest" data-v="${esc(f.id)}">${f.test ? 'Není testovací' : 'Označit jako testovací'}</button>` : ''}
        ${canDel ? `<button class="btn white sm" data-a="famExport" data-v="${esc(f.id)}">${I.down}Export dat (GDPR)</button><button class="btn danger sm" data-a="famDelete" data-v="${esc(f.id)}">Smazat uživatele</button>` : ''}
      </div>
    </div>
    ${demoBar(D.live ? '' : `Aktivita se dopočítala za ${dec(ms)} ms.`)}
    ${f.test ? `<div class="locked-note">Testovací účet${f.testManual === true ? ' (označený ručně)' : ' (automaticky: člen týmu, kód pro recenzenty, tester obchodu nebo dítě „Test“)'}. Do metrik se nepočítá: přehled, používání, předplatné ani náklady.</div>` : ''}
    ${noStats ? '<div class="locked-note">Uživatel nedal souhlas se statistikami poslechu. Účet, děti a obec vidíš kvůli podpoře, poslechy jsou jen v anonymních souhrnech.</div>' : ''}
    <div class="tiles t8">
      ${tile('Přehrání celkem', fmt(a.plays), `${fmt(f.plays30)} za 30 dní`)}
      ${tile('Hodin poslechu', dec(a.minutes / 60), `${fmt(f.min30)} min za 30 dní`)}
      ${tile('Aktivní dny (30 d)', `${f.days30}/30`, `celkem ${fmt(a.days)} dní`)}
      ${tile('Zdraví účtu', healthTag(f.health), f.risk ? '<span class="down">Platí, ale přestali poslouchat</span>' : `naposledy ${ago(f.lastSeen)}`)}
      ${tile('Dokončené pohádky', pct(a.done, a.plays), 'poslechnuto až do konce')}
      ${tile('Průměr na aktivní den', dec(a.minutes / Math.max(1, a.days)) + ' min', `${dec(a.plays / Math.max(1, a.days))} přehrání`)}
      ${tile('Zaplaceno celkem', API.can('billing.read') ? kc(pays.filter((p) => p.status === 'zaplaceno').reduce((s, p) => s + p.czk, 0)) : '–', `${pays.length} ${plural(pays.length, 'platba', 'platby', 'plateb')}`)}
      ${tile('Tickety', fmt(tks.length), `${tks.filter((t) => API.OPEN.has(t.status)).length} otevřených`)}
    </div>
    <div class="grid21">
      <section class="panel"><div class="panel-head"><h2>Kdy poslouchají (26 týdnů)</h2><span class="hint">sytější = víc přehrání</span></div>${calHeat(a.series.plays)}
        <div class="grid2" style="margin-top:14px">
          <div><h2 style="margin-bottom:8px">Minuty po týdnech</h2><div class="chart" id="chFam"></div></div>
          <div><h2 style="margin-bottom:8px">Denní doba</h2>${miniBars(Array.from(a.hours), Array.from({ length: 24 }, (_, h) => `${h}:00`))}<div class="mini-axis"><span>0</span><span>6</span><span>12</span><span>18</span><span>23</span></div>
            <h2 style="margin:16px 0 8px">Oblíbené kategorie</h2><div class="bars">${catMin.map(([l, m]) => `<div class="b"><span>${esc(l)}</span><span class="t"><i style="width:${(m / cmax) * 100}%"></i></span><span class="r num">${fmt(m)}′</span></div>`).join('')}</div></div>
        </div>
      </section>
      <section class="panel"><div class="panel-head"><h2>Děti</h2></div>
        <div class="kids">${f.kids.map((k, i) => `<div class="kidcard"><b>${API.can('families.pii') ? esc(k.name) : `Dítě ${i + 1}`}</b><div class="muted">${k.g === 'f' ? 'holka' : 'kluk'}, ${esc(k.age)} ${plural(k.age, 'rok', 'roky', 'let')}</div><div style="margin-top:6px;font-size:12px">Hrdinou <b>${fmt(a.hero[i])}×</b></div></div>`).join('')}</div>
        <h2 style="margin:16px 0 8px">Zařízení</h2>
        <dl class="kv"><dt>Platforma</dt><dd>${esc(f.platform)}</dd><dt>Verze aplikace</dt><dd>${esc(f.appVer)}${f.platform !== 'Web' && f.appVer !== '1.4.2' ? ' <span class="tag peach">stará</span>' : ''}</dd><dt>Registrace</dt><dd>${fdate(f.created)}</dd><dt>Zdroj</dt><dd>${esc(f.source)}</dd></dl>
        <h2 style="margin:16px 0 8px">Interní poznámka</h2>
        <textarea data-f="famNote" data-id="${esc(f.id)}" rows="4" style="font-family:var(--body);font-size:13px" ${canE ? '' : 'disabled'} placeholder="Vidí jen tým. Uloží se po opuštění pole.">${esc(API.families.note(f.id))}</textarea>
      </section>
    </div>
    <div class="grid2" style="margin-top:16px">
      <section class="panel"><div class="panel-head"><h2>Nastavení a souhlasy</h2><span class="hint">jak to má uživatel v aplikaci teď</span></div>${settingsHtml(f)}</section>
      <section class="panel"><div class="panel-head"><h2>Náklady na hlas</h2><span class="hint">jen variabilní: věty se jmény namluvené kvůli tomuto uživateli</span></div>${usageHtml(f, a)}</section>
    </div>
    <div class="grid3">
      <section class="panel"><div class="panel-head"><h2>Pohádky</h2></div>
        <div class="table-wrap"><table><thead><tr><th>Pohádka</th><th class="r">Přehrání</th><th class="r">Do konce</th></tr></thead><tbody>
        ${stRows.map(([sid, s]) => `<tr><td>${esc(title(sid))}</td><td class="r num">${fmt(s.n)}</td><td class="r num">${pct(s.done, s.n)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Zatím nic.</td></tr>'}</tbody></table></div>
      </section>
      <section class="panel"><div class="panel-head"><h2>Platby</h2>${API.can('billing.read') ? '<a class="btn white sm" href="#platby">Všechny</a>' : ''}</div>
        ${API.can('billing.read') ? `<div class="table-wrap"><table><thead><tr><th>Datum</th><th>Obchod</th><th class="r">Částka</th><th>Stav</th></tr></thead><tbody>
        ${pays.slice(0, 8).map((p) => `<tr><td class="num">${fdate(p.at)}</td><td>${esc(p.store)}</td><td class="r num">${p.cur === 'EUR' ? `${dec(p.amount, 2)} €` : kc(p.czk)}</td><td>${payTag(p.status)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Žádné platby.</td></tr>'}</tbody></table></div>` : '<p class="muted">Tvoje role platby nevidí.</p>'}
      </section>
      <section class="panel"><div class="panel-head"><h2>Časová osa</h2></div>
        <ul class="timeline">${tl.map((e) => `<li><span class="when">${fdate(e.at)}</span><i class="dot" style="--c:${e.c}"></i><span>${e.t}</span></li>`).join('')}</ul>
      </section>
    </div>`;
}
// ---------- Nastavení a souhlasy ----------
const THEMES = { auto: 'podle času', light: 'den', dark: 'noc' };
const yesNo = (v, at, yes = 'ano', no = 'ne') => (v ? `<span class="status-ok">${yes}</span>${at ? ` <span class="muted">od ${fdate(at)}</span>` : ''}` : `<span class="muted">${no}</span>`);
// f.settings je libovolný JSON, který pošle aplikace (tedy kdokoli s veřejným klíčem): do HTML z něj smí jen čísla
// převedená přes num() a hodnoty porovnané s výčtem, nikdy syrový řetězec.
function settingsHtml(f) {
  const raw = f.settings, st = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  const push = num(f.push), rel = st ? num(st.relatives, 99) : 0, places = st ? num(st.places, 999) : 0, heroes = st ? num(st.heroes, 99) : 0;
  const favs = st ? num(st.favs, 99999) : 0, heard = st ? num(st.heard, 99999) : 0, chg = st ? num(st.changesMonth, 999) : 0;
  const P = { device: 'bez přihlášení', guest: 'host', google: 'Google', apple: 'Apple', email: 'e-mail' };
  const notify = !st ? '–' : st.notify === 'on' ? `<span class="status-ok">zapnutá</span>${push ? ` <span class="muted">${push} ${plural(push, 'zařízení', 'zařízení', 'zařízení')}</span>` : ' <span class="muted">upozornění zatím nedorazilo do žádného zařízení</span>'}` : st.notify === 'off' ? '<span class="muted">odmítnutá</span>' : '<span class="muted">zatím se nerozhodl</span>';
  const theme = st && typeof st.theme === 'string' && Object.hasOwn(THEMES, st.theme) ? THEMES[st.theme] : '';
  return `<dl class="kv">
      <dt>Novinky e-mailem (marketing)</dt><dd>${f.email ? yesNo(f.newsletter, f.newsletterAt, 'souhlasí') : '<span class="muted">bez e-mailu, nejde oslovit</span>'}</dd>
      <dt>Statistiky poslechu</dt><dd>${yesNo(f.analytics, f.analyticsAt, 'souhlasí')}</dd>
      <dt>Večerní připomínka</dt><dd>${notify}</dd>
      <dt>Účet</dt><dd>${esc((typeof f.provider === 'string' && Object.hasOwn(P, f.provider) && P[f.provider]) || (f.email ? 'přihlášený' : 'bez přihlášení'))}${f.onboarded === false ? ' <span class="tag peach">nedokončil nastavení</span>' : ''}</dd>
      <dt>Předplatné</dt><dd>${subTag(f)}${st && st.code ? ' <span class="tag line">odemčeno kódem</span>' : ''}</dd>
      ${st ? `<dt>Vzhled</dt><dd>${theme || '–'}</dd>
      <dt>Profil</dt><dd>${f.kids.length} ${plural(f.kids.length, 'dítě', 'děti', 'dětí')} · ${rel} ${plural(rel, 'blízký', 'blízcí', 'blízkých')} · ${places} ${plural(places, 'místo', 'místa', 'míst')}</dd>
      <dt>Hrdinové pohádek</dt><dd>${heroes}</dd>
      <dt>Oblíbené pohádky</dt><dd>${fmt(favs)}</dd>
      <dt>Dohrané pohádky (v zařízení)</dt><dd>${fmt(heard)}</dd>
      <dt>Změny tento měsíc</dt><dd>${chg} z 10${chg >= 10 ? ' <span class="tag peach">vyčerpáno</span>' : ''}</dd>` : ''}
    </dl>
    ${st ? '' : '<p class="hint" style="margin-top:10px">Nastavení aplikace zatím nepřišlo: uživatel má starší verzi aplikace, nebo od aktualizace aplikaci neotevřel.</p>'}
    <p class="hint" style="margin-top:10px">Jména blízkých, místa ani oblíbené věci na server nejdou, vidíš jen počty.</p>`;
}

// ---------- Náklady na hlas (variabilní) ----------
function usageHtml(f, a) {
  if (!f.usageDays) {
    if (D.familyUsageAsync) D.familyUsageAsync(f).then(() => { if (route() === 'rodiny' && routeParam() === f.id) render(); }, (e) => { const el = $('#famUsage'); if (el) el.textContent = 'Náklady se nepodařilo načíst: ' + e.message; });
    return '<p class="muted" id="famUsage">Načítám náklady…</p>';
  }
  const u = f.usage || {}, per = creditKc(), days = f.usageDays;
  const all = D.families.filter((x) => x.usage), avg30 = all.reduce((s, x) => s + x.usage.chars30, 0) / Math.max(1, all.filter((x) => x.days30 > 0).length);
  const vs = u.chars30 && avg30 ? u.chars30 / avg30 : 0;
  const plays = a.plays || f.plays || 0;
  const changes = (u.names || 0) + (u.kids || 0) + (u.towns || 0);
  const rows = days.filter((d) => d.clips || d.names || d.kids || d.towns).slice(-12).reverse();
  const what = (d) => [d.names && `${d.names}× jméno`, d.kids && `${d.kids}× dítě`, d.towns && `${d.towns}× obec`].filter(Boolean).join(', ') || '<span class="muted">nové pohádky</span>';
  return `<div class="tiles" style="grid-template-columns:repeat(2,minmax(0,1fr));margin-bottom:12px">
      ${tile('Za 30 dní', kcSmall((u.chars30 || 0) * per), vs ? `${dec(vs, 1)}× průměr aktivního uživatele` : 'nic se nenamlouvalo')}
      ${tile('Od registrace', kcSmall((u.chars || 0) * per), `${fmt(u.chars || 0)} kreditů · ${fmt(u.clips || 0)} vět`)}
      ${tile('Změny jmen, dětí a obce', fmt(changes), `${fmt(u.changes30 || 0)} za 30 dní · jméno ${fmt(u.names || 0)}× · dítě ${fmt(u.kids || 0)}× · obec ${fmt(u.towns || 0)}×`)}
      ${tile('Na jedno přehrání', plays ? kcSmall(((u.chars || 0) * per) / plays) : '–', plays ? `${fmt(plays)} přehrání` : D.live && f.analytics === false ? 'přehrání nevidíme (bez souhlasu)' : 'zatím bez poslechu')}
    </div>
    <div class="table-wrap"><table><thead><tr><th>Den</th><th>Co se stalo</th><th class="r">Vět</th><th class="r">Kreditů</th><th class="r">Kč</th></tr></thead><tbody>
    ${rows.map((d) => `<tr><td class="num">${fdate(D.dayAt(d.i))}</td><td>${what(d)}</td><td class="r num">${fmt(d.clips)}</td><td class="r num">${fmt(d.chars)}</td><td class="r num">${kcSmall(d.chars * per)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Zatím se kvůli tomuto uživateli nic nenamlouvalo.</td></tr>'}
    </tbody></table></div>
    <p class="hint" style="margin-top:8px">Věty se jménem se platí jen poprvé: stejnou větu pro jiného Toníka už bere hlasový server z mezipaměti zdarma. Každá změna jména, dítěte nebo obce znamená namluvit znovu vše, co pak uživatel poslouchá. Cena kreditu ${dec(per * 1000, 2)} Kč za 1 000${D.live && COST.state !== 'ok' ? ' (ručně zadaná, tarif se ještě nenačetl)' : ''}.${D.live ? ' Měří se od 15. 11. 2026 a jen v aplikaci, která už posílá přihlášení do hlasového serveru.' : ''}</p>`;
}

const emptyActivity = (f) => ({ plays: 0, minutes: 0, days: 0, cat: [0, 0, 0, 0], story: {}, hero: f.kids.map(() => 0), done: 0, hours: new Float64Array(24), series: { plays: new Uint16Array(D.days), minutes: new Float32Array(D.days), events: [] } });
const payTag = (s) => `<span class="tag ${s === 'zaplaceno' ? 'mint' : s === 'vráceno' ? 'line' : 'peach'}">${esc(s)}</span>`;

function famCsv() {
  const pii = API.can('families.pii');
  const rows = [['id', pii ? 'email' : 'email (skryto)', 'registrace', 'deti', 'mesto', 'zeme', 'stav', 'tarif', 'prehrani_30d', 'minut_30d', 'aktivni_dny_30d', 'zdravi', 'naposledy', 'zdroj', 'zarizeni']];
  let cur = null;
  do {
    const pg = API.families.list(famQuery(), cur, 1000);
    pg.items.forEach((f) => rows.push([f.id, pii ? f.email || 'host' : famMail(f), iso(f.created), f.kids.length, f.town, f.country, f.status || '', f.plan || '', f.plays30, Math.round(f.min30), f.days30, f.health, iso(f.lastSeen), f.source, f.platform]));
    cur = pg.next;
  } while (cur);
  return rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
}

let famT;
Object.assign(ACTIONS, {
  famSeg: (v) => { FAM.seg = v; const h = 'uzivatele/segment-' + v; if (location.hash === '#' + h) render(); else go(h); },
  famCsv: () => { download('ospalek-uzivatele-ukazka.csv', '﻿' + famCsv(), 'text/csv'); API.log('family.export', 'seznam', `Export CSV (${FAM.seg})`); toast('CSV se stahuje'); },
  famTest: (v) => {
    const f = API.families.get(v); if (!f) return;
    // ruční označení; zrušení u automaticky testovacího účtu ho ručně označí jako skutečného uživatele
    const val = !f.test;
    confirmBox(val ? 'Označit jako testovací účet?' : 'Vrátit mezi skutečné uživatele?', val ? 'Účet zmizí z metrik (přehled, používání, předplatné, náklady) a najdeš ho v Uživatelé → Testovací.' : 'Účet se zase započítá do metrik.', val ? 'Označit' : 'Vrátit', () =>
      D.setTest(f, val).then(() => { toast(val ? 'Označeno jako testovací, načítám znovu…' : 'Vráceno mezi uživatele, načítám znovu…'); setTimeout(() => location.reload(), 600); }, (e) => toast('Nepovedlo se: ' + e.message)));
  },
  famGift: (v) => confirmBox('Darovat měsíc předplatného?', 'V ukázce se jen zapíše do časové osy a audit logu. Skutečně by náš server uživateli zapnul dočasný přístup.', 'Darovat', () => { API.families.gift(v, 1); render(); toast('Dárek je zapsaný'); }),
  famExport: (v) => {
    const f = API.families.get(v), a = API.families.activity(v);
    const data = { rodina: { id: f.id, email: f.email, jmeno: f.name, bydliste: f.town, zeme: f.country, registrace: f.created, zarizeni: f.platform }, deti: f.kids, predplatne: { stav: f.status, tarif: f.plan }, platby: API.families.payments(v), tickety: API.families.tickets(v).map((t) => ({ id: t.id, predmet: t.subject, zpravy: t.msgs.filter((m) => m.from !== 'note') })), poslech: a.series.events.map((e) => ({ den: iso(D.dayAt(e.i)), hodina: e.hour, pohadka: e.story, minut: Math.round(e.min * 10) / 10 })) };
    download(`ospalek-export-${v}.json`, JSON.stringify(data, null, 2), 'application/json');
    API.log('family.export', v, 'Export údajů uživatele (GDPR)'); toast('Export se stahuje');
  },
  famDelete: (v) => confirmBox('Smazat uživatele?', `Uživatel ${esc(v)} zmizí ze seznamů. ${D.live ? 'Smazání je nevratné: zmizí účet, děti i všechny poslechy v databázi.' : 'V ukázce se to dá vrátit smazáním dat prohlížeče, ve skutečném systému je smazání nevratné a týká se i nahrávek.'}`, 'Smazat', () => {
    if (!D.live) { API.families.remove(v); go('uzivatele'); toast('Uživatel je smazaný (ukázka)'); return; }
    API.families.removeLive(v).then(() => { go('uzivatele'); toast('Uživatel je smazaný i s poslechy a účtem'); }, (e) => toast('Smazání se nepovedlo: ' + e.message));
  }),
});
document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.dataset.f === 'famq') { clearTimeout(famT); famT = setTimeout(() => { FAM.q = t.value; FAM.vt && FAM.vt.reset(); }, 120); }
});
document.addEventListener('change', (ev) => {
  const t = ev.target, f = t.dataset.f;
  if (f === 'famcountry' || f === 'famplatform') { FAM[f.slice(3)] = t.value; FAM.vt && FAM.vt.reset(); }
  if (f === 'famNote') { API.families.setNote(t.dataset.id, t.value); toast('Poznámka je uložená'); }
});
