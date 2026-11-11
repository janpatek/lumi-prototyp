// ---------- Rodiny (CRM) ----------
// Seznam je virtualizovaný a čte se po stránkách; čísla ve sloupcích jsou z předpočítaného souhrnu rodiny.
// Detail rodiny dopočítá aktivitu až při otevření (v backendu endpoint /families/:id/activity).

const FAM = { q: '', seg: 'all', country: 'all', platform: 'all', sort: 'created', dir: -1, vt: null };

const famCols = () => [
  { k: 'name', label: 'Rodina', w: 'minmax(190px, 1.5fr)', sort: true, html: (f) => `<span class="av">${f.email ? initials(famName(f)) : 'H'}</span><span class="ell"><b>${esc(famName(f))}</b> <span class="muted">${esc(famMail(f)) || f.id}</span></span>` },
  { k: 'kids', label: 'Děti', w: 'minmax(120px, 1fr)', sort: true, html: kidsHtml },
  { k: 'town', label: 'Bydliště', w: '124px', sort: true, html: (f) => `<span class="ell">${esc(f.town)}</span> <span class="muted">${f.country}</span>` },
  { k: 'plan', label: 'Tarif', w: '136px', html: subTag },
  { k: 'plays30', label: 'Přehrání 30 d', w: '92px', cls: 'r', sort: true, html: (f) => (f.analytics === false ? '<span class="muted" title="Bez souhlasu se statistikami">–</span>' : fmt(f.plays30)) },
  { k: 'min30', label: 'Minut 30 d', w: '84px', cls: 'r', sort: true, html: (f) => (f.analytics === false ? '<span class="muted">–</span>' : fmt(f.min30)) },
  { k: 'days30', label: 'Aktivní dny', w: '110px', sort: true, html: (f) => `<span class="meter" style="width:44px"><i style="width:${(f.days30 / 30) * 100}%"></i></span><span class="num">${f.days30}/30</span>` },
  { k: 'health', label: 'Zdraví', w: '64px', cls: 'r', sort: true, html: (f) => healthTag(f.health) },
  { k: 'last', label: 'Naposledy', w: '100px', sort: true, html: (f) => `<span class="muted">${ago(f.lastSeen)}</span>` },
  { k: 'created', label: 'Registrace', w: '92px', sort: true, html: (f) => `<span class="num">${fdate(f.created)}</span>` },
];
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
      onOpen: (f) => go('rodiny/' + f.id),
      onSort: (k) => { FAM.dir = FAM.sort === k ? -FAM.dir : -1; FAM.sort = k; render(); },
      foot: (s) => `${fmt(s.total)} ${plural(s.total, 'rodina', 'rodiny', 'rodin')} · načteno ${fmt(s.loaded)} · dotaz ${dec(s.ms)} ms · v DOM jen viditelné řádky`,
    });
    onLeave(() => { FAM.vt.destroy(); FAM.vt = null; });
  });
  const localNote = LOCAL ? `<div class="notice" style="margin:0 0 12px"><img src="../brand/maskot-3d/web/ospalek-hlava.webp" alt=""><div>V tomhle prohlížeči je uložená i skutečná rodina z aplikace: ${LOCAL.kids} ${plural(LOCAL.kids, 'dítě', 'děti', 'dětí')}, ${esc(LOCAL.town)}${LOCAL.premium ? ', předplatné (demo)' : ''}. Do seznamu se nepočítá.</div></div>` : '';
  return `
    ${head('Rodiny', 'Účty, děti a jak aplikaci používají', `${API.can('tickets.reply') ? `<button class="btn white" data-a="tNew">${I.chat}Nový ticket</button>` : ''}<button class="btn white" data-a="famCsv">${I.down}Export CSV</button>`)}
    ${demoBar()}
    ${localNote}
    <div class="chips tight" style="margin-bottom:10px">${Object.entries(API.SEGMENTS).map(([k, v]) => `<button class="chip ${FAM.seg === k ? 'on' : ''}" data-a="famSeg" data-v="${k}">${v.label} <span class="n">${fmt(API.families.count(k))}</span></button>`).join('')}</div>
    <section class="panel">
      <div class="filters">
        <input type="search" data-f="famq" placeholder="Hledat jméno, e-mail, dítě, město nebo id" value="${esc(FAM.q)}" aria-label="Hledat rodinu">
        <select data-f="famcountry" aria-label="Země">${opt('country', 'all', 'ČR i SR')}${opt('country', 'CZ', 'Česko')}${opt('country', 'SK', 'Slovensko')}</select>
        <select data-f="famplatform" aria-label="Zařízení">${opt('platform', 'all', 'Všechna zařízení')}${opt('platform', 'iOS', 'iOS')}${opt('platform', 'Android', 'Android')}${opt('platform', 'Web', 'Web')}</select>
      </div>
      <div class="vt-host" id="famList"></div>
    </section>`;
}
PAGES.rodiny = pageFamilies;

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
  if (!f) return `${head('Rodina nenalezena')}<p><a class="link" href="#rodiny">Zpět na rodiny</a></p>`;
  const t0 = performance.now();
  // bez souhlasu se statistikami nejsou poslechy rodiny v databázi přiřazené, detail ukáže jen CRM údaje
  const noStats = D.live && f.analytics === false;
  const a = noStats ? emptyActivity(f) : API.families.activity(id);
  const ms = performance.now() - t0;
  if (!a) {
    // ostrý režim: poslechy rodiny se načtou z databáze a stránka se pak vykreslí znovu
    API.families.loadActivity(id).then(() => { if (route() === 'rodiny' && routeParam() === id) render(); }, (e) => { const el = $('#famLoading'); if (el) el.textContent = 'Poslechy se nepodařilo načíst: ' + e.message; });
    return `${head(esc(famName(f)))}<p class="muted" id="famLoading">Načítám poslechy rodiny…</p>`;
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
    { at: f.created, c: 'var(--s1)', t: `Registrace (${esc(f.source)}, ${f.platform})` },
    f.trialI >= 0 && { at: D.dayAt(f.trialI), c: 'var(--honey)', t: 'Začal zkušební týden' },
    f.subI >= 0 && f.plan !== 'dárek' && { at: D.dayAt(f.subI), c: 'var(--s3)', t: 'Předplatné (129 Kč měsíčně)' },
    f.subEnd >= 0 && { at: D.dayAt(f.subEnd), c: 'var(--s2)', t: 'Zrušení předplatného' },
    ...pays.map((p) => ({ at: p.at, c: p.status === 'zaplaceno' ? 'var(--s3)' : 'var(--s2)', t: `Platba ${kc(p.czk)} · ${p.status}` })),
    ...tks.map((t) => ({ at: t.created, c: 'var(--s4)', t: `Ticket <a class="link" href="#helpdesk/${t.id}">#${t.id} ${esc(t.subject)}</a>` })),
    ...gifts.map((g) => ({ at: g.at, c: 'var(--honey)', t: `Dárek: ${g.months} ${plural(g.months, 'měsíc', 'měsíce', 'měsíců')} zdarma` })),
    { at: f.lastSeen, c: 'var(--line)', t: 'Naposledy v aplikaci' },
  ].filter(Boolean).sort((x, y) => y.at - x.at);
  const canE = API.can('families.edit'), canDel = API.can('families.delete'), canGift = API.can('billing.refund');
  return `
    <div class="head">
      <div class="fam-head">
        <a class="btn white sm" href="#rodiny">${I.back}Rodiny</a>
        <div class="avatar">${f.email ? initials(famName(f)) : 'H'}</div>
        <div><h1>${esc(famName(f))}</h1><p>${esc(famMail(f)) || 'Bez e-mailu (host)'} · <span class="mono">${f.id}</span> · ${esc(f.town)} ${f.country} · ${subTag(f)} ${f.tags.map((x) => `<span class="tag line">${esc(x)}</span>`).join(' ')}</p></div>
      </div>
      <div class="head-actions">
        ${API.can('tickets.reply') && f.email ? `<button class="btn white sm" data-a="tNew">${I.chat}Nový ticket</button>` : ''}
        ${canGift && f.email ? `<button class="btn white sm" data-a="famGift" data-v="${f.id}">${I.gift}Darovat měsíc</button>` : ''}
        ${canDel ? `<button class="btn white sm" data-a="famExport" data-v="${f.id}">${I.down}Export dat (GDPR)</button><button class="btn danger sm" data-a="famDelete" data-v="${f.id}">Smazat rodinu</button>` : ''}
      </div>
    </div>
    ${demoBar(D.live ? '' : `Aktivita se dopočítala za ${dec(ms)} ms.`)}
    ${noStats ? '<div class="locked-note">Rodina nedala souhlas se statistikami poslechu. Účet, děti a obec vidíš kvůli podpoře, poslechy jsou jen v anonymních souhrnech.</div>' : ''}
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
        <div class="kids">${f.kids.map((k, i) => `<div class="kidcard"><b>${API.can('families.pii') ? esc(k.name) : `Dítě ${i + 1}`}</b><div class="muted">${k.g === 'f' ? 'holka' : 'kluk'}, ${k.age} ${plural(k.age, 'rok', 'roky', 'let')}</div><div style="margin-top:6px;font-size:12px">Hrdinou <b>${fmt(a.hero[i])}×</b></div></div>`).join('')}</div>
        <h2 style="margin:16px 0 8px">Zařízení</h2>
        <dl class="kv"><dt>Platforma</dt><dd>${f.platform}</dd><dt>Verze aplikace</dt><dd>${f.appVer}${f.platform !== 'Web' && f.appVer !== '1.4.2' ? ' <span class="tag peach">stará</span>' : ''}</dd><dt>Registrace</dt><dd>${fdate(f.created)}</dd><dt>Zdroj</dt><dd>${esc(f.source)}</dd></dl>
        <h2 style="margin:16px 0 8px">Interní poznámka</h2>
        <textarea data-f="famNote" data-id="${f.id}" rows="4" style="font-family:var(--body);font-size:13px" ${canE ? '' : 'disabled'} placeholder="Vidí jen tým. Uloží se po opuštění pole.">${esc(API.families.note(f.id))}</textarea>
      </section>
    </div>
    <div class="grid3">
      <section class="panel"><div class="panel-head"><h2>Pohádky</h2></div>
        <div class="table-wrap"><table><thead><tr><th>Pohádka</th><th class="r">Přehrání</th><th class="r">Do konce</th></tr></thead><tbody>
        ${stRows.map(([sid, s]) => `<tr><td>${esc(title(sid))}</td><td class="r num">${fmt(s.n)}</td><td class="r num">${pct(s.done, s.n)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Zatím nic.</td></tr>'}</tbody></table></div>
      </section>
      <section class="panel"><div class="panel-head"><h2>Platby</h2>${API.can('billing.read') ? '<a class="btn white sm" href="#platby">Všechny</a>' : ''}</div>
        ${API.can('billing.read') ? `<div class="table-wrap"><table><thead><tr><th>Datum</th><th>Obchod</th><th class="r">Částka</th><th>Stav</th></tr></thead><tbody>
        ${pays.slice(0, 8).map((p) => `<tr><td class="num">${fdate(p.at)}</td><td>${p.store}</td><td class="r num">${p.cur === 'EUR' ? `${dec(p.amount, 2)} €` : kc(p.czk)}</td><td>${payTag(p.status)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Žádné platby.</td></tr>'}</tbody></table></div>` : '<p class="muted">Tvoje role platby nevidí.</p>'}
      </section>
      <section class="panel"><div class="panel-head"><h2>Časová osa</h2></div>
        <ul class="timeline">${tl.map((e) => `<li><span class="when">${fdate(e.at)}</span><i class="dot" style="--c:${e.c}"></i><span>${e.t}</span></li>`).join('')}</ul>
      </section>
    </div>`;
}
const emptyActivity = (f) => ({ plays: 0, minutes: 0, days: 0, cat: [0, 0, 0, 0], story: {}, hero: f.kids.map(() => 0), done: 0, hours: new Float64Array(24), series: { plays: new Uint16Array(D.days), minutes: new Float32Array(D.days), events: [] } });
const payTag = (s) => `<span class="tag ${s === 'zaplaceno' ? 'mint' : s === 'vráceno' ? 'line' : 'peach'}">${s}</span>`;

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
  famSeg: (v) => { FAM.seg = v; const h = 'rodiny/segment-' + v; if (location.hash === '#' + h) render(); else go(h); },
  famCsv: () => { download('ospalek-rodiny-ukazka.csv', '﻿' + famCsv(), 'text/csv'); API.log('family.export', 'seznam', `Export CSV (${FAM.seg})`); toast('CSV se stahuje'); },
  famGift: (v) => confirmBox('Darovat měsíc předplatného?', 'V ukázce se jen zapíše do časové osy a audit logu. Skutečně by náš server rodině zapnul dočasný přístup.', 'Darovat', () => { API.families.gift(v, 1); render(); toast('Dárek je zapsaný'); }),
  famExport: (v) => {
    const f = API.families.get(v), a = API.families.activity(v);
    const data = { rodina: { id: f.id, email: f.email, jmeno: f.name, bydliste: f.town, zeme: f.country, registrace: f.created, zarizeni: f.platform }, deti: f.kids, predplatne: { stav: f.status, tarif: f.plan }, platby: API.families.payments(v), tickety: API.families.tickets(v).map((t) => ({ id: t.id, predmet: t.subject, zpravy: t.msgs.filter((m) => m.from !== 'note') })), poslech: a.series.events.map((e) => ({ den: iso(D.dayAt(e.i)), hodina: e.hour, pohadka: e.story, minut: Math.round(e.min * 10) / 10 })) };
    download(`ospalek-export-${v}.json`, JSON.stringify(data, null, 2), 'application/json');
    API.log('family.export', v, 'Export údajů rodiny (GDPR)'); toast('Export se stahuje');
  },
  famDelete: (v) => confirmBox('Smazat rodinu?', `Rodina ${esc(v)} zmizí ze seznamů. ${D.live ? 'Smazání je nevratné: zmizí účet, děti i všechny poslechy v databázi.' : 'V ukázce se to dá vrátit smazáním dat prohlížeče, ve skutečném systému je smazání nevratné a týká se i nahrávek.'}`, 'Smazat', () => {
    if (!D.live) { API.families.remove(v); go('rodiny'); toast('Rodina je smazaná (ukázka)'); return; }
    API.families.removeLive(v).then(() => { go('rodiny'); toast('Rodina je smazaná i s poslechy a účtem'); }, (e) => toast('Smazání se nepovedlo: ' + e.message));
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
