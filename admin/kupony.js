// ---------- Kupony a partneři ----------
// Každý kupon (kampaň) má tři nezávislé volby:
//  1. co kód dává   – vyzkoušení zdarma bez karty, měsíce zdarma, procentní sleva, sleva v Kč,
//  2. pro koho je   – známí, influencer/partner, kampaň, školky a firmy, kompenzace z podpory,
//  3. jak se rozdává – jeden společný kód (VECERNI) nebo sada jednorázových kódů (ZNAMI-7KQ4-M2PX).
// Vyzkoušení a měsíce zdarma přiděluje RevenueCat jako dočasný nárok (promotional entitlement): rodina nic
// neplatí a nezadává kartu, proto fungují stejně na iOS, Androidu i webu. Slevy z ceny musí projít obchodem
// (App Store / Google Play nabídkové kódy) nebo Stripe na webu.
// Partner dostává provizi z rodin, které se registrovaly s jeho kódem (atribuce 30 dní od kliknutí na odkaz).
// Dnes ukázková data; nové kampaně, kódy a výplaty se drží v localStorage tohoto prohlížeče.

const CPN = (() => {
  const KEY = 'ospalek.admin.coupons.v1';
  const ALPH = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // bez 0/O, 1/I/L, ať se kód dá přečíst a opsat
  const GIVES = {
    trial: { label: 'Vyzkoušení zdarma bez karty', unit: 'dní', where: 'iOS, Android i web', how: 'RevenueCat přidělí dočasný přístup. Rodina nic neplatí ani nezadává kartu, po skončení uvidí nabídku předplatného.' },
    months: { label: 'Měsíce zdarma', unit: 'měs.', where: 'iOS, Android i web', how: 'RevenueCat přidělí dočasný přístup. U už platících rodin se místo toho použije nabídka obchodu (Apple promotional offer, odklad platby v Google Play).' },
    percent: { label: 'Procentní sleva', unit: '%', where: 'web; v obchodech přes nabídkové kódy', how: 'Na webu Stripe kupon. App Store a Google Play umí jen předem založené nabídky, sleva se zaokrouhlí na jejich cenovou úroveň.' },
    amount: { label: 'Sleva v Kč', unit: 'Kč', where: 'jen web', how: 'Pevnou částku umí jen Stripe na webu, obchody ne.' },
  };
  const PURPOSE = {
    znami: { label: 'Přátelé a známí', tag: 'mint' },
    partner: { label: 'Influencer / partner', tag: 'peach' },
    marketing: { label: 'Kampaň', tag: 'sky' },
    b2b: { label: 'Školky a firmy', tag: 'honey' },
    podpora: { label: 'Kompenzace z podpory', tag: 'line' },
  };
  const PRESETS = {
    znami: { name: 'Známí: měsíc na vyzkoušení', purpose: 'znami', gives: 'trial', value: 30, mode: 'unique', count: 10, prefix: 'ZNAMI', newOnly: true, days: 90, desc: '30 dní zdarma bez karty, každý dostane svůj kód' },
    partner: { name: 'Influencer: ', purpose: 'partner', gives: 'percent', value: 20, dur: 'year', mode: 'shared', newOnly: true, days: 180, comm: { kind: 'fixed', value: 150 }, desc: 'vlastní kód, sleva pro sledující, provize za platící rodinu' },
    marketing: { name: 'Kampaň: ', purpose: 'marketing', gives: 'percent', value: 20, dur: 'first', mode: 'shared', newOnly: true, days: 30, desc: 'jeden veřejný kód na sociální sítě nebo leták' },
    b2b: { name: 'Školka: ', purpose: 'b2b', gives: 'trial', value: 30, mode: 'unique', count: 50, prefix: 'SKOLKA', newOnly: true, days: 120, desc: 'sada jednorázových kódů na rozdání rodičům' },
    podpora: { name: 'Kompenzace z podpory', purpose: 'podpora', gives: 'months', value: 1, mode: 'unique', count: 1, prefix: 'OMLUVA', newOnly: false, days: 60, desc: 'měsíc zdarma jako omluva za problém' },
  };

  const DAY = 864e5, NOW = Date.now();
  const mk = (s) => () => { s = (s + 0x6d2b79f5) | 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const rndChars = (n, r) => {
    let s = '';
    if (r) { for (let i = 0; i < n; i++) s += ALPH[Math.floor(r() * ALPH.length)]; return s; }
    const b = new Uint32Array(n); crypto.getRandomValues(b);
    for (let i = 0; i < n; i++) s += ALPH[b[i] % ALPH.length];
    return s;
  };
  const ls = { get(d) { try { return JSON.parse(localStorage.getItem(KEY)) || d; } catch (e) { return d; } }, set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} } };
  const st = ls.get({ campaigns: [], codes: {}, paused: {}, partners: [], paid: {} });
  const revive = (c) => ({ ...c, from: new Date(c.from), to: c.to ? new Date(c.to) : null, created: new Date(c.created) });

  // ---------- Ukázkové kampaně a partneři ----------
  const partners = [
    { id: 'p1', name: 'Večerní máma (ukázka)', handle: '@vecerni_mama_ukazka', channel: 'Instagram', email: 'partner1@example.cz' },
    { id: 'p2', name: 'Táta na cestách (ukázka)', handle: '@tata_na_cestach_ukazka', channel: 'YouTube', email: 'partner2@example.cz' },
    { id: 'p3', name: 'Podcast Malí a velcí (ukázka)', handle: 'malievelci.example', channel: 'Podcast', email: 'partner3@example.cz' },
    ...st.partners,
  ];
  const ago = (d) => new Date(NOW - d * DAY);
  const demo = [
    { id: 'c1', name: 'Známí: měsíc na vyzkoušení', purpose: 'znami', gives: 'trial', value: 30, mode: 'unique', prefix: 'ZNAMI', count: 40, newOnly: true, from: ago(70), to: ago(-20), limit: null, created: ago(70), rate: 0.6 },
    { id: 'c2', name: 'Influencer: Večerní máma', purpose: 'partner', partner: 'p1', gives: 'percent', value: 20, dur: 'year', mode: 'shared', code: 'VECERNI', newOnly: true, from: ago(55), to: ago(-125), limit: null, comm: { kind: 'fixed', value: 150 }, created: ago(56), rate: 0.035 },
    { id: 'c3', name: 'Influencer: Táta na cestách', purpose: 'partner', partner: 'p2', gives: 'percent', value: 15, dur: 'months', months: 3, mode: 'shared', code: 'TATA15', newOnly: true, from: ago(32), to: ago(-60), limit: 500, comm: { kind: 'percent', value: 20 }, created: ago(33), rate: 0.02 },
    { id: 'c4', name: 'Podcast Malí a velcí', purpose: 'partner', partner: 'p3', gives: 'trial', value: 30, mode: 'shared', code: 'MALIAVELCI', newOnly: true, from: ago(20), to: ago(-40), limit: null, comm: { kind: 'fixed', value: 120 }, created: ago(21), rate: 0.015 },
    { id: 'c5', name: 'Instagram: 20 % na 12 měsíců', purpose: 'marketing', gives: 'percent', value: 20, dur: 'year', mode: 'shared', code: 'INSTAGRAM20', newOnly: true, from: ago(90), to: ago(-30), limit: null, created: ago(90), rate: 0.03 },
    { id: 'c6', name: 'Školka Sluníčko (ukázka)', purpose: 'b2b', gives: 'trial', value: 30, mode: 'unique', prefix: 'SKOLKA', count: 60, newOnly: true, from: ago(45), to: ago(-75), limit: null, created: ago(45), rate: 0.4 },
    { id: 'c7', name: 'Mikuláš: 2 měsíce za cenu jednoho', purpose: 'marketing', gives: 'percent', value: 50, dur: 'months', months: 2, mode: 'shared', code: 'MIKULAS', newOnly: false, from: ago(-20), to: ago(-29), limit: null, created: ago(3), rate: 0 },
    { id: 'c8', name: 'Kompenzace z podpory', purpose: 'podpora', gives: 'months', value: 1, mode: 'unique', prefix: 'OMLUVA', count: 8, newOnly: false, from: ago(120), to: null, limit: null, created: ago(120), rate: 0.02 },
  ];
  const campaigns = [...demo, ...st.campaigns.map(revive)];
  const NOTES = ['sestra', 'kamarádka z práce', 'sousedi', 'kmotra', 'babička a děda', 'spolužák', 'rodiče z hřiště', 'švagrová', 'kolega', 'teta'];

  // jednorázové kódy ukázkových kampaní vznikají ze semínka, ať jsou pořád stejné
  const codes = {};
  demo.filter((c) => c.mode === 'unique').forEach((c, k) => {
    const r = mk(4242 + k);
    codes[c.id] = Array.from({ length: c.count }, (_, i) => ({ c: `${c.prefix}-${rndChars(4, r)}-${rndChars(4, r)}`, note: c.purpose === 'znami' ? NOTES[i % NOTES.length] : '', used: null }));
  });
  Object.entries(st.codes).forEach(([cid, list]) => { codes[cid] = [...(codes[cid] || []), ...list]; });

  // Uplatnění: ukázkově se rodiny registrované v době kampaně přiřadí ke kódu (deterministicky podle čísla rodiny)
  const red = [];
  const byFam = new Map();
  const fams = D.families.filter((f) => f.email).slice().sort((a, b) => a.created - b.created);
  fams.forEach((f) => {
    const r = mk(f.n * 31 + 7);
    for (const c of demo) {
      if (!c.rate || f.created < c.from || (c.to && f.created > c.to) || byFam.has(f.id)) continue;
      // přes partnery a kampaně přichází víc rodin, které pak platí
      const boost = c.mode === 'shared' && f.subI >= 0 ? 6 : 1;
      if (r() >= c.rate * boost * (c.mode === 'unique' ? 0.12 : 1)) continue;
      let code = c.code;
      if (c.mode === 'unique') { const free = codes[c.id].find((x) => !x.used); if (!free) continue; free.used = f.id; code = free.c; }
      if (c.limit && red.filter((x) => x.cid === c.id).length >= c.limit) continue;
      const e = { cid: c.id, fam: f.id, code, at: f.created };
      red.push(e); byFam.set(f.id, e);
    }
  });

  const save = () => {
    st.campaigns = campaigns.filter((c) => c.local);
    st.partners = partners.filter((p) => p.local);
    ls.set(st);
  };
  const allCodes = () => { const s = new Set(); campaigns.forEach((c) => c.code && s.add(c.code)); Object.values(codes).forEach((l) => l.forEach((x) => s.add(x.c))); return s; };
  function generate(prefix, n) {
    const taken = allCodes(), out = [];
    while (out.length < n) { const c = `${prefix}-${rndChars(4)}-${rndChars(4)}`; if (!taken.has(c)) { taken.add(c); out.push(c); } }
    return out;
  }
  const status = (c) => (st.paused[c.id] ? 'paused' : c.from > NOW ? 'planned' : c.to && c.to < NOW ? 'ended' : c.limit && stats(c).uses >= c.limit ? 'full' : 'active');
  const STATUS = { active: ['Aktivní', 'mint'], planned: ['Naplánováno', 'sky'], paused: ['Pozastaveno', 'honey'], ended: ['Skončilo', 'line'], full: ['Vyčerpáno', 'line'] };

  const statCache = new Map();
  function stats(c) {
    if (statCache.has(c.id)) return statCache.get(c.id);
    const list = red.filter((x) => x.cid === c.id);
    let paying = 0, revenue = 0, trials = 0, last30 = 0;
    list.forEach((x) => {
      const f = API.families.get(x.fam); if (!f) return;
      if (x.at >= NOW - 30 * DAY) last30++;
      if (f.trialI >= 0 || c.gives === 'trial') trials++;
      const pays = API.families.payments(f.id).filter((p) => p.status === 'zaplaceno');
      if (pays.length) paying++;
      revenue += pays.reduce((s, p) => s + p.czk, 0);
    });
    const commission = !c.comm ? 0 : c.comm.kind === 'fixed' ? paying * c.comm.value : revenue * (c.comm.value / 100);
    // poskytnutá sleva: u procent dopočet z tržeb, u vyzkoušení a měsíců zdarma ušlé předplatné
    const discount = c.gives === 'percent' ? revenue * (c.value / (100 - c.value)) * (c.dur === 'first' ? 0.5 : 0.8) : c.gives === 'amount' ? paying * c.value : 0;
    const s = { uses: list.length, last30, trials, paying, revenue, commission, discount, list, codes: codes[c.id] || null };
    statCache.set(c.id, s);
    return s;
  }
  const invalidate = () => statCache.clear();

  function describe(c) {
    const durTxt = c.dur === 'first' ? 'na první platbu' : c.dur === 'year' ? 'na prvních 12 měsíců' : c.dur === 'months' ? `na ${c.months} ${plural(c.months, 'měsíc', 'měsíce', 'měsíců')}` : '';
    const g = c.gives === 'trial' ? `${c.value} dní zdarma bez platební karty`
      : c.gives === 'months' ? `${c.value} ${plural(c.value, 'měsíc', 'měsíce', 'měsíců')} předplatného zdarma`
      : c.gives === 'percent' ? `sleva ${c.value} % ${durTxt}`
      : `sleva ${c.value} Kč ${durTxt}`;
    return g + (c.newOnly ? ', jen pro nové rodiny' : '');
  }

  return {
    GIVES, PURPOSE, PRESETS, STATUS, campaigns, partners, codes, red, byFam, stats, status, describe, invalidate,
    get: (id) => campaigns.find((c) => c.id === id),
    partner: (id) => partners.find((p) => p.id === id),
    paidOut: (pid) => st.paid[pid] || 0,
    find(code) {
      const q = code.trim().toUpperCase();
      for (const c of campaigns) {
        if (c.code === q) return { c, code: q, used: null };
        const hit = (codes[c.id] || []).find((x) => x.c === q);
        if (hit) return { c, code: q, used: hit.used, note: hit.note };
      }
      return null;
    },
    codeTaken: (code) => allCodes().has(code),
    generate,
    create(c, notes) {
      c.id = 'c' + Date.now(); c.local = true; c.created = new Date();
      campaigns.unshift(c);
      if (c.mode === 'unique') {
        const list = generate(c.prefix, c.count).map((x, i) => ({ c: x, note: notes[i] || '', used: null }));
        st.codes[c.id] = list; codes[c.id] = list;
      }
      save(); API.log('coupon.create', c.code || c.prefix, `${c.name} · ${describe(c)}${c.mode === 'unique' ? ` · ${c.count} kódů` : ''}`);
      return c;
    },
    addCodes(cid, n, notes = []) {
      const c = this.get(cid), list = generate(c.prefix, n).map((x, i) => ({ c: x, note: notes[i] || '', used: null }));
      st.codes[cid] = [...(st.codes[cid] || []), ...list]; codes[cid] = [...(codes[cid] || []), ...list];
      c.count = codes[cid].length; save(); invalidate();
      API.log('coupon.codes', c.prefix, `+${n} kódů do „${c.name}“`);
    },
    togglePause(cid) {
      const c = this.get(cid); st.paused[cid] = !st.paused[cid]; if (!st.paused[cid]) delete st.paused[cid];
      save(); API.log('coupon.pause', c.code || c.prefix, st.paused[cid] ? 'Pozastaveno' : 'Obnoveno');
    },
    addPartner(p) { p.id = 'p' + Date.now(); p.local = true; partners.push(p); save(); API.log('partner.create', p.name, p.handle || ''); return p; },
    markPaid(pid, amount) { st.paid[pid] = (st.paid[pid] || 0) + amount; save(); API.log('partner.payout', this.partner(pid).name, `Provize vyplacena ${kc(amount)} (ukázka)`); },
  };
})();

// ---------- Stránka ----------
const KUP = { tab: 'kampane' };
const canC = () => API.can('coupons.manage');
const cStatus = (c) => { const [l, t] = CPN.STATUS[CPN.status(c)]; return `<span class="tag ${t}">${l}</span>`; };
const cPurpose = (c) => `<span class="tag ${CPN.PURPOSE[c.purpose].tag}">${CPN.PURPOSE[c.purpose].label}</span>`;
const cCodes = (c) => (c.mode === 'shared' ? `<span class="mono"><b>${esc(c.code)}</b></span>` : `<span class="mono">${esc(c.prefix)}-…</span> <span class="muted">${fmt((CPN.codes[c.id] || []).length)} kódů</span>`);
const shareLink = (code) => `https://ospalek.cz/?kod=${encodeURIComponent(code)}`;
const shareMsg = (c, code) => (c.gives === 'trial'
  ? `Ahoj, zkoušíme pohádky Ospalek, kde je hlavním hrdinou tvoje dítě. Tady máš ${c.value} dní zdarma, nemusíš zadávat kartu: ${shareLink(code)} (kód ${code})`
  : `Ahoj, posílám kód do aplikace Ospalek s pohádkami, kde je hrdinou tvoje dítě: ${code}. Platí tady: ${shareLink(code)}`);

function partnerStats(p) {
  const cs = CPN.campaigns.filter((c) => c.partner === p.id);
  const s = cs.reduce((a, c) => { const x = CPN.stats(c); a.uses += x.uses; a.paying += x.paying; a.revenue += x.revenue; a.comm += x.commission; return a; }, { uses: 0, paying: 0, revenue: 0, comm: 0 });
  s.campaigns = cs; s.paid = CPN.paidOut(p.id); s.owed = Math.max(0, s.comm - s.paid);
  return s;
}

function pageCoupons() {
  const p = routeParam();
  if (p && CPN.get(p)) return pageCampaign(CPN.get(p));
  const all = CPN.campaigns.map((c) => ({ c, s: CPN.stats(c) }));
  const active = all.filter((x) => CPN.status(x.c) === 'active').length;
  const uses30 = all.reduce((n, x) => n + x.s.last30, 0);
  const uses = all.reduce((n, x) => n + x.s.uses, 0), paying = all.reduce((n, x) => n + x.s.paying, 0), revenue = all.reduce((n, x) => n + x.s.revenue, 0);
  const owed = CPN.partners.reduce((n, p) => n + partnerStats(p).owed, 0);
  const znami = all.filter((x) => x.c.purpose === 'znami');
  const zUses = znami.reduce((n, x) => n + x.s.uses, 0), zPay = znami.reduce((n, x) => n + x.s.paying, 0);
  const presets = Object.entries(CPN.PRESETS).map(([k, v]) => `<button class="panel preset" data-a="cpnNew" data-v="${k}" ${canC() ? '' : 'disabled'}><span class="tag ${CPN.PURPOSE[v.purpose].tag}">${CPN.PURPOSE[v.purpose].label}</span><span>${esc(v.desc)}</span></button>`).join('');
  return `
    ${head('Kupony a partneři', 'Slevy, vyzkoušení zdarma pro známé a kódy pro influencery', `<button class="btn white" data-a="cpnCheck">${I.search}Ověřit kód</button>${canC() ? `<button class="btn" data-a="cpnNew" data-v="">${I.plus}Nový kupon</button>` : ''}`)}
    ${demoBar('Kódy se zatím nikde neuplatní; uplatnění jsou přiřazená k ukázkovým rodinám.')}
    <div class="tiles t8">
      ${tile('Aktivní kampaně', fmt(active), `${fmt(CPN.campaigns.length)} celkem`)}
      ${tile('Uplatněno za 30 dní', fmt(uses30), `${fmt(uses)} celkem`)}
      ${tile('Rodiny z kódů, které platí', fmt(paying), `konverze ${pct(paying, uses)}`)}
      ${tile('Tržby od rodin z kódů', kc(revenue), 'všechny platby od uplatnění')}
      ${tile('Známí na vyzkoušení', fmt(zUses), `${fmt(zPay)} z nich si pak předplatné koupilo`)}
      ${tile('Partneři', fmt(CPN.partners.length), `${fmt(CPN.campaigns.filter((c) => c.partner).length)} kampaní`)}
      ${tile('Provize k výplatě', kc(owed), 'za platící rodiny od partnerů')}
      ${tile('Poskytnutá sleva (odhad)', kc(all.reduce((n, x) => n + x.s.discount, 0)), 'kolik stály slevy z ceny')}
    </div>
    <h2 style="margin:16px 0 8px;font-size:15px">Rychle vytvořit</h2>
    <div class="presets">${presets}</div>
    <div class="seg" style="margin:16px 0 10px">${[['kampane', 'Kampaně'], ['partneri', 'Partneři']].map(([k, l]) => `<button data-a="kupTab" data-v="${k}" class="${KUP.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <section class="panel">${KUP.tab === 'kampane' ? campaignsTable(all) : partnersTable()}</section>`;
}
function campaignsTable(all) {
  return `<div class="table-wrap"><table class="clickable"><thead><tr><th>Kampaň</th><th>Co dává</th><th>Kód</th><th class="r">Uplatněno</th><th class="r">Platí</th><th class="r">Tržby</th><th>Platnost</th><th>Stav</th></tr></thead><tbody>
    ${all.map(({ c, s }) => `<tr data-a="cpnOpen" data-v="${c.id}"><td><a class="link" href="#kupony/${c.id}">${esc(c.name)}</a><div style="margin-top:3px">${cPurpose(c)}${c.partner ? ` <span class="muted" style="font-size:12px">${esc(CPN.partner(c.partner)?.handle || '')}</span>` : ''}</div></td>
      <td style="white-space:normal;min-width:180px">${esc(CPN.describe(c))}</td><td>${cCodes(c)}</td>
      <td class="r num">${fmt(s.uses)}${c.limit ? ` / ${fmt(c.limit)}` : c.mode === 'unique' ? ` / ${fmt((CPN.codes[c.id] || []).length)}` : ''}</td><td class="r num">${fmt(s.paying)} <span class="muted">${s.uses ? pct(s.paying, s.uses) : ''}</span></td><td class="r num">${kc(s.revenue)}</td>
      <td class="num">${fdate(c.from)}${c.to ? ` – ${fdate(c.to)}` : ' – bez konce'}</td><td>${cStatus(c)}</td></tr>`).join('')}
  </tbody></table></div>`;
}
function partnersTable() {
  return `<div class="panel-head"><h2>Partneři a provize</h2>${canC() ? `<button class="btn white sm" data-a="partnerNew">${I.plus}Nový partner</button>` : ''}</div>
  <div class="table-wrap"><table><thead><tr><th>Partner</th><th>Kanál</th><th>Kódy</th><th class="r">Registrace</th><th class="r">Platí</th><th class="r">Tržby</th><th class="r">Provize</th><th class="r">Vyplaceno</th><th class="r">K výplatě</th><th></th></tr></thead><tbody>
  ${CPN.partners.map((p) => { const s = partnerStats(p); return `<tr><td><b>${esc(p.name)}</b><div class="muted" style="font-size:12px">${esc(p.handle || '')}</div></td><td>${esc(p.channel || '')}</td>
    <td>${s.campaigns.map((c) => `<a class="link mono" href="#kupony/${c.id}">${esc(c.code || c.prefix)}</a>`).join(', ') || '<span class="muted">zatím žádný</span>'}</td>
    <td class="r num">${fmt(s.uses)}</td><td class="r num">${fmt(s.paying)}</td><td class="r num">${kc(s.revenue)}</td><td class="r num">${kc(s.comm)}</td><td class="r num">${kc(s.paid)}</td><td class="r num"><b>${kc(s.owed)}</b></td>
    <td class="r">${API.can('billing.refund') && s.owed > 0 ? `<button class="btn white sm" data-a="partnerPaid" data-v="${p.id}">Vyplaceno</button>` : ''}${canC() && !s.campaigns.length ? `<button class="btn white sm" data-a="cpnNew" data-v="partner" data-p="${p.id}">Vytvořit kód</button>` : ''}</td></tr>`; }).join('')}
  </tbody></table></div>
  <p class="hint" style="margin-top:8px">Provize se počítá z rodin, které se registrovaly s kódem partnera nebo přes jeho odkaz (atribuce 30 dní). Pevná částka za platící rodinu, nebo procento z jejích plateb za prvních 12 měsíců.</p>`;
}

function pageCampaign(c) {
  const s = CPN.stats(c), g = CPN.GIVES[c.gives], p = c.partner && CPN.partner(c.partner);
  const list = s.codes;
  const funnel = [['Uplatnilo kód', s.uses], [c.gives === 'trial' ? 'Vyzkoušelo zdarma' : 'Začalo zkušební týden', s.trials], ['Platí nebo platilo', s.paying]];
  const fmax = Math.max(1, s.uses);
  const usedList = s.list.slice().sort((a, b) => b.at - a.at);
  return `
    <div class="head"><div class="fam-head"><a class="btn white sm" href="#kupony">${I.back}Kupony</a><div><h1>${esc(c.name)}</h1><p>${cPurpose(c)} ${cStatus(c)} ${p ? `· partner <b>${esc(p.name)}</b> ${esc(p.handle || '')}` : ''}</p></div></div>
      <div class="head-actions">
        ${c.mode === 'shared' ? `<button class="btn white sm" data-a="cpnCopy" data-v="${esc(shareLink(c.code))}">${I.copy}Kopírovat odkaz</button>` : `<button class="btn white sm" data-a="cpnCsv" data-v="${c.id}">${I.down}Kódy do CSV</button>`}
        ${canC() && c.mode === 'unique' ? `<button class="btn white sm" data-a="cpnMore" data-v="${c.id}">${I.plus}Další kódy</button>` : ''}
        ${canC() && ['active', 'paused', 'full'].includes(CPN.status(c)) ? `<button class="btn ${CPN.status(c) === 'paused' ? '' : 'danger'} sm" data-a="cpnPause" data-v="${c.id}">${CPN.status(c) === 'paused' ? 'Obnovit' : 'Pozastavit'}</button>` : ''}
      </div></div>
    ${demoBar()}
    <div class="grid21" style="margin-top:0">
      <section class="panel">
        <div class="notice" style="margin-bottom:12px"><img src="../brand/maskot-3d/web/ospalek-hlava.webp" alt=""><div><b>Rodina dostane: ${esc(CPN.describe(c))}.</b><br>Funguje: ${g.where}. ${g.how}</div></div>
        <dl class="kv" style="max-width:520px">
          <dt>Kód</dt><dd>${c.mode === 'shared' ? `<span class="mono">${esc(c.code)}</span>` : `${fmt(list.length)} jednorázových kódů ${esc(c.prefix)}-XXXX-XXXX`}</dd>
          ${c.mode === 'shared' ? `<dt>Odkaz</dt><dd class="mono">${esc(shareLink(c.code))}</dd>` : ''}
          <dt>Platnost</dt><dd>${fdate(c.from)} – ${c.to ? fdate(c.to) : 'bez konce'}</dd>
          <dt>Limit</dt><dd>${c.limit ? `${fmt(c.limit)} uplatnění` : c.mode === 'unique' ? 'každý kód jednou' : 'bez limitu'}${c.newOnly ? ' · jen nové rodiny' : ''}</dd>
          ${c.comm ? `<dt>Provize</dt><dd>${c.comm.kind === 'fixed' ? `${kc(c.comm.value)} za platící rodinu` : `${c.comm.value} % z plateb za 12 měsíců`}</dd>` : ''}
          <dt>Založeno</dt><dd>${fdate(c.created)}</dd>
        </dl>
      </section>
      <section class="panel"><div class="panel-head"><h2>Výsledky</h2></div>
        <div class="bars">${funnel.map(([l, v]) => `<div class="b"><span>${l}</span><span class="t"><i style="width:${(v / fmax) * 100}%"></i></span><span class="r num">${fmt(v)}</span></div>`).join('')}</div>
        <dl class="kv" style="margin-top:14px"><dt>Konverze na platící</dt><dd>${pct(s.paying, s.uses)}</dd><dt>Tržby</dt><dd>${kc(s.revenue)}</dd>${c.comm ? `<dt>Provize</dt><dd>${kc(s.commission)}</dd>` : ''}<dt>Poskytnutá sleva (odhad)</dt><dd>${kc(s.discount)}</dd></dl>
      </section>
    </div>
    ${list ? `<section class="panel" style="margin-top:12px"><div class="panel-head"><h2>Kódy</h2><span class="muted">${fmt(list.filter((x) => x.used).length)} z ${fmt(list.length)} použito</span></div>
      <div class="table-wrap" style="max-height:420px;overflow-y:auto"><table><thead><tr><th>Kód</th><th>Pro koho</th><th>Použila rodina</th><th></th></tr></thead><tbody>
      ${list.map((x) => `<tr><td class="mono"><b>${esc(x.c)}</b></td><td>${esc(x.note) || '<span class="muted">–</span>'}</td><td>${x.used ? famLink(API.families.get(x.used)) : '<span class="tag line">volný</span>'}</td>
        <td class="r">${x.used ? '' : `<button class="btn white sm" data-a="cpnCopy" data-v="${esc(shareMsg(c, x.c))}">${I.copy}Zpráva s kódem</button>`}</td></tr>`).join('')}
      </tbody></table></div></section>` : ''}
    <section class="panel" style="margin-top:12px"><div class="panel-head"><h2>Kdo kód uplatnil</h2><span class="muted">${fmt(usedList.length)}</span></div>
      <div class="table-wrap" style="max-height:420px;overflow-y:auto"><table><thead><tr><th>Kdy</th><th>Rodina</th><th>Kód</th><th>Tarif</th><th class="r">Zaplaceno</th></tr></thead><tbody>
      ${usedList.slice(0, 300).map((x) => { const f = API.families.get(x.fam); const paid = f ? API.families.payments(f.id).filter((q) => q.status === 'zaplaceno').reduce((a, q) => a + q.czk, 0) : 0; return `<tr><td class="num">${fdate(x.at)}</td><td>${famLink(f)}</td><td class="mono">${esc(x.code)}</td><td>${f ? subTag(f) : ''}</td><td class="r num">${paid ? kc(paid) : '–'}</td></tr>`; }).join('') || '<tr><td colspan="5" class="muted">Zatím nikdo.</td></tr>'}
      </tbody></table></div></section>`;
}
PAGES.kupony = pageCoupons;

// ---------- Průvodce novým kuponem ----------
let NK = null;
function openCouponWizard(presetKey, partnerId) {
  const pr = CPN.PRESETS[presetKey] || CPN.PRESETS.znami;
  const from = new Date(); from.setHours(0, 0, 0, 0);
  NK = { name: pr.name, purpose: pr.purpose, gives: pr.gives, value: pr.value, dur: pr.dur || 'first', months: 3, mode: pr.mode, code: '', prefix: pr.prefix || 'KOD', count: pr.count || 10, newOnly: pr.newOnly, from: iso(from), to: iso(addDays(from, pr.days)), limit: '', partner: partnerId || '', comm: pr.comm ? { ...pr.comm } : { kind: 'fixed', value: 150 }, notes: '' };
  if (partnerId) { const p = CPN.partner(partnerId); NK.name = 'Influencer: ' + p.name.replace(/ \(ukázka\)$/, ''); }
  modal(`<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="nkT" style="max-width:980px">
    <div class="dialog-head"><h2 id="nkT">Nový kupon</h2><button class="x" data-a="close" aria-label="Zavřít">×</button></div>
    <div class="dialog-body"><div class="edit"><div id="nkForm"></div><div><div class="preview" id="nkPrev"></div></div></div></div>
    <div class="dialog-foot"><div class="err" id="nkErr"></div><div class="r"><button class="btn white" data-a="close">Zrušit</button><button class="btn" data-a="nkSave">Vytvořit kupon</button></div></div></div>`);
  nkForm(); nkPreview();
  $('#nkForm input[data-nk="name"]').focus();
}
function nkForm() {
  const o = (v, l, cur) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`;
  const notesN = NK.notes.split('\n').map((x) => x.trim()).filter(Boolean).length;
  $('#nkForm').innerHTML = `
    <label>Pro koho</label>
    <div class="chips">${Object.entries(CPN.PURPOSE).map(([k, v]) => `<button type="button" class="chip ${NK.purpose === k ? 'on' : ''}" data-a="nkPurpose" data-v="${k}">${v.label}</button>`).join('')}</div>
    <label for="nkName">Název (vidí jen tým)</label><input id="nkName" data-nk="name" value="${esc(NK.name)}">
    ${NK.purpose === 'partner' ? `<div class="fields2">
      <div><label for="nkPartner">Partner</label><select id="nkPartner" data-nk="partner">${o('', 'Vyber partnera…', NK.partner)}${CPN.partners.map((p) => o(p.id, p.name, NK.partner)).join('')}</select></div>
      <div><label>Provize</label><div style="display:flex;gap:6px"><select data-nk="commKind" style="width:auto">${o('fixed', 'Kč za platící rodinu', NK.comm.kind)}${o('percent', '% z plateb 12 měsíců', NK.comm.kind)}</select><input data-nk="commValue" type="number" min="0" value="${NK.comm.value}" style="width:90px"></div></div>
    </div><p class="hint">Nového partnera přidáš v záložce Partneři.</p>` : ''}
    <div class="fields2">
      <div><label for="nkGives">Co kód dává</label><select id="nkGives" data-nk="gives">${Object.entries(CPN.GIVES).map(([k, v]) => o(k, v.label, NK.gives)).join('')}</select></div>
      <div><label for="nkValue">${NK.gives === 'trial' ? 'Počet dní' : NK.gives === 'months' ? 'Počet měsíců' : NK.gives === 'percent' ? 'Sleva v %' : 'Sleva v Kč'}</label><input id="nkValue" data-nk="value" type="number" min="1" max="${NK.gives === 'percent' ? 90 : 9999}" value="${NK.value}"></div>
    </div>
    ${NK.gives === 'percent' || NK.gives === 'amount' ? `<div class="fields2"><div><label for="nkDur">Na jak dlouho</label><select id="nkDur" data-nk="dur">${o('first', 'První platba', NK.dur)}${o('months', 'Několik měsíců', NK.dur)}${o('year', 'Prvních 12 měsíců', NK.dur)}</select></div>${NK.dur === 'months' ? `<div><label for="nkMonths">Měsíců</label><input id="nkMonths" data-nk="months" type="number" min="1" max="12" value="${NK.months}"></div>` : '<div></div>'}</div>` : ''}
    <label>Kódy</label>
    <div class="seg"><button type="button" data-a="nkMode" data-v="shared" class="${NK.mode === 'shared' ? 'on' : ''}">Jeden společný kód</button><button type="button" data-a="nkMode" data-v="unique" class="${NK.mode === 'unique' ? 'on' : ''}">Jednorázové kódy pro každého</button></div>
    ${NK.mode === 'shared' ? `<div class="fields2"><div><label for="nkCode">Kód</label><input id="nkCode" data-nk="code" value="${esc(NK.code)}" placeholder="např. VECERNI" style="text-transform:uppercase" autocomplete="off"></div><div><label for="nkLimit">Limit uplatnění (nepovinné)</label><input id="nkLimit" data-nk="limit" type="number" min="1" value="${esc(NK.limit)}"></div></div>`
    : `<div class="fields2"><div><label for="nkPrefix">Začátek kódu</label><input id="nkPrefix" data-nk="prefix" value="${esc(NK.prefix)}" style="text-transform:uppercase" autocomplete="off"></div><div><label for="nkCount">Počet kódů</label><input id="nkCount" data-nk="count" type="number" min="1" max="5000" value="${notesN || NK.count}" ${notesN ? 'disabled' : ''}></div></div>
      <label for="nkNotes">Pro koho jsou (nepovinné, jeden řádek = jeden kód)</label><textarea id="nkNotes" data-nk="notes" rows="4" style="font-family:var(--body);font-size:13px" placeholder="sestra\nsousedi\nkamarádka z práce">${esc(NK.notes)}</textarea>
      <p class="hint">Poznámka je jen pro tebe, ať víš, komu jsi který kód poslal. Kódy jsou náhodné (31 znaků bez 0/O a 1/I/L), nedají se uhodnout.</p>`}
    <div class="fields2"><div><label for="nkFrom">Platí od</label><input id="nkFrom" data-nk="from" type="date" value="${NK.from}"></div><div><label for="nkTo">Platí do</label><input id="nkTo" data-nk="to" type="date" value="${NK.to}"></div></div>
    <label class="check"><input type="checkbox" data-nk="newOnly" ${NK.newOnly ? 'checked' : ''}> Jen pro nové rodiny (při registraci)</label>`;
}
function nkPreview() {
  const c = { ...NK, value: Number(NK.value) || 0, months: Number(NK.months) || 1 };
  const g = CPN.GIVES[c.gives];
  const notesN = NK.notes.split('\n').map((x) => x.trim()).filter(Boolean).length;
  const n = NK.mode === 'unique' ? notesN || Number(NK.count) || 0 : 0;
  const example = NK.mode === 'shared' ? (NK.code || 'KOD').toUpperCase() : `${(NK.prefix || 'KOD').toUpperCase()}-7KQ4-M2PX`;
  $('#nkPrev').innerHTML = `<h2 style="font-size:15px">Náhled</h2>
    <p style="margin:10px 0"><span class="tag ${CPN.PURPOSE[c.purpose].tag}">${CPN.PURPOSE[c.purpose].label}</span></p>
    <p><b>Rodina dostane:</b> ${esc(CPN.describe(c))}.</p>
    <p class="hint" style="margin:6px 0 12px">Funguje: ${g.where}. ${g.how}</p>
    <dl class="kv"><dt>Kód</dt><dd class="mono">${esc(example)}</dd>${n ? `<dt>Počet kódů</dt><dd>${fmt(n)}</dd>` : ''}<dt>Odkaz</dt><dd class="mono" style="font-size:11px">${esc(shareLink(example))}</dd></dl>
    ${c.gives === 'trial' ? `<div class="notice" style="margin:12px 0 0"><img src="../brand/maskot-3d/web/ospalek-hlava.webp" alt=""><div>Zpráva pro příjemce:<br><i>${esc(shareMsg(c, example))}</i></div></div>` : ''}
    ${c.purpose === 'partner' ? `<p class="hint" style="margin-top:12px">Provize: ${NK.comm.kind === 'fixed' ? `${kc(Number(NK.comm.value) || 0)} za každou platící rodinu` : `${Number(NK.comm.value) || 0} % z plateb za 12 měsíců`}.</p>` : ''}`;
}
function nkSave() {
  const err = (m) => { $('#nkErr').textContent = m; };
  const value = Number(NK.value);
  if (!NK.name.trim()) return err('Doplň název.');
  if (!(value > 0) || (NK.gives === 'percent' && value > 90)) return err('Zadej platnou hodnotu (sleva nejvýš 90 %).');
  if (NK.purpose === 'partner' && !NK.partner) return err('Vyber partnera.');
  if (!NK.from || (NK.to && NK.to < NK.from)) return err('Zkontroluj platnost.');
  const notes = NK.notes.split('\n').map((x) => x.trim()).filter(Boolean);
  const c = { name: NK.name.trim(), purpose: NK.purpose, gives: NK.gives, value, newOnly: NK.newOnly, mode: NK.mode, from: parseIso(NK.from), to: NK.to ? addDays(parseIso(NK.to), 1) : null, limit: null };
  if (['percent', 'amount'].includes(NK.gives)) { c.dur = NK.dur; if (NK.dur === 'months') c.months = Number(NK.months) || 1; }
  if (NK.purpose === 'partner') { c.partner = NK.partner; c.comm = { kind: NK.comm.kind, value: Number(NK.comm.value) || 0 }; }
  if (NK.mode === 'shared') {
    const code = NK.code.trim().toUpperCase();
    if (!/^[A-Z0-9-]{4,20}$/.test(code)) return err('Kód má 4–20 znaků: písmena bez diakritiky, číslice, pomlčka.');
    if (CPN.codeTaken(code)) return err('Takový kód už existuje.');
    c.code = code; c.limit = Number(NK.limit) || null;
  } else {
    const prefix = NK.prefix.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,10}$/.test(prefix)) return err('Začátek kódu: 2–10 písmen bez diakritiky nebo číslic.');
    c.prefix = prefix; c.count = notes.length || Number(NK.count);
    if (!(c.count >= 1 && c.count <= 5000)) return err('Počet kódů 1 až 5 000.');
  }
  const t0 = performance.now();
  CPN.create(c, notes);
  closeModal(); go('kupony/' + c.id);
  toast(c.mode === 'unique' ? `Vygenerováno ${fmt(c.count)} kódů za ${dec(performance.now() - t0)} ms` : `Kód ${c.code} je založený`);
}

Object.assign(ACTIONS, {
  kupTab: (v) => { KUP.tab = v; render(); },
  cpnOpen: (v, t, ev) => { if (!ev.target.closest('a')) go('kupony/' + v); },
  cpnNew: (v, t) => openCouponWizard(v || 'znami', t.dataset.p),
  nkPurpose: (v) => {
    const pr = CPN.PRESETS[v];
    Object.assign(NK, { purpose: v, name: pr.name, gives: pr.gives, value: pr.value, dur: pr.dur || 'first', mode: pr.mode, prefix: pr.prefix || NK.prefix, count: pr.count || NK.count, newOnly: pr.newOnly, to: iso(addDays(parseIso(NK.from), pr.days)) });
    if (pr.comm) NK.comm = { ...pr.comm };
    nkForm(); nkPreview();
  },
  nkMode: (v) => { NK.mode = v; nkForm(); nkPreview(); },
  nkSave: () => nkSave(),
  cpnCopy: (v) => copy(v, 'Zkopírováno do schránky'),
  cpnPause: (v) => { CPN.togglePause(v); render(); toast('Hotovo'); },
  cpnCsv: (v) => {
    const c = CPN.get(v), rows = [['kod', 'pro_koho', 'pouzito_rodinou', 'odkaz']];
    (CPN.codes[v] || []).forEach((x) => rows.push([x.c, x.note, x.used || '', shareLink(x.c)]));
    download(`kody-${(c.prefix || c.code).toLowerCase()}.csv`, '﻿' + rows.map((r) => r.map((s) => `"${String(s).replace(/"/g, '""')}"`).join(';')).join('\n'), 'text/csv');
    API.log('coupon.export', c.prefix, `Export ${rows.length - 1} kódů`);
  },
  cpnMore: (v) => modal(`<div class="dialog narrow" role="dialog" aria-modal="true" aria-labelledby="mkT">
    <div class="dialog-head"><h2 id="mkT">Další kódy</h2><button class="x" data-a="close" aria-label="Zavřít">×</button></div>
    <div class="dialog-body"><label for="mkN">Kolik</label><input id="mkN" type="number" min="1" max="5000" value="10"><label for="mkNotes">Pro koho (nepovinné, jeden řádek = jeden kód)</label><textarea id="mkNotes" rows="4" style="font-family:var(--body);font-size:13px"></textarea></div>
    <div class="dialog-foot"><div class="r"><button class="btn white" data-a="close">Zrušit</button><button class="btn" data-a="cpnMoreSave" data-v="${v}">Vygenerovat</button></div></div></div>`),
  cpnMoreSave: (v) => {
    const notes = $('#mkNotes').value.split('\n').map((x) => x.trim()).filter(Boolean);
    const n = notes.length || Math.max(1, Math.min(5000, Number($('#mkN').value) || 0));
    CPN.addCodes(v, n, notes); closeModal(); render(); toast(`Přidáno ${fmt(n)} kódů`);
  },
  cpnCheck: () => {
    modal(`<div class="dialog narrow" role="dialog" aria-modal="true" aria-labelledby="ckT">
      <div class="dialog-head"><h2 id="ckT">Ověřit kód</h2><button class="x" data-a="close" aria-label="Zavřít">×</button></div>
      <div class="dialog-body"><p class="hint">Hodí se v helpdesku, když rodina píše, že jí kód nefunguje.</p><label for="ckQ">Kód</label><input id="ckQ" data-f="ckQ" autocomplete="off" style="text-transform:uppercase" placeholder="např. VECERNI nebo ZNAMI-…"><div id="ckRes" style="margin-top:12px"></div></div></div>`);
    $('#ckQ').focus();
  },
  partnerNew: () => modal(`<div class="dialog narrow" role="dialog" aria-modal="true" aria-labelledby="pnT">
    <div class="dialog-head"><h2 id="pnT">Nový partner</h2><button class="x" data-a="close" aria-label="Zavřít">×</button></div>
    <div class="dialog-body"><label for="pnName">Jméno nebo značka</label><input id="pnName"><div class="fields2"><div><label for="pnHandle">Účet</label><input id="pnHandle" placeholder="@ucet"></div><div><label for="pnCh">Kanál</label><select id="pnCh"><option>Instagram</option><option>TikTok</option><option>YouTube</option><option>Podcast</option><option>Blog</option><option>Jiný</option></select></div></div><label for="pnMail">E-mail pro vyúčtování</label><input id="pnMail" type="email"><p class="err" id="pnErr"></p></div>
    <div class="dialog-foot"><div class="r"><button class="btn white" data-a="close">Zrušit</button><button class="btn" data-a="partnerSave">Přidat a vytvořit kód</button></div></div></div>`),
  partnerSave: () => {
    const name = $('#pnName').value.trim();
    if (!name) { $('#pnErr').textContent = 'Doplň jméno.'; return; }
    const p = CPN.addPartner({ name, handle: $('#pnHandle').value.trim(), channel: $('#pnCh').value, email: $('#pnMail').value.trim() });
    closeModal(); openCouponWizard('partner', p.id);
    NK.code = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12); nkForm(); nkPreview();
  },
  partnerPaid: (v) => {
    const s = partnerStats(CPN.partner(v));
    confirmBox('Označit provizi jako vyplacenou?', `${kc(s.owed)} pro ${esc(CPN.partner(v).name)}. V ukázce se nic neplatí, jen se to zapíše do audit logu.`, 'Vyplaceno', () => { CPN.markPaid(v, s.owed); render(); toast('Zapsáno'); });
  },
});
document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.dataset.nk && NK) {
    const k = t.dataset.nk;
    if (k === 'newOnly') NK.newOnly = t.checked;
    else if (k === 'commKind') NK.comm.kind = t.value;
    else if (k === 'commValue') NK.comm.value = t.value;
    else NK[k] = t.value;
    if (['gives', 'dur', 'partner'].includes(k)) {
      if (k === 'gives') NK.value = { trial: 30, months: 1, percent: 20, amount: 100 }[NK.gives];
      if (k === 'partner' && NK.partner) NK.name = 'Influencer: ' + CPN.partner(NK.partner).name.replace(/ \(ukázka\)$/, '');
      nkForm();
    }
    if (k === 'notes') { const c = $('#nkCount'); const n = NK.notes.split('\n').filter((x) => x.trim()).length; if (c) { c.disabled = !!n; if (n) c.value = n; } }
    $('#nkErr').textContent = '';
    nkPreview();
  }
  if (t.dataset.f === 'ckQ') {
    const r = t.value.trim() ? CPN.find(t.value) : null, el = $('#ckRes');
    if (!t.value.trim()) { el.innerHTML = ''; return; }
    if (!r) { el.innerHTML = '<p class="status-bad">Takový kód neexistuje.</p><p class="hint">Zkontroluj záměnu 0/O a 1/I, v kódech se nepoužívají.</p>'; return; }
    const stt = CPN.status(r.c);
    const ok = stt === 'active' && !r.used;
    el.innerHTML = `<p class="${ok ? 'status-ok' : 'status-bad'}">${ok ? 'Kód je platný.' : r.used ? 'Kód už byl použitý.' : `Kód teď nejde uplatnit: ${CPN.STATUS[stt][0].toLowerCase()}.`}</p>
      <dl class="kv" style="margin-top:8px"><dt>Kampaň</dt><dd><a class="link" href="#kupony/${r.c.id}">${esc(r.c.name)}</a></dd><dt>Dává</dt><dd>${esc(CPN.describe(r.c))}</dd><dt>Platnost</dt><dd>${fdate(r.c.from)} – ${r.c.to ? fdate(r.c.to) : 'bez konce'}</dd>${r.note ? `<dt>Pro koho</dt><dd>${esc(r.note)}</dd>` : ''}${r.used ? `<dt>Použila</dt><dd>${famLink(API.families.get(r.used))}</dd>` : ''}</dl>`;
  }
});
document.addEventListener('click', (ev) => { if (ev.target.closest('#ckRes a')) closeModal(); });
