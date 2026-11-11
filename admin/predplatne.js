// ---------- Předplatné: dashboard metrik z App Store a Google Play ----------
// Vlastní náhrada dashboardu RevenueCat. Data připravuje admin/store-data.js (D.store), tady se jen počítají souhrny za
// zvolené období a kreslí. Pojmy:
//  – MRR: měsíční opakované tržby aktivních placených předplatných (s DPH, jak platí rodiny); „čisté“ = bez DPH a provize obchodu 15 %.
//  – Aktivní předplatné: zaplacené období právě běží (i když rodina vypnula obnovení). Zkušební doba se nepočítá.
//  – Konverze: zkušební doby, které skončily v období, a kolik z nich přešlo do placeného.
//  – Odchod (churn): placená předplatná, která v období skončila a neobnovila se, děleno počtem aktivních na začátku období.
//  – LTV: skutečně vybrané čisté tržby na platící rodinu (realizované), odhad = čistá tržba na platícího ÷ měsíční odchod.

const SUBS = { days: 90, type: 'all', plat: 'all', vt: null };
const TYPE_LABEL = { trial: 'Začátek zkušební doby', buy: 'První platba', convert: 'Převod ze zkušební', renew: 'Obnovení', cancel: 'Vypnuté obnovení', uncancel: 'Zapnuté obnovení', issue: 'Platba selhala', expire: 'Konec předplatného', refund: 'Vrácení peněz', pause: 'Pozastaveno' };
const TYPE_TAG = { trial: 'honey', buy: 'mint', convert: 'mint', renew: 'mint', cancel: 'peach', uncancel: 'line', issue: 'peach', expire: 'line', refund: 'peach', pause: 'line' };
const SUB_STATUS = { trial: 'Zkušební doba', active: 'Platí', grace: 'Platí, karta selhala (odklad)', retry: 'Obchod zkouší platbu', paused: 'Pozastaveno', expired: 'Skončilo', refunded: 'Vráceno' };

function pageSubscriptions() {
  const S = D.store, dl = S.daily, L = D.days - 1, n = SUBS.days, a = L - n + 1, b = a - n;
  const sum = (arr, x, y) => sumR(arr, x, y);
  const now = Date.now();
  const live = S.subs.filter((s) => ['active', 'grace', 'trial', 'retry'].includes(s.status) && (!s.expires || s.status === 'retry' || s.expires > now));
  const paying = live.filter((s) => s.status === 'active' || s.status === 'grace');
  const trials = live.filter((s) => s.status === 'trial');
  const offRenew = paying.filter((s) => !s.renew).length, trialOff = trials.filter((s) => !s.renew).length;
  const issues = S.subs.filter((s) => s.status === 'grace' || s.status === 'retry');
  const mrr = dl.mrr[L], mrrNet = dl.mrrNet[L];
  const rev = sum(dl.revenue, a, L), revB = sum(dl.revenue, Math.max(0, b), a - 1), proc = sum(dl.proceeds, a, L);
  const refunds = sum(dl.refunds, a, L), refundN = sum(dl.refundN, a, L);
  const t0 = D.dayAt(a).getTime();
  const ended = S.trialsAll.filter((t) => t.ended && Math.min(now, t.end) >= t0), conv = ended.filter((t) => t.converted).length;
  const churn30 = sum(dl.churn, L - 29, L), base30 = dl.subs[Math.max(0, L - 30)];
  const churnRate = base30 ? churn30 / base30 : 0;
  const payingEver = [...S.per.values()].filter((p) => p.paid.length);
  const realized = payingEver.length ? S.events.filter((e) => S.PAY.has(e.type) || e.type === 'refund').reduce((x, e) => x + e.net, 0) / payingEver.length : 0;
  const arppu = dl.subs[L] ? mrrNet / dl.subs[L] : 0;
  const predicted = churnRate > 0 ? arppu / churnRate : 0;
  const newPaid = sum(dl.newPaid, a, L), newPaidB = sum(dl.newPaid, Math.max(0, b), a - 1);
  const newTrials = sum(dl.newTrials, a, L), newTrialsB = sum(dl.newTrials, Math.max(0, b), a - 1);
  const label = `za ${n} dní`, prev = `proti předchozím ${n} dnům`;

  const idx = dayIdx(n), weekly = n > 60;
  lineChart('chSubMrr', idx, [{ name: 'MRR s DPH', color: 'var(--s3)', get: (i) => dl.mrr[i] }, { name: 'Čisté MRR', color: 'var(--s1)', get: (i) => dl.mrrNet[i] }], false);
  lineChart('chSubAct', idx, [{ name: 'Platící', color: 'var(--s1)', get: (i) => dl.subs[i] }, { name: 'Zkušební', color: 'var(--s2)', get: (i) => dl.trials[i] }], false);
  lineChart('chSubRev', idx, [{ name: 'Tržby s DPH', color: 'var(--s3)', get: (i) => dl.revenue[i] }, { name: 'Do kapsy', color: 'var(--s1)', get: (i) => dl.proceeds[i] }, { name: 'Vráceno', color: 'var(--s4)', get: (i) => dl.refunds[i] }], weekly);
  lineChart('chSubFlow', idx, [{ name: 'Nové zkušební', color: 'var(--s2)', get: (i) => dl.newTrials[i] }, { name: 'Nově platící', color: 'var(--s1)', get: (i) => dl.newPaid[i] }, { name: 'Odešli', color: 'var(--s4)', get: (i) => dl.churn[i] }, { name: 'Vypnuli obnovení', color: 'var(--s3)', get: (i) => dl.cancels[i] }], weekly);

  // konverze zkušební doby po týdnech
  const tc = S.trialCohorts.filter((c) => c.i >= a - 6).slice(-12);
  const trialTable = tc.length ? `<div class="table-wrap"><table><thead><tr><th>Týden začátku</th><th class="r">Začalo</th><th class="r">Skončilo</th><th class="r">Platí</th><th class="r">Konverze</th></tr></thead><tbody>
    ${tc.slice().reverse().map((c) => `<tr><td class="num">${fshort(D.dayAt(Math.max(0, c.i)))}</td><td class="r num">${fmt(c.started)}</td><td class="r num">${fmt(c.ended)}</td><td class="r num">${fmt(c.converted)}</td><td class="r num">${c.ended ? pct(c.converted, c.ended) : '<span class="muted">běží</span>'}</td></tr>`).join('')}
  </tbody></table></div>` : '<p class="muted">Zatím žádná zkušební doba.</p>';

  // retence a LTV podle měsíce první platby
  const M = S.months, pc = S.payCohorts.slice(-8);
  const mName = (d) => d.toLocaleDateString('cs-CZ', { month: 'short', year: 'numeric' });
  const cell = (v, known) => (known ? `<td class="c ${v > 0.55 ? 'hi' : ''}" style="background:color-mix(in srgb, var(--s1) ${Math.round(v * 100)}%, transparent)">${Math.round(v * 100)}</td>` : '<td></td>');
  const retTable = pc.length ? `<div class="table-wrap"><table class="cohort"><thead><tr><th style="text-align:left">Měsíc 1. platby</th><th>Rodin</th>${Array.from({ length: M }, (_, k) => `<th>M${k}</th>`).join('')}</tr></thead><tbody>
    ${pc.map((c) => `<tr><td style="text-align:left">${mName(c.month)}</td><td class="num">${fmt(c.size)}</td>${Array.from({ length: M }, (_, k) => cell(c.known[k] ? c.active[k] / c.known[k] : 0, c.known[k])).join('')}</tr>`).join('')}
  </tbody></table></div>` : '<p class="muted">Zatím nikdo nezaplatil.</p>';
  const ltvTable = pc.length ? `<div class="table-wrap"><table><thead><tr><th>Měsíc 1. platby</th>${Array.from({ length: M }, (_, k) => `<th class="r">M${k}</th>`).join('')}</tr></thead><tbody>
    ${pc.map((c) => `<tr><td>${mName(c.month)}</td>${Array.from({ length: M }, (_, k) => `<td class="r num">${c.known[k] ? kc(c.ltv[k] / c.known[k]) : ''}</td>`).join('')}</tr>`).join('')}
  </tbody></table></div>` : '';

  // rozpad aktivních
  const bars = (list, f = fmt) => { const mx = Math.max(1, ...list.map((x) => x[1])); return `<div class="bars">${list.map(([s, c]) => `<div class="b"><span>${esc(s)}</span><span class="t"><i style="width:${(c / mx) * 100}%"></i></span><span class="r num">${f(c)}</span></div>`).join('')}</div>`; };
  const byPlat = [['App Store (iOS)', live.filter((s) => s.platform === 'ios').length], ['Google Play (Android)', live.filter((s) => s.platform === 'android').length]];
  const byCountry = [['Česko', live.filter((s) => s.country === 'CZ').length], ['Slovensko', live.filter((s) => s.country === 'SK').length], ['Jinde', live.filter((s) => s.country && !['CZ', 'SK'].includes(s.country)).length]].filter((x, i) => i < 2 || x[1]);
  const byStatus = Object.keys(SUB_STATUS).map((k) => [SUB_STATUS[k], S.subs.filter((s) => s.status === k).length]).filter((x) => x[1]);
  const revPlat = ['ios', 'android'].map((p) => [S.STORE[p], S.events.filter((e) => e.platform === p && (S.PAY.has(e.type) || e.type === 'refund') && e.at >= D.dayAt(a)).reduce((x, e) => x + e.czk, 0)]);

  after.push(() => {
    SUBS.vt = vtable($('#subEvents'), {
      cols: [
        { k: 'at', label: 'Kdy', w: '130px', html: (e) => `<span class="num">${fdate(e.at)} <span class="muted">${e.at.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}</span></span>` },
        { k: 'fam', label: 'Rodina', w: 'minmax(160px, 1.2fr)', html: (e) => (e.fam ? famLink(API.families.get(e.fam)) : '<span class="muted">nespárováno</span>') },
        { k: 'type', label: 'Událost', w: 'minmax(170px, 1fr)', html: (e) => `<span class="tag ${TYPE_TAG[e.type] || 'line'}">${TYPE_LABEL[e.type] || e.type}</span>${e.refunded ? ' <span class="muted">vráceno</span>' : ''}` },
        { k: 'platform', label: 'Obchod', w: '110px', html: (e) => S.STORE[e.platform] || e.platform },
        { k: 'period', label: 'Období', w: '150px', html: (e) => (e.start && e.end ? `<span class="num muted">${fshort(e.start)} – ${fshort(e.end)}</span>` : '') },
        { k: 'amount', label: 'Částka', w: '110px', cls: 'r', html: (e) => (e.amount ? `<span class="num">${e.currency === 'EUR' ? `${dec(e.amount, 2)} €` : kc(e.czk)}</span>` : '<span class="muted">–</span>') },
        { k: 'net', label: 'Do kapsy', w: '100px', cls: 'r', html: (e) => (e.net ? `<span class="num">${kc(e.net)}</span>` : '') },
      ],
      rowH: 40, key: (e) => e.id,
      fetch: (c, l) => {
        const t = performance.now(), q = S.events.filter((e) => (SUBS.type === 'all' || (SUBS.type === 'pay' ? S.PAY.has(e.type) : e.type === SUBS.type)) && (SUBS.plat === 'all' || e.platform === SUBS.plat));
        const from = c || 0, list = q.slice().reverse();
        return { items: list.slice(from, from + l), next: from + l < list.length ? from + l : null, total: list.length, ms: performance.now() - t };
      },
      empty: 'Žádné události.',
      foot: (s) => `${fmt(s.total)} ${plural(s.total, 'událost', 'události', 'událostí')}`,
    });
    onLeave(() => { SUBS.vt && SUBS.vt.destroy(); SUBS.vt = null; });
  });
  const opt = (k, v, l) => `<option value="${v}" ${SUBS[k] === v ? 'selected' : ''}>${l}</option>`;
  const err = D.live && D.storeRaw && D.storeRaw.error;
  const actions = `${D.live ? `<label class="check" style="margin:0 8px 0 0"><input type="checkbox" data-f="subSandbox" ${D.sandbox ? 'checked' : ''}> testovací nákupy</label>` : ''}${rangeSeg('subDays', n)}`;
  return `
    ${head('Předplatné', 'App Store a Google Play napřímo, bez RevenueCat. Měsíční předplatné s 3denní zkušební dobou.', actions)}
    ${D.live ? `<div class="demo live"><b>Ostrá data</b><span>${err ? `Předplatné se nenačetlo (${esc(err)}). Je v databázi funkce admin_store? Viz supabase/README.md.` : `Události posílají obchody naší funkci store, ${fmt(S.events.length)} ${plural(S.events.length, 'událost', 'události', 'událostí')} od začátku${D.sandbox ? ' včetně testovacích nákupů' : ''}.`} Částky v eurech přepočtené kurzem ČNB ke dni platby. „Do kapsy“ = bez DPH (CZ 21 %, SK 23 %) a provize obchodu 15 %. <a class="link" href="#data">Napojení dat</a></span></div>`
      : `<div class="demo"><b>Ukázková data</b><span>Vymyšlené rodiny a platby. Ve skutečnosti chodí události přímo z App Store a Google Play do naší databáze (supabase/functions/store). „Do kapsy“ = bez DPH (CZ 21 %, SK 23 %) a provize obchodu 15 %.</span></div>`}
    <div class="tiles t8">
      ${tile('MRR', kc(mrr), `${trend(mrr, dl.mrr[Math.max(0, L - 30)], 'za 30 dní')} · čisté ${kc(mrrNet)}`)}
      ${tile('ARR', kc(mrr * 12), `čisté ${kc(mrrNet * 12)} ročně`)}
      ${tile('Aktivní předplatné', fmt(paying.length), offRenew ? `${fmt(offRenew)} ${plural(offRenew, 'má', 'mají', 'má')} vypnuté obnovení` : 'všechna se obnoví')}
      ${tile('Ve zkušební době', fmt(trials.length), trialOff ? `${fmt(trialOff)} už zrušilo obnovení` : 'nikdo nezrušil obnovení')}
      ${tile('Tržby', kc(rev), `${trend(rev, revB, prev)} · do kapsy ${kc(proc)}`)}
      ${tile('Konverze zkušební doby', pct(conv, ended.length), `${fmt(conv)} z ${fmt(ended.length)} skončených ${label}`)}
      ${tile('Odchod za 30 dní', base30 ? pct(churn30, base30) : '–', `${fmt(churn30)} ${plural(churn30, 'předplatné skončilo', 'předplatná skončila', 'předplatných skončilo')}`)}
      ${tile('Nově platící', fmt(newPaid), trend(newPaid, newPaidB, prev))}
      ${tile('Nové zkušební doby', fmt(newTrials), trend(newTrials, newTrialsB, prev))}
      ${tile('Čistě na platícího', kc(arppu), `měsíčně · s DPH ${kc(dl.subs[L] ? mrr / dl.subs[L] : 0)}`)}
      ${tile('LTV realizované', kc(realized), `čistě na rodinu, která kdy platila (${fmt(payingEver.length)})`)}
      ${tile('LTV odhad', predicted ? kc(predicted) : '–', predicted ? `${kc(arppu)} ÷ odchod ${pct(churn30, base30)} měsíčně` : 'až bude odchod za 30 dní')}
      ${tile('Vráceno', kc(refunds), `${fmt(refundN)} ${plural(refundN, 'platba', 'platby', 'plateb')} · ${pct(refunds, rev)} tržeb`)}
      ${tile('Problém s platbou', fmt(issues.length), 'obchod zkouší kartu znovu (odklad až 16 dní)')}
      ${tile('Vypnuté obnovení', fmt(sum(dl.cancels, a, L)), `${label}, i během zkušební doby`)}
      ${tile('Zkušební → placené', fmt(sum(dl.conversions, a, L)), `první platby po zkušební době ${label}`)}
    </div>
    <div class="grid2">
      <section class="panel"><div class="panel-head"><h2>MRR</h2>${legendOf([['var(--s3)', 'S DPH'], ['var(--s1)', 'Čisté']])}</div><div class="chart" id="chSubMrr"></div></section>
      <section class="panel"><div class="panel-head"><h2>Aktivní předplatné a zkušební doby</h2>${legendOf([['var(--s1)', 'Platící'], ['var(--s2)', 'Zkušební']])}</div><div class="chart" id="chSubAct"></div></section>
    </div>
    <div class="grid2">
      <section class="panel"><div class="panel-head"><h2>Tržby${weekly ? ' po týdnech' : ''}</h2>${legendOf([['var(--s3)', 'S DPH'], ['var(--s1)', 'Do kapsy'], ['var(--s4)', 'Vráceno']])}</div><div class="chart" id="chSubRev"></div></section>
      <section class="panel"><div class="panel-head"><h2>Příchody a odchody${weekly ? ' po týdnech' : ''}</h2>${legendOf([['var(--s2)', 'Nové zkušební'], ['var(--s1)', 'Nově platící'], ['var(--s4)', 'Odešli'], ['var(--s3)', 'Vypnuli obnovení']])}</div><div class="chart" id="chSubFlow"></div></section>
    </div>
    <div class="grid2">
      <section class="panel"><div class="panel-head"><h2>Retence platících</h2><span class="hint">% rodin z kohorty, které měsíc M po první platbě pořád platí</span></div>${retTable}</section>
      <section class="panel"><div class="panel-head"><h2>Realizované LTV na rodinu</h2><span class="hint">čisté tržby na rodinu z kohorty do konce měsíce M</span></div>${ltvTable || '<p class="muted">Zatím nikdo nezaplatil.</p>'}</section>
    </div>
    <div class="grid2">
      <section class="panel"><div class="panel-head"><h2>Konverze zkušební doby</h2><span class="hint">podle týdne, kdy zkušební doba začala</span></div>${trialTable}</section>
      <section class="panel"><div class="panel-head"><h2>Problém s platbou</h2></div>
        ${issues.length ? `<div class="table-wrap"><table><tbody>${issues.slice(0, 10).map((s) => `<tr><td>${s.fam ? famLink(API.families.get(s.fam)) : '<span class="muted">nespárováno</span>'}</td><td>${S.STORE[s.platform]}</td><td class="muted">${s.status === 'grace' ? 'odklad, pořád poslouchá' : 'přístup pozastavený'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Žádný.</p>'}
        <p class="hint" style="margin-top:8px">Kartu zkouší obchod sám a rodině posílá e-mail. Vrácení peněz vyřizuje Apple (rodina žádá na reportaproblem.apple.com) nebo Google Play Console → Objednávky.</p></section>
    </div>
    <div class="grid3">
      <section class="panel"><div class="panel-head"><h2>Aktivní podle obchodu</h2></div>${bars(byPlat)}<h2 style="margin:16px 0 10px">Tržby podle obchodu (${n} dní)</h2>${bars(revPlat, kc)}</section>
      <section class="panel"><div class="panel-head"><h2>Aktivní podle země</h2></div>${bars(byCountry)}</section>
      <section class="panel"><div class="panel-head"><h2>Všechna předplatná podle stavu</h2></div>${bars(byStatus)}</section>
    </div>
    <section class="panel" style="margin-top:12px">
      <div class="panel-head"><h2>Události z obchodů</h2></div>
      <div class="filters">
        <select data-f="subType" aria-label="Událost">${opt('type', 'all', 'Všechny události')}${opt('type', 'pay', 'Jen platby')}${Object.entries(TYPE_LABEL).map(([k, l]) => opt('type', k, l)).join('')}</select>
        <select data-f="subPlat" aria-label="Obchod">${opt('plat', 'all', 'Oba obchody')}${opt('plat', 'ios', 'App Store')}${opt('plat', 'android', 'Google Play')}</select>
      </div>
      <div class="vt-host" id="subEvents" style="height:420px;min-height:0"></div>
    </section>`;
}
PAGES.platby = pageSubscriptions;

Object.assign(ACTIONS, { subDays: (v) => { SUBS.days = Number(v); render(); } });
document.addEventListener('change', (ev) => {
  const t = ev.target, f = t.dataset.f;
  if (f === 'subType' || f === 'subPlat') { SUBS[f === 'subType' ? 'type' : 'plat'] = t.value; SUBS.vt && SUBS.vt.reset(); }
  // testovací nákupy (sandbox, licenční testeři): načte se znovu ze Supabase
  if (f === 'subSandbox') { try { localStorage.setItem('ospalek.admin.sandbox', JSON.stringify(t.checked)); } catch (e) {} location.reload(); }
});
