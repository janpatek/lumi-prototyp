// ---------- Předplatné z obchodů: data pro dashboard Předplatné ----------
// Metriky jako v RevenueCat, ale z vlastní evidence: tabulky store_subs a store_events (supabase/schema.sql), které plní
// Edge Function store z oznámení App Store a Google Play. V ukázce se události poskládají z vymyšlených rodin.
// Načítá se před api.js: v ostrém režimu z událostí doplní platby (D.payments), stav předplatného rodin a denní MRR,
// takže Přehled, Rodiny i Helpdesk ukazují totéž co dashboard.
//
// D.store = {
//   subs:   [{ id, platform: 'ios'|'android', fam, status, trial, started, expires, renew, country, currency, price }],
//   events: [{ id, sub, fam, platform, type, at, start, end, amount, currency, czk, net, country, refunded }],
//   daily:  { subs, trials, mrr, mrrNet, newTrials, conversions, newPaid, renewals, revenue, proceeds, refunds, refundN, cancels, churn, trialEnds },
//   trialCohorts: [{ w, started, ended, converted }], payCohorts: [{ month, size, active[], ltv[] }], ...
// }
// Typy událostí: trial (začátek zkušební doby), buy (první platba bez zkušební doby), convert (první platba po zkušební době),
// renew (další platba), cancel (vypnuté automatické obnovení), uncancel, issue (platba selhala), expire, refund (vrácení), pause.
(function () {
  const D = window.DEMO;
  const N = D.days, DAY = 864e5, NOW = Date.now();
  // Ceny v obchodech jsou s DPH; obchod DPH odvede a strhne provizi 15 % (Small Business Program / prvních 12 měsíců předplatného).
  const VAT = { CZ: 0.21, SK: 0.23 }, FEE = 0.15;
  const netOf = (czk, country) => (czk / (1 + (VAT[country] ?? VAT.CZ))) * (1 - FEE);
  const day0 = D.dayAt(0).getTime();
  const idx = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return Math.round((d.getTime() - day0) / DAY); };
  const endOf = (i) => Math.min(NOW, D.dayAt(i).getTime() + DAY - 1);
  const PAY = new Set(['buy', 'convert', 'renew']);
  const STORE = { ios: 'App Store', android: 'Google Play' };

  let subs = [], events = [];
  if (D.live) {
    const raw = D.storeRaw || { subs: [], events: [] };
    const bySeq = new Map(D.families.map((f) => [f.n, f.id]));
    const dt = (x) => (x ? new Date(x) : null);
    subs = raw.subs.map((s) => ({ ...s, fam: bySeq.get(Number(s.fam)) || null, started: dt(s.started), expires: dt(s.expires), price: s.price == null ? null : Number(s.price) }));
    events = raw.events.map((e) => ({ ...e, id: 'e' + e.id, fam: bySeq.get(Number(e.fam)) || null, at: dt(e.at), start: dt(e.start), end: dt(e.end), amount: Number(e.amount) || 0, czk: Number(e.czk) || 0 }));
  } else {
    // ukázka: z rodin a plateb v demo-data.js (zkušební 3 dny, pak měsíční předplatné)
    const at = (i, h = 12) => { const d = D.dayAt(0); d.setDate(d.getDate() + Math.max(0, i)); d.setHours(h, (i * 37) % 60); return d; };
    const pays = new Map();
    D.payments.forEach((p) => { if (!pays.has(p.fam)) pays.set(p.fam, []); pays.get(p.fam).push(p); });
    let k = 1;
    const ev = (o) => events.push({ id: 'e' + k++, amount: 0, czk: 0, ...o });
    D.families.forEach((f) => {
      if (f.trialI < 0 || f.plan === 'dárek') return;
      const platform = f.platform === 'iOS' ? 'ios' : 'android', country = f.country || 'CZ', currency = country === 'SK' ? 'EUR' : 'CZK';
      const id = 's' + f.id, base = { sub: id, fam: f.id, platform, country, currency };
      const tS = f.subI >= 0 ? f.subI - 3 : f.status === 'trial' ? N - 1 - (f.n % 3) : f.trialI, tE = tS + 3;
      ev({ ...base, type: 'trial', at: at(tS, 19), start: at(tS, 19), end: at(tE, 19) });
      const list = (pays.get(f.id) || []).slice().sort((a, b) => a.at - b.at);
      let paid = 0;
      list.forEach((p) => {
        if (p.status === 'selhala') { ev({ ...base, type: 'issue', at: p.at }); return; }
        ev({ ...base, type: paid++ ? 'renew' : 'convert', at: p.at, start: p.at, end: new Date(p.at.getTime() + 30 * DAY), amount: p.amount, czk: p.czk });
        if (p.status === 'vráceno') ev({ ...base, type: 'refund', at: new Date(p.at.getTime() + 2 * DAY), amount: -p.amount, czk: -p.czk });
      });
      const quit = f.n % 13 === 0 && f.status === 'active';
      if (f.subEnd >= 0) { ev({ ...base, type: 'cancel', at: at(f.subEnd - 6, 21) }); ev({ ...base, type: 'expire', at: at(f.subEnd, 19) }); }
      else if (f.status === 'expired') { ev({ ...base, type: 'cancel', at: at(tS + 1, 21) }); ev({ ...base, type: 'expire', at: at(tE, 19) }); }
      else if (quit) ev({ ...base, type: 'cancel', at: at(N - 1 - (f.n % 9), 21) });
      const status = { trial: 'trial', active: 'active', past_due: 'retry', canceled: 'expired', expired: 'expired' }[f.status] || 'expired';
      const last = list.filter((p) => p.status !== 'selhala').pop();
      subs.push({ id, platform, fam: f.id, status, trial: status === 'trial', started: at(tS, 19), expires: status === 'trial' ? at(tE, 19) : last ? new Date(last.at.getTime() + 30 * DAY) : at(tE, 19),
        renew: (status === 'active' || status === 'trial') && !quit, country, currency, price: country === 'SK' ? 4.99 : 129 });
    });
  }
  events.sort((a, b) => a.at - b.at);
  const subMap = new Map(subs.map((s) => [s.id, s]));
  events.forEach((e) => { e.net = PAY.has(e.type) || e.type === 'refund' ? netOf(e.czk, e.country || subMap.get(e.sub)?.country) : 0; });

  // ---------- období jednotlivých předplatných ----------
  const per = new Map(); // sub → { paid: [], trials: [], firstPaid, lastPaidEnd }
  const of = (id) => { if (!per.has(id)) per.set(id, { paid: [], trials: [], firstPaid: null, firstTrial: null }); return per.get(id); };
  events.forEach((e) => {
    const p = of(e.sub);
    if (PAY.has(e.type) && e.start && e.end) { p.paid.push({ s: +e.start, e: +e.end, czk: e.czk, net: e.net, ev: e }); if (!p.firstPaid) p.firstPaid = e; }
    else if (e.type === 'trial' && e.start && e.end) { p.trials.push({ s: +e.start, e: +e.end, ev: e }); if (!p.firstTrial) p.firstTrial = e; }
    else if (e.type === 'refund') {
      const t = +e.at, hit = p.paid.filter((x) => x.s <= t).pop();
      if (hit) { hit.e = Math.min(hit.e, t); hit.ev.refunded = true; }
    } else if (e.type === 'expire') [...p.paid, ...p.trials].forEach((x) => { if (x.s < +e.at && x.e > +e.at) x.e = +e.at; });
  });

  const z = () => new Float64Array(N);
  const dl = { subs: z(), trials: z(), mrr: z(), mrrNet: z(), newTrials: z(), conversions: z(), newPaid: z(), renewals: z(), revenue: z(), proceeds: z(), refunds: z(), refundN: z(), cancels: z(), churn: z(), trialEnds: z(), issues: z() };
  const cover = (x, f) => { for (let i = Math.max(0, idx(x.s)); i <= Math.min(N - 1, idx(x.e)); i++) { const T = endOf(i); if (x.s <= T && x.e > T) f(i); } };
  per.forEach((p, id) => {
    p.paid.forEach((x) => {
      const days = Math.max(1, (x.ev.end - x.ev.start) / DAY), m = days > 40 ? 30.4 / days : 1; // roční by se rozpočítalo na měsíce
      cover(x, (i) => { dl.subs[i]++; dl.mrr[i] += x.czk * m; dl.mrrNet[i] += x.net * m; });
    });
    p.trials.forEach((x) => cover(x, (i) => dl.trials[i]++));
    p.lastPaidEnd = p.paid.reduce((a, x) => Math.max(a, x.e), 0);
    const later = p.trials.some((t) => t.s >= p.lastPaidEnd);
    p.churnAt = p.paid.length && p.lastPaidEnd <= NOW && !later && !['active', 'grace'].includes(subMap.get(id)?.status) ? p.lastPaidEnd : null;
    if (p.churnAt) { const i = idx(p.churnAt); if (i >= 0 && i < N) dl.churn[i]++; }
  });
  events.forEach((e) => {
    const i = idx(e.at); if (i < 0 || i >= N) return;
    if (e.type === 'trial') dl.newTrials[i]++;
    if (e.type === 'convert') dl.conversions[i]++;
    if (e.type === 'buy' || e.type === 'convert') dl.newPaid[i]++;
    if (e.type === 'renew') dl.renewals[i]++;
    if (PAY.has(e.type)) { dl.revenue[i] += e.czk; dl.proceeds[i] += e.net; }
    if (e.type === 'refund') { dl.refunds[i] += -e.czk; dl.refundN[i]++; dl.proceeds[i] += e.net; }
    if (e.type === 'cancel') dl.cancels[i]++;
    if (e.type === 'issue') dl.issues[i]++;
  });

  // ---------- konverze zkušební doby (podle týdne začátku) ----------
  const trialCohorts = [];
  const trialsAll = [];
  per.forEach((p) => p.trials.forEach((t) => {
    const paidAfter = p.paid.some((x) => x.s >= t.s - 36e5);
    const ended = t.ev.end <= NOW || paidAfter;
    trialsAll.push({ s: t.s, end: +t.ev.end, ended, converted: paidAfter });
    const i = idx(t.s); if (i < 0 || i >= N) return;
    const w = D.weekOf(i);
    trialCohorts[w] = trialCohorts[w] || { w, i, started: 0, ended: 0, converted: 0 };
    const c = trialCohorts[w]; c.started++; if (ended) c.ended++; if (paidAfter) c.converted++;
    if (ended) { const j = idx(Math.min(NOW, t.ev.end)); if (j >= 0 && j < N) dl.trialEnds[j]++; }
  }));

  // ---------- kohorty platících podle měsíce první platby: retence a realizované LTV ----------
  const M = 30.4 * DAY, months = 6, cohorts = new Map();
  per.forEach((p) => {
    if (!p.firstPaid) return;
    const f0 = +p.firstPaid.at, d = new Date(f0), key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!cohorts.has(key)) cohorts.set(key, { month: new Date(d.getFullYear(), d.getMonth(), 1), size: 0, active: new Float64Array(months), known: new Float64Array(months), ltv: new Float64Array(months) });
    const c = cohorts.get(key); c.size++;
    for (let k = 0; k < months; k++) {
      const t = f0 + k * M + DAY;
      if (t > NOW) continue;
      c.known[k]++;
      if (p.paid.some((x) => x.s <= t && x.e > t)) c.active[k]++;
      c.ltv[k] += p.paid.filter((x) => x.s < f0 + (k + 1) * M).reduce((a, x) => a + x.net + (x.ev.refunded ? -x.net : 0), 0);
    }
  });
  const payCohorts = [...cohorts.values()].sort((a, b) => a.month - b.month);

  D.store = { subs, events, daily: dl, trialCohorts: trialCohorts.filter(Boolean), trialsAll, payCohorts, per, netOf, VAT, FEE, STORE, PAY, idx, months };

  // ---------- ostrý režim: zbytek administrace bere stav z obchodů ----------
  if (D.live) {
    D.payments = events.filter((e) => PAY.has(e.type) || e.type === 'issue').map((e) => {
      const s = subMap.get(e.sub) || {};
      const amount = e.type === 'issue' ? s.price || 0 : e.amount;
      return { id: e.id, fam: e.fam, at: e.at, store: STORE[e.platform] || e.platform, plan: 'měsíc', cur: e.currency || 'CZK', amount, czk: e.type === 'issue' ? 0 : e.czk,
        fee: e.type === 'issue' ? 0 : Math.round(e.czk / (1 + (VAT[e.country] ?? VAT.CZ)) * FEE * 100) / 100, status: e.type === 'issue' ? 'selhala' : e.refunded ? 'vráceno' : 'zaplaceno' };
    }).sort((a, b) => b.at - a.at);
    const latest = new Map();
    subs.forEach((s) => { if (s.fam && (!latest.has(s.fam) || latest.get(s.fam).started < s.started)) latest.set(s.fam, s); });
    D.families.forEach((f) => {
      const s = latest.get(f.id); if (!s) return;
      const p = per.get(s.id) || { paid: [], trials: [] };
      const st = { trial: 'trial', active: 'active', grace: 'past_due', retry: 'past_due', paused: 'canceled', refunded: 'canceled' }[s.status] || (p.paid.length ? 'canceled' : 'expired');
      f.status = st; f.plan = 'měsíc';
      f.premium = ['trial', 'active', 'past_due'].includes(st) ? 'měsíc' : null;
      f.failed = st === 'past_due';
      f.trialI = p.trials.length ? Math.max(0, idx(p.trials[0].s)) : -1;
      f.subI = p.paid.length ? Math.max(0, idx(p.paid[0].s)) : -1;
      f.subEnd = st === 'canceled' && p.lastPaidEnd ? Math.min(N - 1, idx(p.lastPaidEnd)) : -1;
      f.store = s;
    });
    D.daily.mrr = dl.mrr; D.daily.subs = dl.subs; D.daily.trials = dl.trials;
  }
})();
