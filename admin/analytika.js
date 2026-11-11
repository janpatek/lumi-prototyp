// ---------- Používání, Předplatné a platby, Hlas a náklady ----------
// Všechno se čte z denních agregátů a souhrnů; žádná stránka neprochází jednotlivé poslechy.

const AN = { days: 90 };
const rangeSeg = (k, cur) => `<div class="seg">${[[30, '30 dní'], [90, '90 dní'], [D.days, '6 měsíců']].map(([d, l]) => `<button data-a="${k}" data-v="${d}" class="${cur === d ? 'on' : ''}">${l}</button>`).join('')}</div>`;
const dayIdx = (n) => Array.from({ length: n }, (_, k) => D.days - n + k);
const byWeek = (idx, arr) => {
  const out = [];
  idx.forEach((i) => { const w = D.weekOf(i), last = out[out.length - 1]; if (last && last.w === w) last.v += arr(i); else out.push({ w, i, v: arr(i) }); });
  return out;
};
const lineChart = (id, idx, series, weekly) => after.push(() => {
  const el = document.getElementById(id); if (!el) return;
  if (weekly) {
    const ws = byWeek(idx, () => 0);
    chart(el, { type: 'line', labels: ws.map((w) => fshort(D.dayAt(w.i))), titles: ws.map((w) => `Týden od ${fshort(D.dayAt(w.i))}`), series: series.map((s) => ({ ...s, values: byWeek(idx, s.get).map((w) => Math.round(w.v)) })) });
  } else chart(el, { type: 'line', labels: idx.map((i) => fshort(D.dayAt(i))), titles: idx.map((i) => fday(D.dayAt(i))), series: series.map((s) => ({ ...s, values: idx.map((i) => Math.round(s.get(i))) })) });
});
const legendOf = (list) => `<div class="legend">${list.map(([c, l]) => `<span><i class="key" style="--c:${c}"></i>${l}</span>`).join('')}</div>`;

// ---------- Používání ----------
function pageUsage() {
  const n = AN.days, idx = dayIdx(n), dl = D.daily, L = D.days - 1;
  const plays = sumR(dl.plays, L - n + 1, L), mins = sumR(dl.minutes, L - n + 1, L), done = sumR(dl.done, L - n + 1, L);
  const dauAvg = sumR(dl.dau, L - n + 1, L) / n;
  const mau = D.families.reduce((s, f) => s + (f.days30 > 0 ? 1 : 0), 0);
  const wauLast = D.wau[D.WEEKS - 2];
  lineChart('chDau', idx, [{ name: 'Přehrání', color: 'var(--s1)', get: (i) => dl.plays[i] }, { name: 'Aktivní rodiny', color: 'var(--s2)', get: (i) => dl.dau[i] }], n > 60);
  lineChart('chCat', idx, D.catIds.map((c, k) => ({ name: catLabel(c), color: `var(--s${k + 1})`, get: (i) => dl.cat[c][i] })), true);
  // kohorty po týdnech registrace
  const C = D.cohorts, W = D.WEEKS, show = Math.min(12, W - 1);
  const rows = [];
  for (let w = W - show - 1; w < W; w++) if (C[w] && C[w].size) rows.push(w);
  const cohort = `<div class="table-wrap"><table class="cohort"><thead><tr><th style="text-align:left">Týden registrace</th><th>Rodin</th>${Array.from({ length: show }, (_, k) => `<th>T${k}</th>`).join('')}</tr></thead><tbody>
    ${rows.map((w) => { const c = C[w]; const start = D.dayAt(Math.max(0, w * 7 - ((D.dayAt(0).getDay() + 6) % 7))); return `<tr><td style="text-align:left" class="num">${fshort(start)}</td><td class="num">${fmt(c.size)}</td>${Array.from({ length: show }, (_, k) => { if (w + k >= W) return '<td></td>'; const r = c.active[k] / c.size; return `<td class="c ${r > 0.55 ? 'hi' : ''}" style="background:color-mix(in srgb, var(--s1) ${Math.round(r * 100)}%, transparent)" title="${pct(c.active[k], c.size)} rodin aktivních v týdnu ${k}">${Math.round(r * 100)}</td>`; }).join('')}</tr>`; }).join('')}
  </tbody></table></div>`;
  // den v týdnu × hodina
  const hmax = Math.max(...D.heat);
  const heat = `<div class="heat" style="grid-template-columns:22px repeat(24, minmax(0, 1fr))">${['po', 'út', 'st', 'čt', 'pá', 'so', 'ne'].map((d, r) => `<span>${d}</span>${Array.from({ length: 24 }, (_, h) => { const v = D.heat[r * 24 + h]; return `<i class="c" style="opacity:${v ? 0.08 + 0.92 * (v / hmax) : 0.04}" title="${d} ${h}:00 – ${fmt(v)} přehrání"></i>`; }).join('')}`).join('')}<span></span>${Array.from({ length: 24 }, (_, h) => `<span style="text-align:center">${h % 3 === 0 ? h : ''}</span>`).join('')}</div>`;
  // distribuce aktivity
  const buckets = [['0 dní', (f) => f.days30 === 0], ['1–3', (f) => f.days30 >= 1 && f.days30 <= 3], ['4–9', (f) => f.days30 >= 4 && f.days30 <= 9], ['10–19', (f) => f.days30 >= 10 && f.days30 <= 19], ['20+', (f) => f.days30 >= 20]].map(([l, t]) => [l, D.families.filter(t).length]);
  const bmax = Math.max(...buckets.map((b) => b[1]));
  const plat = ['iOS', 'Android', 'Web'].map((p) => [p, D.families.filter((f) => f.platform === p).length]);
  const ver = {}; D.families.forEach((f) => { if (f.appVer !== 'web') ver[f.appVer] = (ver[f.appVer] || 0) + 1; });
  const ages = {}; D.families.forEach((f) => f.kids.forEach((k) => { ages[k.age] = (ages[k.age] || 0) + 1; }));
  const bars = (list) => { const mx = Math.max(1, ...list.map((x) => x[1])); return `<div class="bars">${list.map(([s, c]) => `<div class="b"><span>${esc(s)}</span><span class="t"><i style="width:${(c / mx) * 100}%"></i></span><span class="r num">${fmt(c)}</span></div>`).join('')}</div>`; };
  return `
    ${head('Používání', 'Jak rodiny poslouchají', rangeSeg('anDays', n))}
    ${demoBar('Ve skutečnosti se počítá v noci z tabulky poslechů do daily_stats.')}
    <div class="tiles t8">
      ${tile('Denně aktivní (průměr)', fmt(dauAvg), `za ${n} dní`)}
      ${tile('Týdně aktivní', fmt(wauLast), 'minulý celý týden')}
      ${tile('Měsíčně aktivní', fmt(mau), `DAU/MAU ${pct(sumR(dl.dau, L - 6, L) / 7, mau)}`)}
      ${tile('Přehrání', fmt(plays), `${dec(plays / Math.max(1, sumR(dl.dau, L - n + 1, L)))} na aktivní rodinu a den`)}
      ${tile('Hodin poslechu', fmt(mins / 60), `${dec(mins / Math.max(1, plays))} min na přehrání`)}
      ${tile('Dohráno do konce', pct(done, plays), 'u ukolébavek je to dobré znamení')}
      ${tile('Retence po 1 týdnu', pct(rows.slice(0, -1).reduce((s, w) => s + C[w].active[1], 0), rows.slice(0, -1).reduce((s, w) => s + C[w].size, 0)), 'průměr kohort v tabulce')}
      ${tile('Dětí na rodinu', dec(D.families.reduce((s, f) => s + f.kids.length, 0) / D.families.length), `${fmt(D.families.reduce((s, f) => s + f.kids.length, 0))} dětských profilů`)}
    </div>
    <div class="grid2">
      <section class="panel"><div class="panel-head"><h2>Přehrání a aktivní rodiny</h2>${legendOf([['var(--s1)', 'Přehrání'], ['var(--s2)', 'Aktivní rodiny']])}</div><div class="chart" id="chDau"></div></section>
      <section class="panel"><div class="panel-head"><h2>Přehrání podle kategorií (po týdnech)</h2>${legendOf(D.catIds.map((c, k) => [`var(--s${k + 1})`, catLabel(c)]))}</div><div class="chart" id="chCat"></div></section>
    </div>
    <section class="panel" style="margin-top:12px"><div class="panel-head"><h2>Retence po týdnech</h2><span class="hint">% rodin z kohorty, které v týdnu T po registraci aspoň jednou poslouchaly</span></div>${cohort}</section>
    <div class="grid21">
      <section class="panel"><div class="panel-head"><h2>Kdy se poslouchá</h2><span class="hint">den v týdnu × hodina, celé období</span></div>${heat}</section>
      <section class="panel"><div class="panel-head"><h2>Aktivní dny za 30 dní</h2></div>
        <div class="bars">${buckets.map(([l, c]) => `<div class="b"><span>${l}</span><span class="t"><i style="width:${(c / bmax) * 100}%"></i></span><span class="r num">${fmt(c)}</span></div>`).join('')}</div>
        <h2 style="margin:16px 0 10px">Věk dětí</h2>${bars(Object.entries(ages).sort((a, b) => a[0] - b[0]).map(([a, c]) => [`${a} ${plural(Number(a), 'rok', 'roky', 'let')}`, c]))}
      </section>
    </div>
    <div class="grid2">
      <section class="panel"><div class="panel-head"><h2>Výkon pohádek</h2><a class="btn white sm" href="#pohadky">Pohádky</a></div>${storyTable()}</section>
      <section class="panel"><div class="panel-head"><h2>Zařízení a verze</h2></div>${bars(plat)}<h2 style="margin:16px 0 10px">Verze mobilní aplikace</h2>${bars(Object.entries(ver).sort((a, b) => b[0].localeCompare(a[0])))}</section>
    </div>`;
}
function storyTable() {
  return `<div class="table-wrap"><table><thead><tr><th>Pohádka</th><th class="r">Přehrání</th><th class="r">Rodin</th><th class="r">Do konce</th><th class="r">Ø min</th><th></th></tr></thead><tbody>
    ${Object.entries(D.storyAgg).sort((a, b) => b[1].plays - a[1].plays).map(([id, s]) => { const st = STORIES.find((x) => x.id === id); return `<tr><td>${esc(st ? safeTitle(st) : id)}</td><td class="r num">${fmt(s.plays)}</td><td class="r num">${fmt(s.families)}</td><td class="r num">${pct(s.done, s.plays)}</td><td class="r num">${dec(s.minutes / Math.max(1, s.plays))}</td><td>${st && st.free ? '<span class="tag honey">Zdarma</span>' : '<span class="tag line">Placená</span>'}</td></tr>`; }).join('')}
  </tbody></table></div>`;
}
PAGES.pouzivani = pageUsage;

// ---------- Předplatné a platby ----------
const PAY = { q: '', status: 'all', store: 'all', vt: null };
function pagePayments() {
  const dl = D.daily, L = D.days - 1, N = D.days, fams = D.families;
  const mrr = dl.mrr[L], subs = dl.subs[L];
  const p30 = D.payments.filter((p) => p.at >= addDays(TODAY, -29));
  const gross = p30.filter((p) => p.status === 'zaplaceno').reduce((s, p) => s + p.czk, 0);
  const fees = p30.filter((p) => p.status === 'zaplaceno').reduce((s, p) => s + p.fee, 0);
  const refunded = p30.filter((p) => p.status === 'vráceno').reduce((s, p) => s + p.czk, 0);
  const churned = fams.filter((f) => f.subEnd >= N - 30).length;
  const pastDue = fams.filter((f) => f.status === 'past_due');
  const trials = fams.filter((f) => f.status === 'trial').length;
  const startedTrials = fams.filter((f) => f.trialI >= 0);
  const finished = startedTrials.filter((f) => f.trialI + 7 <= L);
  const conv = finished.filter((f) => f.subI >= 0).length;
  const paying = fams.filter((f) => f.status === 'active' || f.status === 'past_due');
  const mix = [['Česko', paying.filter((f) => f.plan === 'měsíc' && f.country === 'CZ').length], ['Slovensko', paying.filter((f) => f.plan === 'měsíc' && f.country === 'SK').length], ['Dárek', paying.filter((f) => f.plan === 'dárek').length]];
  const stores = ['App Store', 'Google Play', 'Stripe'].map((s) => [s, p30.filter((p) => p.store === s && p.status === 'zaplaceno').reduce((a, p) => a + p.czk, 0)]);
  const idx = dayIdx(N);
  lineChart('chMrr2', idx, [{ name: 'MRR (Kč)', color: 'var(--s3)', get: (i) => dl.mrr[i] }], false);
  lineChart('chSubs', idx, [{ name: 'Platící', color: 'var(--s1)', get: (i) => dl.subs[i] }, { name: 'Zkušební', color: 'var(--s2)', get: (i) => dl.trials[i] }], false);
  const canR = API.can('billing.refund');
  after.push(() => {
    PAY.vt = vtable($('#payList'), {
      cols: [
        { k: 'at', label: 'Datum', w: '130px', html: (p) => `<span class="num">${fdate(p.at)} <span class="muted">${p.at.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}</span></span>` },
        { k: 'fam', label: 'Rodina', w: 'minmax(180px, 1.4fr)', html: (p) => famLink(API.families.get(p.fam)) },
        { k: 'store', label: 'Obchod', w: '110px', html: (p) => p.store },
        { k: 'cur', label: 'Země', w: '90px', html: (p) => (p.cur === 'EUR' ? 'Slovensko' : 'Česko') },
        { k: 'amount', label: 'Částka', w: '100px', cls: 'r', html: (p) => (p.cur === 'EUR' ? `${dec(p.amount, 2)} €` : kc(p.czk)) },
        { k: 'fee', label: 'Poplatek', w: '90px', cls: 'r', html: (p) => `<span class="muted">${p.fee ? kc(p.fee) : '–'}</span>` },
        { k: 'status', label: 'Stav', w: '110px', html: (p) => payTag(p.status) },
        { k: 'act', label: '', w: '110px', cls: 'r', html: (p) => (canR && p.status === 'zaplaceno' ? `<button class="btn white sm" data-a="payRefund" data-v="${p.id}">Vrátit</button>` : '') },
      ],
      rowH: 40, key: (p) => p.id,
      fetch: (c, l) => API.payments.list({ q: PAY.q, status: PAY.status, store: PAY.store }, c, l),
      foot: (s) => `${fmt(s.total)} ${plural(s.total, 'platba', 'platby', 'plateb')} · dotaz ${dec(s.ms)} ms`,
    });
    onLeave(() => { PAY.vt.destroy(); PAY.vt = null; });
  });
  const opt = (k, v, l) => `<option value="${v}" ${PAY[k] === v ? 'selected' : ''}>${l}</option>`;
  const bars = (list, f = fmt) => { const mx = Math.max(1, ...list.map((x) => x[1])); return `<div class="bars">${list.map(([s, c]) => `<div class="b"><span>${esc(s)}</span><span class="t"><i style="width:${(c / mx) * 100}%"></i></span><span class="r num">${f(c)}</span></div>`).join('')}</div>`; };
  return `
    ${head('Předplatné a platby', 'Měsíční předplatné 129 Kč za jeden účet přes App Store, Google Play a Stripe')}
    <div class="demo"><b>Ukázková data</b><span>Nic se neúčtuje ani nevrací. Skutečná data dodají webhooky z RevenueCat (obchody) a Stripe (web). Poplatky obchodů jsou odhad (15 %, Stripe 1,5 % + 6,50 Kč), kurz 1 € = ${D.eur} Kč. Cena pro Slovensko (4,99 €) je zatím předpoklad.</span></div>
    <div class="tiles t8">
      ${tile('MRR', kc(mrr), `${trend(mrr, dl.mrr[N - 31], 'za 30 dní')}`)}
      ${tile('ARR', kc(mrr * 12), 'MRR × 12')}
      ${tile('Platící rodiny', fmt(subs), `ARPPU ${kc(mrr / Math.max(1, subs))} měsíčně`)}
      ${tile('Zkušební týden', fmt(trials), `konverze ${pct(conv, finished.length)} za celé období`)}
      ${tile('Příjem za 30 dní', kc(gross), `po poplatcích ${kc(gross - fees)}`)}
      ${tile('Vráceno za 30 dní', kc(refunded), `${p30.filter((p) => p.status === 'vráceno').length} plateb`)}
      ${tile('Odchod za 30 dní', fmt(churned), `${pct(churned, dl.subs[N - 31])} platících`)}
      ${tile('Neuhrazené platby', fmt(pastDue.length), 'obchod zkouší platbu znovu')}
    </div>
    <div class="grid2">
      <section class="panel"><div class="panel-head"><h2>MRR</h2></div><div class="chart" id="chMrr2"></div></section>
      <section class="panel"><div class="panel-head"><h2>Platící a zkušební</h2>${legendOf([['var(--s1)', 'Platící'], ['var(--s2)', 'Zkušební']])}</div><div class="chart" id="chSubs"></div></section>
    </div>
    <div class="grid3">
      <section class="panel"><div class="panel-head"><h2>Platící podle země</h2></div>${bars(mix)}<h2 style="margin:16px 0 10px">Příjem podle obchodu (30 dní)</h2>${bars(stores, kc)}</section>
      <section class="panel"><div class="panel-head"><h2>Neuhrazené platby</h2></div>
        ${pastDue.length ? `<div class="table-wrap"><table><tbody>${pastDue.slice(0, 8).map((f) => `<tr><td>${famLink(f)}</td><td>${f.platform}</td><td class="r">${canR ? `<button class="btn white sm" data-a="payRemind" data-v="${f.id}">Připomenout</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Žádné.</p>'}
        <p class="hint" style="margin-top:8px">Obchody zkouší platbu znovu až 16 dní (grace period). Připomínka je e-mail rodině.</p></section>
      <section class="panel"><div class="panel-head"><h2>Kupony a partneři</h2><a class="btn white sm" href="#kupony">Spravovat</a></div>
        <div class="table-wrap"><table><thead><tr><th>Kampaň</th><th class="r">Uplatněno</th><th class="r">Platí</th></tr></thead><tbody>
        ${CPN.campaigns.filter((c) => CPN.status(c) === 'active').slice(0, 6).map((c) => { const s = CPN.stats(c); return `<tr><td><a class="link" href="#kupony/${c.id}">${esc(c.name)}</a></td><td class="r num">${fmt(s.uses)}</td><td class="r num">${fmt(s.paying)}</td></tr>`; }).join('')}
        <tr><td colspan="3" class="muted" style="padding-top:12px">Dárkové poukazy: ${D.vouchers.length} prodaných, ${D.vouchers.filter((v) => v.redeemed).length} uplatněných</td></tr>
        </tbody></table></div></section>
    </div>
    <section class="panel" style="margin-top:12px">
      <div class="panel-head"><h2>Transakce</h2></div>
      <div class="filters">
        <input type="search" data-f="payq" placeholder="Hledat rodinu nebo id platby" value="${esc(PAY.q)}" aria-label="Hledat platbu">
        <select data-f="paystatus" aria-label="Stav">${opt('status', 'all', 'Všechny stavy')}${opt('status', 'zaplaceno', 'Zaplaceno')}${opt('status', 'selhala', 'Selhala')}${opt('status', 'vráceno', 'Vráceno')}</select>
        <select data-f="paystore" aria-label="Obchod">${opt('store', 'all', 'Všechny obchody')}${opt('store', 'App Store', 'App Store')}${opt('store', 'Google Play', 'Google Play')}${opt('store', 'Stripe', 'Stripe')}</select>
      </div>
      <div class="vt-host" id="payList" style="height:420px;min-height:0"></div>
    </section>`;
}
PAGES.platby = pagePayments;

// ---------- Hlas a náklady ----------
// Generování hlasu je hlavní proměnný náklad. Cena za 1000 znaků je předpoklad, dá se upravit.
const TTS_KEY = 'ospalek.admin.ttsPrice';
function pageVoice() {
  const price = Number(store.get(TTS_KEY)) || 4;
  const dl = D.daily, L = D.days - 1, N = D.days;
  const ch30 = sumR(dl.genChars, N - 30, L), hits30 = sumR(dl.cacheHits, N - 30, L), plays30 = sumR(dl.plays, N - 30, L);
  const ch30b = sumR(dl.genChars, N - 60, N - 31);
  const cost30 = (ch30 / 1000) * price;
  const subs = dl.subs[L], mrr = dl.mrr[L];
  const jobs = D.ttsJobs, ok = jobs.filter((j) => j.ms);
  const avg = ok.reduce((s, j) => s + j.ms, 0) / Math.max(1, ok.length);
  const idx = dayIdx(90);
  after.push(() => chart($('#chChars'), { type: 'bar', labels: idx.map((i) => fshort(D.dayAt(i))), titles: idx.map((i) => fday(D.dayAt(i))), series: [{ name: 'Tisíc znaků', color: 'var(--s1)', values: idx.map((i) => Math.round(dl.genChars[i] / 1000)) }] }));
  lineChart('chCache', idx, [{ name: 'Z mezipaměti %', color: 'var(--s3)', get: (i) => (dl.plays[i] ? (dl.cacheHits[i] / dl.plays[i]) * 100 : 0) }], true);
  const services = [
    ['ElevenLabs API (hlas Jana, eleven_v4)', 'ok', 'odezva 1,8 s'],
    ['Cloudflare Worker tts-worker', 'ok', '0 chyb za hodinu'],
    ['Úložiště nahrávek', 'ok', 'cache hit 97 %'],
    ['RevenueCat webhooky', 'warn', 'poslední událost před 2 h'],
    ['Databáze (Supabase)', 'warn', 'zatím nenapojeno'],
  ];
  return `
    ${head('Hlas a náklady', 'Generování nahrávek přes ElevenLabs, mezipaměť a marže')}
    ${demoBar('Počty znaků vycházejí z délky pohádek a z toho, kdy rodina pohádku slyší poprvé.')}
    <section class="panel" style="margin-bottom:12px"><div class="filters" style="margin:0">
      <label for="ttsPrice" style="margin:0">Cena za 1 000 znaků</label><input id="ttsPrice" data-f="ttsPrice" type="number" min="0" step="0.1" value="${price}" style="width:100px"> <span class="muted">Kč · předpoklad, ověř aktuální ceník a tarif ElevenLabs</span>
    </div></section>
    <div class="tiles t8">
      ${tile('Vygenerováno za 30 dní', `${fmt(ch30 / 1000)} tis. znaků`, trend(ch30, ch30b))}
      ${tile('Odhad nákladů za 30 dní', kc(cost30), `${dec(cost30 / Math.max(1, plays30), 2)} Kč na přehrání`)}
      ${tile('Přehráno z mezipaměti', pct(hits30, plays30), 'nic negenerovalo, 0 Kč')}
      ${tile('Náklad na platící rodinu', kc(cost30 / Math.max(1, subs)), `vč. rodin zdarma · ARPPU ${kc(mrr / Math.max(1, subs))}`)}
      ${tile('Marže po hlasu', pct(mrr - cost30, mrr), 'MRR minus náklady na hlas (bez obchodů)')}
      ${tile('Průměrná doba generování', dec(avg / 1000) + ' s', `${ok.length} posledních úloh`)}
      ${tile('Selhané úlohy', fmt(jobs.filter((j) => j.status === 'selhalo').length), 'z posledních 40')}
      ${tile('Znaků na pohádku', fmt(D.charsPerMin * 9.5), `≈ ${D.charsPerMin} znaků na minutu`)}
    </div>
    <div class="grid21">
      <section class="panel"><div class="panel-head"><h2>Vygenerované znaky po dnech (tisíce)</h2></div><div class="chart" id="chChars"></div></section>
      <section class="panel"><div class="panel-head"><h2>Stav služeb</h2><span class="tag honey">ukázka</span></div>
        <div class="table-wrap"><table><tbody>${services.map(([n, s, d]) => `<tr><td>${n}</td><td class="status-${s}">${s === 'ok' ? 'v pořádku' : 'pozor'}</td><td class="muted">${d}</td></tr>`).join('')}</tbody></table></div>
        <h2 style="margin:16px 0 8px">Podíl přehrání z mezipaměti</h2><div class="chart" id="chCache"></div></section>
    </div>
    <section class="panel" style="margin-top:12px"><div class="panel-head"><h2>Poslední úlohy generování</h2></div>
      <div class="table-wrap" style="max-height:380px;overflow-y:auto"><table><thead><tr><th>Kdy</th><th>Rodina</th><th>Pohádka</th><th class="r">Znaků</th><th class="r">Trvání</th><th>Stav</th><th></th></tr></thead><tbody>
      ${jobs.map((j) => { const st = STORIES.find((x) => x.id === j.story); return `<tr><td class="num">${ago(j.at)}</td><td>${famLink(API.families.get(j.fam))}</td><td>${esc(st ? safeTitle(st) : j.story)}</td><td class="r num">${fmt(j.chars)}</td><td class="r num">${j.ms ? dec(j.ms / 1000) + ' s' : '–'}</td><td>${j.status === 'hotovo' ? '<span class="tag mint">hotovo</span>' : j.status === 'běží' ? '<span class="tag sky">běží</span>' : `<span class="tag peach" title="${esc(j.err)}">selhalo</span> <span class="muted">${esc(j.err)}</span>`}</td><td class="r">${j.status === 'selhalo' && API.can('content.edit') ? `<button class="btn white sm" data-a="ttsRetry" data-v="${j.id}">Zkusit znovu</button>` : ''}</td></tr>`; }).join('')}
      </tbody></table></div></section>`;
}
// ---------- Hlas a náklady nad ostrými daty: kredity ElevenLabs ----------
// Spotřebu po dnech, tarif a kurz ČNB dodá tts-worker (GET /naklady). Kredity jsou přesné, Kč jsou odhad:
// cena kreditu = cena tarifu ÷ kredity v tarifu, přepočtená kurzem ČNB. Bez tarifu platí ručně zadaná cena.
const COST = { state: 'idle', data: null, err: '' };
function loadCosts(force) {
  if (COST.state === 'loading' || (COST.state === 'ok' && !force)) return;
  COST.state = 'loading';
  D.ttsCosts().then((d) => { COST.state = 'ok'; COST.data = d; COST.err = ''; }, (e) => { COST.state = 'err'; COST.err = e.message; })
    .then(() => { if (route() === 'hlas' || route() === 'prehled') render(); });
}
// cena jednoho kreditu v Kč: tarif ÷ kredity v tarifu × kurz ČNB, jinak ručně zadaná cena za 1 000 kreditů
function creditPrice(d) {
  const p = d.plan, rate = d.rates || {}, cur = p && p.currency === 'EUR' ? 'EUR' : 'USD';
  const monthly = p && p.next_invoice && p.next_invoice.amount ? p.next_invoice.amount / (/annual|year/i.test(p.billing_period || '') ? 12 : 1) : 0;
  const auto = monthly && p.credits_limit ? (monthly * (rate[cur] || 0)) / p.credits_limit : 0;
  return { auto, perCredit: auto || (Number(store.get(TTS_KEY)) || 4) / 1000, monthly, cur, rate };
}
// náklady v Kč po dnech (iso → Kč) pro Přehled; v ostrém režimu až po načtení z workeru, jinak null
function costsByDay() {
  if (!D.live) {
    const price = (Number(store.get(TTS_KEY)) || 4) / 1000;
    return new Map(Array.from({ length: D.days }, (_, i) => [iso(D.dayAt(i)), D.daily.genChars[i] * price]));
  }
  loadCosts();
  if (COST.state !== 'ok') return null;
  const { perCredit } = creditPrice(COST.data);
  return new Map((COST.data.days || []).map((x) => [x.day, x.credits * perCredit]));
}
const tierName = (t) => ({ free: 'Free', starter: 'Starter', creator: 'Creator', pro: 'Pro', scale: 'Scale', business: 'Business' }[String(t || '').split('_')[0]] || t || '–');
function pageVoiceLive() {
  loadCosts();
  const manual = Number(store.get(TTS_KEY)) || 4; // Kč za 1 000 kreditů, když tarif nejde přečíst
  const priceRow = (auto) => `<section class="panel" style="margin-bottom:12px"><div class="filters" style="margin:0;align-items:center">
      ${auto ? `<span>Cena kreditu podle tarifu: <b>${dec(auto * 1000, 2)} Kč</b> za 1 000 kreditů</span>` : `<label for="ttsPrice" style="margin:0">Cena za 1 000 kreditů</label><input id="ttsPrice" data-f="ttsPrice" type="number" min="0" step="0.1" value="${manual}" style="width:100px"> <span class="muted">Kč · tarif se nepodařilo přečíst, zadej cenu ručně</span>`}
      <button class="btn white sm" data-a="costReload" style="margin-left:auto">Načíst znovu</button></div></section>`;
  const top = `${head('Hlas a náklady', 'Kolik nás stojí hlas Jany v ElevenLabs: celkem od začátku a po dnech')}${demoBar()}`;
  if (COST.state === 'loading' || COST.state === 'idle') return `${top}<section class="panel"><p class="muted">Načítám spotřebu kreditů z ElevenLabs…</p></section>`;
  if (COST.state === 'err') return `${top}<section class="panel"><h2>Náklady se nepodařilo načíst</h2><p class="err">${esc(COST.err)}</p><button class="btn sm" data-a="costReload">Zkusit znovu</button></section>`;

  const d = COST.data, p = d.plan;
  const { auto, perCredit, monthly, cur, rate } = creditPrice(d);
  const days = d.days || [], today = iso(TODAY), month = today.slice(0, 7);
  const sumC = (f) => days.filter(f).reduce((a, x) => a + x.credits, 0);
  const total = sumC(() => true), todayC = sumC((x) => x.day === today), monthC = sumC((x) => x.day.startsWith(month));
  const since30 = iso(addDays(TODAY, -29)), last30 = sumC((x) => x.day >= since30);
  const prev30 = sumC((x) => x.day >= iso(addDays(TODAY, -59)) && x.day < since30);
  const first = days.find((x) => x.credits), activeDays = days.filter((x) => x.credits).length;
  const fams = D.families.length;
  const czk = (c) => kc(c * perCredit);
  const czk2 = (c) => `${dec(c * perCredit, 2)} Kč`;
  // graf: posledních 90 dní (nebo od prvního dne), sloupce = kredity, čára = Kč celkem
  const byDay = new Map(days.map((x) => [x.day, x.credits]));
  const n = Math.min(90, Math.max(7, first ? Math.round((TODAY - parseIso(first.day)) / 864e5) + 1 : 30));
  const span = Array.from({ length: n }, (_, k) => addDays(TODAY, k - n + 1));
  let run = days.filter((x) => x.day < iso(span[0])).reduce((a, x) => a + x.credits, 0);
  const cum = span.map((dt) => (run += byDay.get(iso(dt)) || 0) * perCredit);
  after.push(() => {
    chart($('#chCredits'), { type: 'bar', labels: span.map(fshort), titles: span.map(fday), series: [{ name: 'Kredity', color: 'var(--s1)', values: span.map((dt) => byDay.get(iso(dt)) || 0) }] });
    chart($('#chCum'), { type: 'line', labels: span.map(fshort), titles: span.map(fday), series: [{ name: 'Kč celkem', color: 'var(--s4)', values: cum.map(Math.round) }] });
  });
  const left = p && p.credits_limit ? Math.max(0, p.credits_limit - p.credits_used) : null;
  const rows = days.filter((x) => x.credits).slice(-60).reverse();
  return `${top}
    ${d.errors && d.errors.length ? `<div class="notice"><img src="../brand/maskot-3d/web/ospalek-hlava.webp" alt=""><div><b>Něco z ElevenLabs chybí:</b> ${d.errors.map(esc).join(' · ')}<br>Klíči ve workeru přidej v ElevenLabs (Developers → API Keys) oprávnění <b>User: Read</b> a <b>Usage / Workspace analytics: Read</b>. Na hlas to nemá vliv.</div></div>` : ''}
    ${priceRow(auto)}
    <div class="tiles t8">
      ${tile('Celkem od začátku', czk(total), `${fmt(total)} kreditů${first ? ` · od ${fdate(parseIso(first.day))}` : ''}`)}
      ${tile('Tento měsíc', czk(monthC), `${fmt(monthC)} kreditů`)}
      ${tile('Dnes', czk2(todayC), `${fmt(todayC)} kreditů`)}
      ${tile('Průměr na den (30 dní)', czk2(last30 / 30), `${fmt(last30 / 30)} kreditů · ${trend(last30, prev30)}`)}
      ${tile('Odhad na měsíc', czk(last30), 'podle posledních 30 dní')}
      ${tile('Tarif ElevenLabs', p ? esc(tierName(p.tier)) : '–', p ? `${monthly ? `${dec(monthly, 2)} ${cur} měsíčně · ` : ''}${p.status === 'active' ? 'aktivní' : esc(p.status || '')}` : 'nepodařilo se načíst')}
      ${tile('Zbývá v tarifu', left == null ? '–' : `${fmt(left)} kreditů`, p && p.credits_limit ? `${pct(left, p.credits_limit)} z ${fmt(p.credits_limit)}${p.reset_at ? ` · obnova ${fdate(new Date(p.reset_at))}` : ''}` : '')}
      ${tile('Na rodinu', fams ? czk2(total / fams) : '–', `${fmt(fams)} rodin · ${fmt(activeDays)} dní s generováním`)}
    </div>
    <div class="grid2">
      <section class="panel"><div class="panel-head"><h2>Spotřebované kredity po dnech</h2><span class="muted">${n} dní</span></div><div class="chart" id="chCredits"></div></section>
      <section class="panel"><div class="panel-head"><h2>Náklady celkem (Kč)</h2><span class="muted">kumulativně</span></div><div class="chart" id="chCum"></div></section>
    </div>
    <section class="panel"><div class="panel-head"><h2>Po dnech</h2><span class="muted">dny s generováním, nejnovější nahoře</span></div>
      <div class="table-wrap" style="max-height:380px;overflow-y:auto"><table><thead><tr><th>Den</th><th class="r">Kredity</th><th class="r">Náklad</th></tr></thead><tbody>
      ${rows.length ? rows.map((x) => `<tr><td>${fday(parseIso(x.day))}</td><td class="r num">${fmt(x.credits)}</td><td class="r num">${czk2(x.credits)}</td></tr>`).join('') : '<tr><td colspan="3" class="muted">Zatím žádná spotřeba.</td></tr>'}
      </tbody></table></div>
      <p class="hint" style="margin-top:8px">Kredity jsou přesná čísla z ElevenLabs (model ${esc(d.model || '')}, za celý účet). Kč jsou odhad: cena tarifu ÷ kredity v tarifu, kurz ČNB ${rate.date ? esc(rate.date) : 'odhadem'} (${dec(rate[cur] || 0, 2)} Kč/${cur}), bez DPH. Načteno ${new Date(d.fetched_at).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}, data se obnovují po 10 minutách.</p>
    </section>`;
}
PAGES.hlas = () => (D.live ? pageVoiceLive() : pageVoice());
ACTIONS.costReload = () => { COST.state = 'idle'; loadCosts(true); render(); };


let payT;
Object.assign(ACTIONS, {
  anDays: (v) => { AN.days = Number(v); render(); },
  payRefund: (v) => {
    const p = D.payments.find((x) => x.id === v);
    confirmBox('Vrátit platbu?', `${kc(p.czk)} rodině ${esc(famName(API.families.get(p.fam)))} přes ${p.store}. V ukázce se nic neposílá, jen se změní stav a zapíše audit log.`, 'Vrátit platbu', () => { API.payments.refund(v); PAY.vt && PAY.vt.reset(true); toast('Platba je označená jako vrácená'); });
  },
  payRemind: (v) => { API.log('payment.remind', v, 'Připomínka neuhrazené platby (ukázka)'); toast('Připomínka zapsaná do audit logu (ukázka, nic se neodeslalo)'); },
  ttsRetry: (v) => { const j = D.ttsJobs.find((x) => x.id === v); j.status = 'běží'; j.err = null; API.log('tts.retry', v, 'Nové generování (ukázka)'); render(); toast('Úloha je znovu ve frontě (ukázka)'); },
});
document.addEventListener('input', (ev) => {
  const t = ev.target, f = t.dataset.f;
  if (f === 'payq') { clearTimeout(payT); payT = setTimeout(() => { PAY.q = t.value; PAY.vt && PAY.vt.reset(); }, 120); }
});
document.addEventListener('change', (ev) => {
  const t = ev.target, f = t.dataset.f;
  if (f === 'paystatus' || f === 'paystore') { PAY[f.slice(3)] = t.value; PAY.vt && PAY.vt.reset(); }
  if (f === 'ttsPrice') { store.set(TTS_KEY, Number(t.value) || 0); render(); }
});
