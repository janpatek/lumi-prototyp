// Ospalek – administrace. Prototyp bez backendu:
//  – uživatelé, registrace a návštěvy jsou ukázková data z demo-data.js (jasně označená),
//  – pohádky jsou skutečné: načtou se ze ../stories.cs.js, úpravy se drží v localStorage
//    tohoto prohlížeče a dají se vyexportovat jako nový stories.cs.js.
// Žádné klíče ani osobní údaje – složka leží na veřejných GitHub Pages.

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Math.round(n).toLocaleString('cs-CZ');
const pct = (a, b) => (b ? (a / b * 100).toLocaleString('cs-CZ', { maximumFractionDigits: 1 }) + ' %' : '–');
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fdate = (d) => d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' });
const fshort = (d) => `${d.getDate()}. ${d.getMonth() + 1}.`;
const fday = (d) => d.toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric' });
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* bez úložiště jen nepřežije obnovení */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};

const I = {
  home: '<svg class="ico" viewBox="0 0 24 24"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/></svg>',
  users: '<svg class="ico" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.6"/><path d="M16.5 14.6c2.6.2 4.4 1.9 5 5.4"/></svg>',
  reg: '<svg class="ico" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4M12 13v5M9.5 15.5h5"/></svg>',
  eye: '<svg class="ico" viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  book: '<svg class="ico" viewBox="0 0 24 24"><path d="M4 5c3-1.5 5.5-1.5 8 0 2.5-1.5 5-1.5 8 0v14c-3-1.5-5.5-1.5-8 0-2.5-1.5-5-1.5-8 0z"/><path d="M12 5v14"/></svg>',
  moon: '<svg class="ico" viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg>',
  sun: '<svg class="ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  plus: '<svg class="ico" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  down: '<svg class="ico" viewBox="0 0 24 24"><path d="M12 4v12M6 11l6 6 6-6M4 20h16"/></svg>',
  copy: '<svg class="ico" viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  wand: '<svg class="ico" viewBox="0 0 24 24"><path d="M4 20L15 9M13 7l4 4"/><path d="M18 2v3M16.5 3.5h3M20 9v2M19 10h2M10 2v2M9 3h2"/></svg>',
  sort: '<svg class="ico" viewBox="0 0 24 24" style="width:12px;height:12px;stroke-dasharray:none"><path d="M8 10l4-4 4 4M8 14l4 4 4-4"/></svg>',
};

const ROUTES = [
  { id: 'prehled', label: 'Přehled', ico: I.home },
  { id: 'uzivatele', label: 'Uživatelé', ico: I.users },
  { id: 'registrace', label: 'Registrace', ico: I.reg },
  { id: 'navstevy', label: 'Návštěvy', ico: I.eye },
  { id: 'pohadky', label: 'Pohádky', ico: I.book },
];
const route = () => { const r = location.hash.slice(1); return ROUTES.some((x) => x.id === r) ? r : 'prehled'; };

// ---------- Data ----------
const D = window.DEMO;
const TODAY = new Date(); TODAY.setHours(0, 0, 0, 0);
const FIRST = D.visits[0].date;
const VIS = new Map(D.visits.map((v) => [iso(v.date), v]));
const REG = new Map();
D.families.forEach((f) => { const k = iso(f.created); REG.set(k, (REG.get(k) || 0) + 1); });

// Skutečná rodina z aplikace v tomhle prohlížeči (stejný původ jako aplikace), jen pro zobrazení
const LOCAL = (() => {
  const s = store.get('lumi.v1');
  if (!s || !s.user) return null;
  return {
    id: 'local', local: true,
    email: s.user.provider === 'guest' ? null : s.user.email,
    kids: (s.family?.children || []).length,
    town: s.family?.home?.town || '–', country: '',
    premium: s.premium ? 'demo' : null,
    plays: null, created: null, lastSeen: null, source: 'Tento prohlížeč',
  };
})();

const F = {
  users: { q: '', acct: 'all', prem: 'all', country: 'all', sort: 'created', dir: -1, page: 0 },
  range: { preset: 30, from: iso(addDays(TODAY, -29)), to: iso(TODAY), by: 'den' },
  regPage: 0,
  stories: { q: '', cat: 'all', access: 'all' },
};

function setPreset(days) {
  F.range.preset = days;
  F.range.to = iso(TODAY);
  F.range.from = iso(days >= D.days ? FIRST : addDays(TODAY, -(days - 1)));
  F.range.by = days > 60 ? 'tyden' : 'den';
}

// Dny v rozsahu, po dnech nebo po týdnech (od pondělí)
function buckets(fromIso, toIso, by) {
  let d = parseIso(fromIso); const end = parseIso(toIso);
  if (d > end) return [];
  const out = [];
  while (d <= end) {
    const k = iso(d), v = VIS.get(k) || { landing: 0, app: 0 };
    const row = { start: new Date(d), end: new Date(d), landing: v.landing, app: v.app, reg: REG.get(k) || 0 };
    const last = out[out.length - 1];
    if (by === 'tyden' && last && d.getDay() !== 1) {
      last.end = row.end; last.landing += row.landing; last.app += row.app; last.reg += row.reg;
    } else out.push(row);
    d = addDays(d, 1);
  }
  return out;
}
const bLabel = (b) => fshort(b.start);
const bTitle = (b, by) => (by === 'tyden' ? `Týden ${fshort(b.start)}–${fshort(b.end)}` : fday(b.start));
const inRange = (d) => d >= parseIso(F.range.from) && d < addDays(parseIso(F.range.to), 1);
const sum = (a, k) => a.reduce((s, x) => s + x[k], 0);

// ---------- Grafy (ruční SVG, barvy ověřené validátorem) ----------
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= v);
}
const roundTop = (x, y, w, h, r) => {
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
};

function chart(el, { type, labels, titles, series }) {
  const W = Math.max(260, el.clientWidth), small = W < 520, H = small ? 190 : 230;
  const pad = { l: 40, r: type === 'line' && !small ? 82 : 10, t: 12, b: 26 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b, n = labels.length;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const y = (v) => pad.t + ih - (v / max) * ih;
  const bw = iw / Math.max(n, 1);
  const x = type === 'bar' ? (i) => pad.l + i * bw + bw / 2 : (i) => pad.l + (n < 2 ? iw / 2 : (i * iw) / (n - 1));
  let s = '<g class="grid">';
  [0, 0.25, 0.5, 0.75, 1].forEach((f) => {
    const yy = y(f * max);
    s += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${yy}" y2="${yy}"/><text x="${pad.l - 8}" y="${yy + 4}" text-anchor="end">${fmt(f * max)}</text>`;
  });
  s += '</g>';
  const step = Math.ceil(n / (small ? 4 : 7));
  labels.forEach((l, i) => { if (i % step === 0) s += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(l)}</text>`; });
  s += `<line class="axis" x1="${pad.l}" x2="${W - pad.r}" y1="${pad.t + ih}" y2="${pad.t + ih}"/>`;
  if (type === 'bar') {
    const sr = series[0], w = Math.max(1, bw - 2);
    s += `<g class="marks">${sr.values.map((v, i) => (v ? `<path d="${roundTop(pad.l + i * bw + 1, y(v), w, pad.t + ih - y(v), 4)}" fill="${sr.color}"/>` : '<path/>')).join('')}</g>`;
  } else {
    s += '<line class="cross" stroke="var(--line)" stroke-width="1.5" opacity="0"/>';
    const ends = [];
    series.forEach((sr) => {
      s += `<path d="${sr.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')}" fill="none" stroke="${sr.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      ends.push({ name: sr.name, color: sr.color, y: y(sr.values[n - 1] || 0) });
    });
    if (!small) {
      ends.sort((a, b) => a.y - b.y);
      for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 15) ends[i].y = ends[i - 1].y + 15;
      ends.forEach((e) => { s += `<circle cx="${x(n - 1)}" cy="${e.y}" r="0"/><text class="lab" x="${W - pad.r + 10}" y="${e.y + 4}">${esc(e.name)}</text>`; });
    }
    series.forEach((sr, k) => { s += `<circle class="dot" data-k="${k}" r="5" fill="${sr.color}" stroke="var(--surface-raised)" stroke-width="2" opacity="0"/>`; });
  }
  s += `<rect class="hit" x="${pad.l}" y="${pad.t}" width="${iw}" height="${ih}" fill="transparent"/>`;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map((x) => x.name).join(', '))}">${s}</svg><div class="tip"></div>`;

  const svg = $('svg', el), tip = $('.tip', el), hit = $('.hit', el);
  const show = (ev) => {
    const r = svg.getBoundingClientRect(), px = ((ev.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(n - 1, type === 'bar' ? Math.floor((px - pad.l) / bw) : Math.round(((px - pad.l) / iw) * (n - 1))));
    const top = Math.min(...series.map((sr) => y(sr.values[i])));
    if (type === 'bar') {
      el.querySelectorAll('.marks path').forEach((p, j) => p.setAttribute('opacity', j === i ? 1 : 0.45));
    } else {
      const c = $('.cross', el);
      c.setAttribute('x1', x(i)); c.setAttribute('x2', x(i)); c.setAttribute('y1', pad.t); c.setAttribute('y2', pad.t + ih); c.setAttribute('opacity', 1);
      el.querySelectorAll('.dot').forEach((d) => { const v = series[d.dataset.k].values[i]; d.setAttribute('cx', x(i)); d.setAttribute('cy', y(v)); d.setAttribute('opacity', 1); });
    }
    tip.innerHTML = `<b>${esc(titles[i])}</b>${series.map((sr) => `<div class="row"><span><i class="key" style="--c:${sr.color}"></i>${esc(sr.name)}</span><strong class="num">${fmt(sr.values[i])}</strong></div>`).join('')}`;
    const sc = r.width / W;
    tip.style.left = Math.max(70, Math.min(r.width - 70, x(i) * sc)) + 'px';
    tip.style.top = top * sc + 'px';
    tip.classList.add('on');
  };
  const hide = () => {
    tip.classList.remove('on');
    el.querySelectorAll('.marks path').forEach((p) => p.setAttribute('opacity', 1));
    el.querySelectorAll('.dot, .cross').forEach((d) => d.setAttribute('opacity', 0));
  };
  hit.addEventListener('pointermove', show);
  hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointerleave', hide);
}

let after = [];
const regChart = (id, bs, by) => after.push(() => chart(document.getElementById(id), {
  type: 'bar', labels: bs.map((b) => bLabel(b, by)), titles: bs.map((b) => bTitle(b, by)),
  series: [{ name: 'Registrace', color: 'var(--s1)', values: bs.map((b) => b.reg) }],
}));
const visChart = (id, bs, by) => after.push(() => chart(document.getElementById(id), {
  type: 'line', labels: bs.map((b) => bLabel(b, by)), titles: bs.map((b) => bTitle(b, by)),
  series: [
    { name: 'Landing page', color: 'var(--s1)', values: bs.map((b) => b.landing) },
    { name: 'Aplikace', color: 'var(--s2)', values: bs.map((b) => b.app) },
  ],
}));
const legend = () => '<div class="legend"><span><i class="key" style="--c:var(--s1)"></i>Landing page</span><span><i class="key" style="--c:var(--s2)"></i>Aplikace</span></div>';

// ---------- Společné kousky ----------
const demoBar = (extra = '') => `<div class="demo"><b>Ukázková data</b><span>Čísla jsou vymyšlená, aplikace zatím nemá backend ani měření návštěv. ${extra}</span></div>`;
const head = (title, sub, actions = '') => `<div class="head"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div><div class="head-actions">${actions}</div></div>`;
const tile = (k, v, d = '') => `<div class="panel tile"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${d}</div></div>`;
const delta = (a, b) => {
  if (!b) return '';
  const p = Math.round(((a - b) / b) * 100);
  return `${p >= 0 ? '+' : '−'}${Math.abs(p)} % proti předchozím 30 dnům`;
};
const planTag = (p) => (p === 'rok' ? '<span class="tag mint">Roční</span>' : p === 'měsíc' ? '<span class="tag sky">Měsíční</span>' : p === 'demo' ? '<span class="tag mint">Demo</span>' : '<span class="muted">ne</span>');
const acct = (f) => (f.email ? esc(f.email) : '<span class="tag line">Host</span>');
const rangeFilters = () => `
  <div class="filters">
    <div class="seg">${[[7, '7 dní'], [30, '30 dní'], [90, '90 dní'], [D.days, 'Vše']].map(([d, l]) => `<button data-a="preset" data-v="${d}" class="${F.range.preset === d ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="dates"><input type="date" data-f="from" aria-label="Od" value="${F.range.from}" min="${iso(FIRST)}" max="${iso(TODAY)}"><span class="muted">–</span><input type="date" data-f="to" aria-label="Do" value="${F.range.to}" min="${iso(FIRST)}" max="${iso(TODAY)}"></div>
    <div class="seg">${[['den', 'Po dnech'], ['tyden', 'Po týdnech']].map(([v, l]) => `<button data-a="by" data-v="${v}" class="${F.range.by === v ? 'on' : ''}">${l}</button>`).join('')}</div>
  </div>`;

// ---------- Přehled ----------
function pageOverview() {
  const last30 = buckets(iso(addDays(TODAY, -29)), iso(TODAY), 'den');
  const prev30 = buckets(iso(addDays(TODAY, -59)), iso(addDays(TODAY, -30)), 'den');
  const subs = D.families.filter((f) => f.premium).length;
  const accts = D.families.filter((f) => f.email).length;
  const r90 = buckets(iso(addDays(TODAY, -89)), iso(TODAY), 'tyden');
  regChart('chReg', r90, 'tyden');
  visChart('chVis', r90, 'tyden');
  const src = D.sources.map((s) => [s, D.families.filter((f) => f.source === s).length]).sort((a, b) => b[1] - a[1]);
  const smax = src[0][1];
  return `
    ${head('Přehled', `Stav k ${fdate(TODAY)}`)}
    ${demoBar()}
    <div class="tiles">
      ${tile('Rodiny celkem', fmt(D.families.length), `${fmt(accts)} s e-mailem, ${fmt(D.families.length - accts)} hostů`)}
      ${tile('Předplatné', fmt(subs), `${pct(subs, accts)} účtů s e-mailem`)}
      ${tile('Registrace za 30 dní', fmt(sum(last30, 'reg')), delta(sum(last30, 'reg'), sum(prev30, 'reg')))}
      ${tile('Návštěvy za 30 dní', fmt(sum(last30, 'landing') + sum(last30, 'app')), delta(sum(last30, 'landing') + sum(last30, 'app'), sum(prev30, 'landing') + sum(prev30, 'app')))}
    </div>
    <div class="grid2" style="margin-top:16px">
      <section class="panel"><div class="panel-head"><h2>Registrace po týdnech</h2><a class="btn white sm" href="#registrace">Detail</a></div><div class="chart" id="chReg"></div></section>
      <section class="panel"><div class="panel-head"><h2>Návštěvy po týdnech</h2>${legend()}</div><div class="chart" id="chVis"></div></section>
    </div>
    <div class="grid2" style="margin-top:16px">
      <section class="panel"><div class="panel-head"><h2>Nejnovější rodiny</h2><a class="btn white sm" href="#uzivatele">Všechny</a></div>
        <div class="table-wrap"><table><thead><tr><th>Účet</th><th>Registrace</th><th class="r">Děti</th><th>Předplatné</th></tr></thead>
        <tbody>${D.families.slice(0, 6).map((f) => `<tr><td>${acct(f)}</td><td class="num">${fdate(f.created)}</td><td class="r num">${f.kids}</td><td>${planTag(f.premium)}</td></tr>`).join('')}</tbody></table></div>
      </section>
      <section class="panel"><div class="panel-head"><h2>Odkud rodiny přišly</h2></div>
        <div class="bars">${src.map(([s, c]) => `<div class="b"><span>${s}</span><span class="t"><i style="width:${(c / smax) * 100}%"></i></span><span class="r num">${fmt(c)}</span></div>`).join('')}</div>
      </section>
    </div>`;
}

// ---------- Uživatelé ----------
function filteredUsers() {
  const u = F.users, q = u.q.trim().toLowerCase();
  const list = D.families.filter((f) =>
    (!q || (f.email || 'host').includes(q) || f.town.toLowerCase().includes(q))
    && (u.acct === 'all' || (u.acct === 'email' ? f.email : !f.email))
    && (u.prem === 'all' || (u.prem === 'yes' ? f.premium : !f.premium))
    && (u.country === 'all' || f.country === u.country));
  const key = { created: (f) => f.created, kids: (f) => f.kids, plays: (f) => f.plays, last: (f) => f.lastSeen, email: (f) => f.email || '~' }[u.sort];
  return list.sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * u.dir);
}
function usersTable() {
  const list = filteredUsers(), per = 25, pages = Math.max(1, Math.ceil(list.length / per));
  F.users.page = Math.min(F.users.page, pages - 1);
  const rows = list.slice(F.users.page * per, (F.users.page + 1) * per);
  const th = (k, l, cls = '') => `<th class="${cls}"><button data-a="sort" data-v="${k}">${l}${I.sort}</button></th>`;
  const local = LOCAL && F.users.page === 0 ? `<tr class="mine"><td>${LOCAL.email ? esc(LOCAL.email) : '<span class="tag line">Host</span>'} <span class="tag">Tento prohlížeč</span></td><td class="muted">–</td><td class="r num">${LOCAL.kids}</td><td>${esc(LOCAL.town)}</td><td>${planTag(LOCAL.premium)}</td><td class="r muted">–</td><td class="muted">–</td><td class="muted">skutečná data</td></tr>` : '';
  return `
    <div class="table-wrap"><table>
      <thead><tr>${th('email', 'Účet')}${th('created', 'Registrace')}${th('kids', 'Děti', 'r')}<th>Bydliště</th><th>Předplatné</th>${th('plays', 'Pohádek', 'r')}${th('last', 'Naposledy')}<th>Zdroj</th></tr></thead>
      <tbody>${local}${rows.map((f) => `<tr><td>${acct(f)}</td><td class="num">${fdate(f.created)}</td><td class="r num">${f.kids}</td><td>${esc(f.town)} <span class="muted">${f.country}</span></td><td>${planTag(f.premium)}</td><td class="r num">${fmt(f.plays)}</td><td class="num">${fdate(f.lastSeen)}</td><td class="muted">${esc(f.source)}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">Nic nenalezeno.</td></tr>'}</tbody>
    </table></div>
    <div class="pager"><span>${fmt(list.length)} rodin · strana ${F.users.page + 1} z ${pages}</span>
      <span class="head-actions"><button class="btn white sm" data-a="upage" data-v="-1" ${F.users.page ? '' : 'disabled'}>Předchozí</button><button class="btn white sm" data-a="upage" data-v="1" ${F.users.page < pages - 1 ? '' : 'disabled'}>Další</button></span></div>`;
}
function pageUsers() {
  const u = F.users;
  const opt = (k, v, l) => `<option value="${v}" ${u[k] === v ? 'selected' : ''}>${l}</option>`;
  const fam = D.families, subs = fam.filter((f) => f.premium);
  return `
    ${head('Uživatelé', 'Rodiny a jejich účty', `<button class="btn white" data-a="csv">${I.down}Export CSV</button>`)}
    ${demoBar(LOCAL ? 'Jen první řádek je skutečný – rodina uložená v aplikaci v tomhle prohlížeči.' : '')}
    <div class="tiles">
      ${tile('Rodiny', fmt(fam.length))}
      ${tile('Dětí celkem', fmt(sum(fam, 'kids')), `${(sum(fam, 'kids') / fam.length).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} na rodinu`)}
      ${tile('Předplatitelé', fmt(subs.length), `${fmt(subs.filter((f) => f.premium === 'rok').length)} ročních · ${fmt(subs.filter((f) => f.premium === 'měsíc').length)} měsíčních`)}
      ${tile('Pohádek puštěno', fmt(sum(fam, 'plays')), `${(sum(fam, 'plays') / fam.length).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} na rodinu`)}
    </div>
    <section class="panel" style="margin-top:16px">
      <div class="filters">
        <input type="search" data-f="uq" placeholder="Hledat e-mail nebo město" value="${esc(u.q)}">
        <select data-f="acct" aria-label="Účet">${opt('acct', 'all', 'Všechny účty')}${opt('acct', 'email', 'S e-mailem')}${opt('acct', 'host', 'Hosté')}</select>
        <select data-f="prem" aria-label="Předplatné">${opt('prem', 'all', 'Předplatné: vše')}${opt('prem', 'yes', 'S předplatným')}${opt('prem', 'no', 'Bez předplatného')}</select>
        <select data-f="country" aria-label="Země">${opt('country', 'all', 'ČR i SR')}${opt('country', 'CZ', 'Česko')}${opt('country', 'SK', 'Slovensko')}</select>
      </div>
      <div id="usersTbl">${usersTable()}</div>
    </section>`;
}

// ---------- Registrace ----------
function pageRegistrations() {
  const bs = buckets(F.range.from, F.range.to, F.range.by);
  const list = D.families.filter((f) => inRange(f.created));
  const per = 20, pages = Math.max(1, Math.ceil(list.length / per));
  F.regPage = Math.min(F.regPage, pages - 1);
  const emails = list.filter((f) => f.email).length;
  const appVisits = sum(bs, 'app');
  regChart('chReg', bs, F.range.by);
  return `
    ${head('Kdo se registroval', 'Nové rodiny v čase')}
    ${demoBar()}
    ${rangeFilters()}
    <div class="tiles">
      ${tile('Registrace v období', fmt(list.length), `${fdate(parseIso(F.range.from))} – ${fdate(parseIso(F.range.to))}`)}
      ${tile('S e-mailem', fmt(emails), `${fmt(list.length - emails)} hostů`)}
      ${tile('Už platí', fmt(list.filter((f) => f.premium).length), pct(list.filter((f) => f.premium).length, emails) + ' z registrovaných')}
      ${tile('Z návštěv aplikace', pct(list.length, appVisits), `${fmt(appVisits)} návštěv aplikace`)}
    </div>
    <section class="panel" style="margin-top:16px"><div class="panel-head"><h2>Registrace ${F.range.by === 'tyden' ? 'po týdnech' : 'po dnech'}</h2></div><div class="chart" id="chReg"></div></section>
    <section class="panel">
      <div class="panel-head"><h2>Seznam registrací</h2><span class="muted">${fmt(list.length)} rodin</span></div>
      <div class="table-wrap"><table><thead><tr><th>Kdy</th><th>Účet</th><th class="r">Děti</th><th>Bydliště</th><th>Zdroj</th><th>Předplatné</th></tr></thead>
      <tbody>${list.slice(F.regPage * per, (F.regPage + 1) * per).map((f) => `<tr><td class="num">${fdate(f.created)} <span class="muted">${f.created.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}</span></td><td>${acct(f)}</td><td class="r num">${f.kids}</td><td>${esc(f.town)} <span class="muted">${f.country}</span></td><td class="muted">${esc(f.source)}</td><td>${planTag(f.premium)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">V tomhle období se nikdo neregistroval.</td></tr>'}</tbody></table></div>
      <div class="pager"><span>Strana ${F.regPage + 1} z ${pages}</span>
        <span class="head-actions"><button class="btn white sm" data-a="rpage" data-v="-1" ${F.regPage ? '' : 'disabled'}>Předchozí</button><button class="btn white sm" data-a="rpage" data-v="1" ${F.regPage < pages - 1 ? '' : 'disabled'}>Další</button></span></div>
    </section>`;
}

// ---------- Návštěvy ----------
function pageVisits() {
  const bs = buckets(F.range.from, F.range.to, F.range.by);
  const L = sum(bs, 'landing'), A = sum(bs, 'app'), R = sum(bs, 'reg');
  visChart('chVis', bs, F.range.by);
  return `
    ${head('Návštěvy webu', 'Landing page a aplikace v čase')}
    ${demoBar('Skutečná čísla dodá měření návštěv, např. Plausible (bez cookies, data v EU).')}
    ${rangeFilters()}
    <div class="tiles">
      ${tile('Landing page', fmt(L), `${fmt(L / Math.max(1, bs.length))} průměrně ${F.range.by === 'tyden' ? 'za týden' : 'za den'}`)}
      ${tile('Aplikace', fmt(A), `${fmt(A / Math.max(1, bs.length))} průměrně ${F.range.by === 'tyden' ? 'za týden' : 'za den'}`)}
      ${tile('Z landingu do aplikace', pct(A, L), 'podíl návštěv')}
      ${tile('Registrace', fmt(R), `${pct(R, A)} návštěv aplikace`)}
    </div>
    <section class="panel" style="margin-top:16px"><div class="panel-head"><h2>Návštěvy ${F.range.by === 'tyden' ? 'po týdnech' : 'po dnech'}</h2>${legend()}</div><div class="chart" id="chVis"></div></section>
    <section class="panel">
      <div class="panel-head"><h2>Tabulka</h2></div>
      <div class="table-wrap" style="max-height:360px;overflow-y:auto"><table><thead><tr><th>${F.range.by === 'tyden' ? 'Týden' : 'Den'}</th><th class="r">Landing page</th><th class="r">Aplikace</th><th class="r">Registrace</th></tr></thead>
      <tbody>${bs.slice().reverse().map((b) => `<tr><td>${esc(bTitle(b, F.range.by))}</td><td class="r num">${fmt(b.landing)}</td><td class="r num">${fmt(b.app)}</td><td class="r num">${fmt(b.reg)}</td></tr>`).join('')}</tbody></table></div>
    </section>`;
}

// ---------- Pohádky ----------
const MOODS = { lullaby: 'Ukolébavka (klidná hudba)', adventure: 'Dobrodružná', road: 'Na cesty (rytmická)' };
const CATS = window.CATEGORIES.filter((c) => c.id !== 'all');
const catLabel = (id) => CATS.find((c) => c.id === id)?.label || id;
const catIco = (id) => `<img class="cat-ico" src="../brand/ikony/kat-${esc(id)}.webp" alt="" onerror="this.remove()">`;
// stories.cs.js má vlastní cap a listCz jako globální const, proto jiná jména
const capT = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const listT = (a) => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' a ' + a[a.length - 1]);
const compile = (src) => new Function('cap', 'listCz', `"use strict"; return (${src}\n);`)(capT, listT);
const SK = 'ospalek.admin.stories.v1';

const fromStory = (s) => ({
  id: s.id, free: !!s.free, cats: [...s.cats], ages: [...s.ages], mood: s.mood || 'lullaby',
  cover: { img: s.cover.img || '', imgF: s.cover.imgF || '', emoji: s.cover.emoji || '', g1: s.cover.g1 || '#1d2b64', g2: s.cover.g2 || '#6a4c93' },
  titleSrc: s.title.toString(), textSrc: s.text.toString(),
});
const ORIG = window.STORIES.map(fromStory);
let STORIES = store.get(SK) || ORIG.map((s) => structuredClone(s));
let SRC = null; // text originálního stories.cs.js kvůli hlavičce a pomocným funkcím při exportu
fetch('../app/stories.cs.js', { cache: 'no-store' }).then((r) => (r.ok ? r.text() : null)).then((t) => { SRC = t; }).catch(() => {});
const saveStories = () => store.set(SK, STORIES);

const q = (v) => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
function serStory(s) {
  const cov = [`img: ${q(s.cover.img)}`, s.cover.imgF ? `imgF: ${q(s.cover.imgF)}` : '', `emoji: ${q(s.cover.emoji)}`, `g1: ${q(s.cover.g1)}`, `g2: ${q(s.cover.g2)}`].filter(Boolean).join(', ');
  return `  {\n    id: ${q(s.id)},\n    free: ${s.free},\n    cats: [${s.cats.map(q).join(', ')}],\n    ages: [${s.ages[0]}, ${s.ages[1]}],\n    mood: ${q(s.mood)},\n    cover: { ${cov} },\n    title: ${s.titleSrc},\n    text: ${s.textSrc},\n  },\n`;
}
function exportFile() {
  const marker = 'window.STORIES = [\n';
  const prefix = SRC && SRC.includes(marker) ? SRC.slice(0, SRC.indexOf(marker)) : `// Pohádky – česká verze (export z administrace)\n\nwindow.CATEGORIES = ${JSON.stringify(window.CATEGORIES, null, 2)};\n\nconst cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);\nconst listCz = (a) => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' a ' + a[a.length - 1]);\n\n`;
  return prefix + marker + STORIES.map(serStory).join('') + '];\n';
}
function changes() {
  const o = new Map(ORIG.map((s) => [s.id, serStory(s)]));
  const cur = new Set(STORIES.map((s) => s.id));
  const res = { added: 0, edited: 0, deleted: [...o.keys()].filter((id) => !cur.has(id)).length, ids: new Set() };
  STORIES.forEach((s) => {
    if (!o.has(s.id)) { res.added++; res.ids.add(s.id); } else if (o.get(s.id) !== serStory(s)) { res.edited++; res.ids.add(s.id); }
  });
  res.total = res.added + res.edited + res.deleted;
  return res;
}

// Ukázková rodina pro náhled šablon (stejný tvar kontextu jako ctx() v app.js)
const KIDS = {
  m: { gender: 'm', forms: { nom: 'Toník', gen: 'Toníka', dat: 'Toníkovi', acc: 'Toníka', voc: 'Toníku', ins: 'Toníkem' }, food: 'palačinky', animal: 'pejsek' },
  f: { gender: 'f', forms: { nom: 'Eliška', gen: 'Elišky', dat: 'Elišce', acc: 'Elišku', voc: 'Eliško', ins: 'Eliškou' }, food: 'jahody', animal: 'kočička' },
};
function sampleCtx(key) {
  const heroes = key === 'mf' ? [KIDS.m, KIDS.f] : [KIDS[key]];
  const one = heroes.length === 1, allF = heroes.every((k) => k.gender === 'f');
  const sibRaw = key === 'mf' ? null : KIDS[key === 'm' ? 'f' : 'm'];
  const h = {};
  ['nom', 'gen', 'dat', 'acc', 'voc', 'ins'].forEach((k) => { h[k] = listT(heroes.map((x) => x.forms[k])); });
  const parent = (g, forms, name) => ({ ...forms, full: `${forms.nom} ${name.nom}`, name, g: (m, f) => (g === 'f' ? f : m) });
  return {
    H: h.nom, h,
    g: (m, f, mpl = m, fpl) => (one ? (allF ? f : m) : allF ? fpl ?? mpl.replace(/li\b/g, 'ly') : mpl),
    n: (sg, pl) => (one ? sg : pl),
    sib: sibRaw ? sibRaw.forms : null,
    sg: (m, f) => (sibRaw && sibRaw.gender === 'f' ? f : m),
    p1: parent('f', { nom: 'maminka', gen: 'maminky', dat: 'mamince', acc: 'maminku', voc: 'maminko', ins: 'maminkou' }, { nom: 'Petra', gen: 'Petry', dat: 'Petře', acc: 'Petru', voc: 'Petro', ins: 'Petrou' }),
    p2: parent('m', { nom: 'tatínek', gen: 'tatínka', dat: 'tatínkovi', acc: 'tatínka', voc: 'tatínku', ins: 'tatínkem' }, { nom: 'Martin', gen: 'Martina', dat: 'Martinovi', acc: 'Martina', voc: 'Martine', ins: 'Martinem' }),
    town: 'Benešov', inTown: 'v Benešově',
    near: ['Vlašim', 'Týnec nad Sázavou', 'Bystřice'], attr: ['zámek Konopiště', 'rozhledna na Javorovém vrchu'],
    food: listT([...new Set(heroes.map((k) => k.food))]), animal: listT([...new Set(heroes.map((k) => k.animal))]),
  };
}
function render1(s, key) {
  const c = sampleCtx(key);
  const title = compile(s.titleSrc)(c);
  const segs = compile(s.textSrc)(c);
  if (typeof title !== 'string') throw new Error('Název musí vrátit text.');
  if (!Array.isArray(segs) || segs.some((p) => !p || typeof p.t !== 'string')) throw new Error('Text musí vrátit pole odstavců { t: `…` }.');
  return { title, segs };
}
const safeTitle = (s, key = 'm') => { try { return render1(s, key).title; } catch (e) { return s.id; } };
const minutes = (segs) => Math.max(1, Math.round(segs.reduce((a, p) => a + p.t.split(/\s+/).length / 2 + (p.pause || 0) + 1, 0) / 60));

const coverHtml = (s, which, label) => {
  const path = which === 'f' ? s.cover.imgF : s.cover.img;
  const blob = PREVIEWS[s.id + ':' + which];
  return `<div class="cv" style="--g1:${esc(s.cover.g1)};--g2:${esc(s.cover.g2)}">${esc(s.cover.emoji)}${blob || path ? `<img src="${esc(blob || path)}" alt="" loading="lazy" onerror="this.remove()">` : ''}${label ? `<span class="tag ${which === 'f' ? 'peach' : 'sky'}">${label}</span>` : ''}</div>`;
};
const PREVIEWS = {}; // vlastní obrázek vybraný pro vyzkoušení – jen v paměti, nikam se neukládá

function storyCard(s, changedIds) {
  const both = !!s.cover.imgF;
  return `<article class="panel story">
    ${changedIds.has(s.id) ? '<span class="tag honey changed">Upraveno</span>' : ''}
    <div class="covers ${both ? '' : 'one'}">${coverHtml(s, 'm', both ? 'Kluk' : '')}${both ? coverHtml(s, 'f', 'Holka') : ''}</div>
    <h3>${esc(safeTitle(s))}</h3>
    <div class="tags">
      ${s.cats.map((c) => `<span class="tag">${catIco(c)}${esc(catLabel(c))}</span>`).join('')}
      <span class="tag line">${s.ages[0]}–${s.ages[1]} let</span>
      ${s.free ? '<span class="tag honey">Zdarma</span>' : '<span class="tag line">Placená</span>'}
    </div>
    <div class="acts">
      <button class="btn sm" data-a="edit" data-v="${esc(s.id)}">Upravit</button>
      <button class="btn white sm" data-a="covers" data-v="${esc(s.id)}">${I.wand}Náhledy</button>
      <button class="btn danger sm" data-a="del" data-v="${esc(s.id)}">Smazat</button>
    </div>
  </article>`;
}
function pageStories() {
  const f = F.stories, ch = changes(), qq = f.q.trim().toLowerCase();
  const list = STORIES.filter((s) => (f.cat === 'all' || s.cats.includes(f.cat))
    && (f.access === 'all' || (f.access === 'free' ? s.free : !s.free))
    && (!qq || s.id.includes(qq) || safeTitle(s).toLowerCase().includes(qq)));
  const chip = (k, v, l, extra = '') => `<button class="chip ${f[k] === v ? 'on' : ''}" data-a="sfilter" data-k="${k}" data-v="${v}">${extra}${l}</button>`;
  return `
    ${head('Pohádky', `${STORIES.length} pohádek · ${STORIES.filter((s) => s.free).length} zdarma`, `<button class="btn" data-a="new">${I.plus}Nová pohádka</button>`)}
    <section class="panel" style="margin-bottom:16px">
      <div class="panel-head" style="margin:0">
        <div><h2>${ch.total ? `${ch.total} ${ch.total === 1 ? 'změna' : ch.total < 5 ? 'změny' : 'změn'} proti app/stories.cs.js` : 'Beze změn proti app/stories.cs.js'}</h2>
        <p class="muted" style="font-size:13px;margin-top:4px">${ch.total ? `${ch.added} nových · ${ch.edited} upravených · ${ch.deleted} smazaných. ` : ''}Úpravy se drží jen v tomhle prohlížeči. Do aplikace se dostanou, až stažený soubor nahradí app/stories.cs.js v repozitáři.</p></div>
        <div class="head-actions">
          <button class="btn white sm" data-a="copyExport">${I.copy}Zkopírovat</button>
          <button class="btn sm" data-a="download">${I.down}Stáhnout stories.cs.js</button>
          ${ch.total ? '<button class="btn danger sm" data-a="reset">Zahodit změny</button>' : ''}
        </div>
      </div>
    </section>
    <div class="filters">
      <input type="search" data-f="sq" placeholder="Hledat název nebo id" value="${esc(f.q)}">
      <div class="chips">${chip('cat', 'all', 'Všechny')}${CATS.map((c) => chip('cat', c.id, c.label, catIco(c.id))).join('')}</div>
      <div class="seg">${[['all', 'Vše'], ['free', 'Zdarma'], ['paid', 'Placené']].map(([v, l]) => `<button data-a="sfilter" data-k="access" data-v="${v}" class="${f.access === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    </div>
    <div class="stories">${list.map((s) => storyCard(s, ch.ids)).join('') || '<div class="empty"><img src="../brand/maskot-3d/web/ospalek-spi.webp" alt="">Žádná pohádka neodpovídá filtru.</div>'}</div>`;
}

// ---------- Editor pohádky ----------
const NEW_TEXT = `(c) => [
      { t: \`Bylo nebylo, \${c.inTown} \${c.g('bydlel', 'bydlela', 'bydleli')} \${c.H}.\` },
      { t: \`Jednoho večera \${c.g('uslyšel', 'uslyšela', 'uslyšeli')} \${c.H} za oknem tiché zaťukání.\`, sfx: 'sparkle' },
      { t: \`Dobrou noc, \${c.h.voc}.\` },
    ]`;
let ED = null; // { orig: id|null, s: koncept, view: 'm'|'f'|'mf' }

function openEditor(id) {
  const src = id ? STORIES.find((s) => s.id === id) : null;
  const s = src ? structuredClone(src) : {
    id: 'nova-pohadka', free: false, cats: ['noc'], ages: [3, 7], mood: 'lullaby',
    cover: { img: '../covers/nova-pohadka.jpg', imgF: '', emoji: '🌙', g1: '#1d2b64', g2: '#6a4c93' },
    titleSrc: '(c) => `${c.H} a tichý večer`', textSrc: NEW_TEXT,
  };
  ED = { orig: id || null, s, view: 'm' };
  modal(`
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="edT">
      <div class="dialog-head"><h2 id="edT">${id ? 'Upravit pohádku' : 'Nová pohádka'}</h2><button class="x" data-a="close" aria-label="Zavřít">×</button></div>
      <div class="dialog-body"><div class="edit">
        <div>
          <div class="fields2">
            <div><label for="eId">Id (název souboru obálky)</label><input id="eId" data-e="id" value="${esc(s.id)}" autocomplete="off"></div>
            <div><label for="eMood">Hudba v pozadí</label><select id="eMood" data-e="mood">${Object.entries(MOODS).map(([v, l]) => `<option value="${v}" ${s.mood === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          </div>
          <label>Kategorie</label>
          <div class="chips" id="eCats">${CATS.map((c) => `<button type="button" class="chip ${s.cats.includes(c.id) ? 'on' : ''}" data-a="ecat" data-v="${c.id}">${catIco(c.id)}${c.label}</button>`).join('')}</div>
          <div class="fields3">
            <div><label for="eA0">Věk od</label><input id="eA0" type="number" min="1" max="12" data-e="a0" value="${s.ages[0]}"></div>
            <div><label for="eA1">Věk do</label><input id="eA1" type="number" min="1" max="12" data-e="a1" value="${s.ages[1]}"></div>
            <div><label for="eEmoji">Emoji zálohy</label><input id="eEmoji" data-e="emoji" value="${esc(s.cover.emoji)}"></div>
          </div>
          <label class="check"><input type="checkbox" data-e="free" ${s.free ? 'checked' : ''}> Zdarma (jedna ze tří pohádek bez předplatného)</label>
          <div class="fields2">
            <div><label for="eG1">Barva zálohy 1</label><input id="eG1" type="color" data-e="g1" value="${esc(s.cover.g1)}"></div>
            <div><label for="eG2">Barva zálohy 2</label><input id="eG2" type="color" data-e="g2" value="${esc(s.cover.g2)}"></div>
          </div>
          <label for="eImg">Obálka</label><input id="eImg" data-e="img" value="${esc(s.cover.img)}">
          <label class="check"><input type="checkbox" data-e="hasF" ${s.cover.imgF ? 'checked' : ''}> Má i verzi s holčičkou (<span class="path" id="eImgF">${esc(repoPath(s.cover.imgF || fPath(s)))}</span>)</label>
          <label for="eTitle">Název (šablona)</label>
          <textarea id="eTitle" rows="2" data-e="titleSrc" spellcheck="false">${esc(s.titleSrc)}</textarea>
          <label for="eText">Text (šablona)</label>
          <textarea id="eText" rows="16" data-e="textSrc" spellcheck="false">${esc(s.textSrc)}</textarea>
          <details class="hint"><summary>Co se dá v šabloně použít</summary>
            <p>c.H hrdina (1. pád), c.h.gen / dat / acc / voc / ins další pády, c.g('kluk', 'holka', 'víc dětí') tvar podle rodu, c.n('jedno', 'víc') tvar podle čísla, c.sib sourozenec, c.p1 / c.p2 rodiče (.full, .nom, .dat…, .g()), c.inTown, c.near, c.attr, c.food, c.animal, cap() a listCz(). Odstavec: { t: \`text\`, sfx: 'sparkle' | 'magic' | 'car' | 'horn' | 'birds' | 'owl' | 'paper' | 'wind' | 'ding', pause: sekundy }.</p>
          </details>
        </div>
        <div><div class="preview" id="ePrev"></div></div>
      </div></div>
      <div class="dialog-foot"><div class="err" id="eErr"></div><div class="r"><button class="btn white" data-a="close">Zrušit</button><button class="btn" data-a="saveStory">Uložit</button></div></div>
    </div>`);
  renderPreview();
}
// cesty v pohádkách jsou relativní k app/, v repozitáři leží obálky v covers/
const repoPath = (p) => p.replace(/^\.\.\//, '');
const fPath = (s) => (s.cover.img || `../covers/${s.id}.jpg`).replace(/(\.[a-z]+)$/i, '-f$1');

function renderPreview() {
  const el = $('#ePrev'); if (!el) return;
  const s = ED.s;
  let body;
  try {
    const { title, segs } = render1(s, ED.view);
    body = `<h3>${esc(title)}</h3><p class="muted" style="font-size:13px;margin-bottom:10px">${segs.length} odstavců · asi ${minutes(segs)} min čtení</p>
      <div class="txt">${segs.map((p) => `<p>${esc(p.t)}${p.sfx ? ` <span class="sfx">♪ ${esc(p.sfx)}</span>` : ''}</p>`).join('')}</div>`;
  } catch (e) {
    body = `<p class="err">Šablona má chybu: ${esc(e.message)}</p>`;
  }
  el.innerHTML = `
    <div class="panel-head" style="margin-bottom:6px"><h2 style="font-size:15px">Náhled textu</h2>
      <div class="seg">${[['m', 'Toník'], ['f', 'Eliška'], ['mf', 'Oba']].map(([v, l]) => `<button data-a="eview" data-v="${v}" class="${ED.view === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div class="covers ${s.cover.imgF ? '' : 'one'}" style="max-width:${s.cover.imgF ? 240 : 200}px">${coverHtml(s, ED.view === 'f' && s.cover.imgF ? 'f' : 'm')}</div>
    ${body}
    <p class="hint" style="margin-top:10px">Ukázková rodina: maminka Petra, tatínek Martin, Benešov.</p>`;
}

function editInput(t) {
  const s = ED.s, k = t.dataset.e;
  if (k === 'a0' || k === 'a1') s.ages[k === 'a0' ? 0 : 1] = Number(t.value);
  else if (k === 'free') s.free = t.checked;
  else if (k === 'hasF') s.cover.imgF = t.checked ? fPath(s) : '';
  else if (['emoji', 'g1', 'g2', 'img'].includes(k)) s.cover[k] = t.value.trim();
  else if (k === 'id') {
    const old = s.id; s.id = t.value.trim();
    // obálka jde s id, dokud ji nikdo nepřejmenoval ručně
    if (s.cover.img === `../covers/${old}.jpg`) { s.cover.img = `../covers/${s.id}.jpg`; $('#eImg').value = s.cover.img; }
  } else s[k] = t.value;
  if (s.cover.imgF && ['id', 'img'].includes(k)) s.cover.imgF = fPath(s);
  const f = $('#eImgF'); if (f) f.textContent = repoPath(s.cover.imgF || fPath(s));
  $('#eErr').textContent = '';
  if (['titleSrc', 'textSrc', 'img', 'hasF', 'emoji', 'g1', 'g2'].includes(k)) renderPreview();
}

function saveStory() {
  const s = ED.s, err = (m) => { $('#eErr').textContent = m; };
  if (!/^[a-z0-9-]+$/.test(s.id)) return err('Id smí obsahovat jen malá písmena bez diakritiky, číslice a pomlčky.');
  if (STORIES.some((x) => x.id === s.id && x.id !== ED.orig)) return err('Pohádka s tímhle id už existuje.');
  if (!s.cats.length) return err('Vyber aspoň jednu kategorii.');
  if (!(s.ages[0] >= 1 && s.ages[1] >= s.ages[0])) return err('Věk od musí být menší nebo stejný jako věk do.');
  if (!s.cover.img) return err('Doplň cestu k obálce.');
  for (const k of ['m', 'f', 'mf']) {
    try { render1(s, k); } catch (e) { return err(`Šablona nefunguje (${k === 'mf' ? 'dva hrdinové' : k === 'f' ? 'holka' : 'kluk'}): ${e.message}`); }
  }
  s.titleSrc = s.titleSrc.trim(); s.textSrc = s.textSrc.trim();
  if (ED.orig) STORIES[STORIES.findIndex((x) => x.id === ED.orig)] = s; else STORIES.push(s);
  saveStories(); closeModal(); render(); toast(ED.orig ? 'Pohádka je upravená' : 'Pohádka je přidaná');
}

// ---------- Nové náhledy (obálky) ----------
const MOOD_EN = {
  lullaby: 'calm bedtime mood, deep night blues and violets, moonlight, tiny glowing lights',
  adventure: 'warm adventurous daylight mood, fresh greens and golden light',
  road: 'cheerful road-trip mood, warm sunny colours, open landscape',
};
function coverPrompt(s, which) {
  const { title, segs } = render1(s, which);
  let gist = segs.slice(0, 4).map((p) => p.t).join(' ');
  if (gist.length > 480) gist = gist.slice(0, gist.lastIndexOf(' ', 480)) + '…';
  const age = Math.round((s.ages[0] + s.ages[1]) / 2);
  const hero = which === 'f' ? 'a little girl (Czech, about ' + age + ' years old)' : 'a little boy (Czech, about ' + age + ' years old)';
  return [
    'Children\'s picture-book illustration in watercolour and gouache on textured paper, soft painterly edges, delicate details, gentle glowing light, ' + (MOOD_EN[s.mood] || MOOD_EN.lullaby) + '.',
    `Main character: ${hero}, friendly and expressive, shown inside the scene, not a close-up portrait. Keep the same art style as the other Ospalek covers.`,
    `Story (Czech) – title: "${title}". Opening: ${gist}`,
    'Show one clear, cosy key moment of this story. Vertical 3:4 composition (573×768 px). No text, no letters, no logos, no frame.',
  ].join('\n\n');
}
function openCovers(id) {
  const s = STORIES.find((x) => x.id === id);
  const vars = [['m', 'Verze pro kluka', s.cover.img], ['f', 'Verze pro holku', s.cover.imgF || fPath(s)]];
  let prompts;
  try { prompts = { m: coverPrompt(s, 'm'), f: coverPrompt(s, 'f') }; } catch (e) { toast('Šablona pohádky má chybu, oprav ji v úpravách.'); return; }
  modal(`
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="cvT">
      <div class="dialog-head"><h2 id="cvT">Nové náhledy: ${esc(safeTitle(s))}</h2><button class="x" data-a="close" aria-label="Zavřít">×</button></div>
      <div class="dialog-body">
        <div class="notice"><img src="../brand/maskot-3d/web/ospalek-hlava.webp" alt=""><div>
          <b>Zadání pro generátor obrázků.</b> Prompt vzniká z názvu, děje a nálady pohádky ve stylu ostatních obálek (akvarel a kvaš). Samotné generování je zatím vypnuté, protože každý obrázek stojí peníze. Zkopíruj prompt do generátoru, nebo stáhni zadání a pošli ho Claudovi. Hotový obrázek ulož do uvedené cesty jako JPG 573×768 px.</div></div>
        <div class="gen">${vars.map(([w, l, path]) => `
          <section class="panel">
            <div class="panel-head" style="margin-bottom:8px"><h2>${l}</h2><span class="path">${esc(repoPath(path))}</span></div>
            <div class="covers one" style="max-width:150px">${s.cover.imgF || w === 'm' ? coverHtml(s, w) : `<div class="cv" style="--g1:${esc(s.cover.g1)};--g2:${esc(s.cover.g2)}">${esc(s.cover.emoji)}<span class="tag peach">Zatím chybí</span></div>`}</div>
            <label for="p${w}">Prompt</label>
            <textarea id="p${w}" data-prompt="${w}" spellcheck="false">${esc(prompts[w])}</textarea>
            <div class="head-actions" style="margin-top:10px">
              <button class="btn sm" data-a="copyPrompt" data-v="${w}">${I.copy}Zkopírovat prompt</button>
              <label class="btn white sm" style="margin:0;color:var(--ink)">Vyzkoušet obrázek<input type="file" accept="image/*" data-try="${w}" hidden></label>
            </div>
          </section>`).join('')}
        </div>
      </div>
      <div class="dialog-foot"><span class="hint">Vyzkoušený obrázek se ukáže jen tady v náhledu, nikam se nenahrává.</span>
        <div class="r"><button class="btn white" data-a="close">Zavřít</button><button class="btn" data-a="brief" data-v="${esc(s.id)}">${I.down}Stáhnout zadání</button></div></div>
    </div>`);
}

// ---------- Modální okno, toast, schránka ----------
function modal(html) { $('#modal').innerHTML = `<div class="overlay" data-a="overlay">${html}</div>`; const f = $('#modal [data-a="close"]'); if (f) f.focus(); }
function closeModal() { $('#modal').innerHTML = ''; ED = null; }
function confirmBox(title, text, okLabel, onOk) {
  modal(`<div class="dialog narrow" role="alertdialog" aria-modal="true" aria-labelledby="cfT">
    <div class="dialog-head"><h2 id="cfT">${title}</h2></div>
    <div class="dialog-body"><p>${text}</p></div>
    <div class="dialog-foot"><div class="r"><button class="btn white" data-a="close">Nechat být</button><button class="btn danger" id="cfOk">${okLabel}</button></div></div></div>`);
  $('#cfOk').onclick = () => { closeModal(); onOk(); };
}
let toastT;
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2400); }
async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); } catch (e) {
    const ta = document.createElement('textarea'); ta.value = text; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); toast(msg); } catch (e2) { toast('Kopírování se nepovedlo'); }
    ta.remove();
  }
}
function download(name, text, type = 'text/javascript') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
  a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function usersCsv() {
  const rows = [['ucet', 'registrace', 'deti', 'mesto', 'zeme', 'predplatne', 'pohadek', 'naposledy', 'zdroj']];
  filteredUsers().forEach((f) => rows.push([f.email || 'host', iso(f.created), f.kids, f.town, f.country, f.premium || '', f.plays, iso(f.lastSeen), f.source]));
  return rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
}

// ---------- Vykreslení ----------
const PAGES = { prehled: pageOverview, uzivatele: pageUsers, registrace: pageRegistrations, navstevy: pageVisits, pohadky: pageStories };
function render() {
  const r = route();
  $('#nav').innerHTML = ROUTES.map((x) => `<a href="#${x.id}" class="${x.id === r ? 'on' : ''}" ${x.id === r ? 'aria-current="page"' : ''}>${x.ico}${x.label}</a>`).join('');
  const dark = document.documentElement.dataset.theme === 'dark';
  $('#themeBtn').innerHTML = `${dark ? I.sun : I.moon}<span>${dark ? 'Denní režim' : 'Noční režim'}</span>`;
  after = [];
  $('#main').innerHTML = PAGES[r]();
  after.forEach((f) => f());
}
const ACTIONS = {
  preset: (v) => { setPreset(Number(v)); F.regPage = 0; render(); },
  by: (v) => { F.range.by = v; render(); },
  sort: (v) => { const u = F.users; u.dir = u.sort === v ? -u.dir : -1; u.sort = v; $('#usersTbl').innerHTML = usersTable(); },
  upage: (v) => { F.users.page += Number(v); $('#usersTbl').innerHTML = usersTable(); },
  rpage: (v) => { F.regPage += Number(v); render(); },
  csv: () => download('ospalek-rodiny-ukazka.csv', '﻿' + usersCsv(), 'text/csv'),
  sfilter: (v, t) => { F.stories[t.dataset.k] = v; render(); },
  new: () => openEditor(null),
  edit: (v) => openEditor(v),
  covers: (v) => openCovers(v),
  del: (v) => {
    const s = STORIES.find((x) => x.id === v);
    confirmBox('Smazat pohádku?', `„${esc(safeTitle(s))}“ zmizí ze seznamu. V aplikaci zůstane, dokud nenahraješ nový app/stories.cs.js, a dá se vrátit tlačítkem Zahodit změny.`, 'Smazat', () => {
      STORIES = STORIES.filter((x) => x.id !== v); saveStories(); render(); toast('Pohádka je smazaná');
    });
  },
  reset: () => confirmBox('Zahodit změny?', 'Seznam se vrátí do stavu z app/stories.cs.js. Všechny úpravy v tomhle prohlížeči se ztratí.', 'Zahodit', () => {
    STORIES = ORIG.map((s) => structuredClone(s)); store.del(SK); render(); toast('Změny jsou zahozené');
  }),
  download: () => { download('stories.cs.js', exportFile()); toast('Soubor stories.cs.js se stahuje'); },
  copyExport: () => copy(exportFile(), 'Obsah stories.cs.js je ve schránce'),
  ecat: (v, t) => { const c = ED.s.cats; ED.s.cats = c.includes(v) ? c.filter((x) => x !== v) : [...c, v]; t.classList.toggle('on'); $('#eErr').textContent = ''; },
  eview: (v) => { ED.view = v; renderPreview(); },
  saveStory: () => saveStory(),
  copyPrompt: (v) => copy($(`[data-prompt="${v}"]`).value, 'Prompt je ve schránce'),
  brief: (v) => {
    const s = STORIES.find((x) => x.id === v);
    const out = [['m', s.cover.img], ['f', s.cover.imgF || fPath(s)]].map(([w, path]) => ({ variant: w === 'f' ? 'holka' : 'kluk', path: repoPath(path), width: 573, height: 768, format: 'jpg', prompt: $(`[data-prompt="${w}"]`).value }));
    download(`obalky-${s.id}.json`, JSON.stringify({ story: s.id, title: safeTitle(s), style: 'akvarel a kvaš, dětská knižní ilustrace', outputs: out }, null, 2), 'application/json');
    toast('Zadání se stahuje');
  },
  close: () => closeModal(),
  overlay: (v, t, ev) => { if (ev.target === t) closeModal(); },
};
document.addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-a]');
  if (!t || !ACTIONS[t.dataset.a]) return;
  ACTIONS[t.dataset.a](t.dataset.v, t, ev);
});
document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.dataset.e && ED) return editInput(t);
  const f = t.dataset.f;
  if (f === 'uq') { F.users.q = t.value; F.users.page = 0; $('#usersTbl').innerHTML = usersTable(); }
  if (f === 'sq') {
    F.stories.q = t.value; const pos = t.selectionStart; render();
    const n = $('[data-f="sq"]'); n.focus(); n.setSelectionRange(pos, pos);
  }
});
document.addEventListener('change', (ev) => {
  const t = ev.target, f = t.dataset.f;
  if (['acct', 'prem', 'country'].includes(f)) { F.users[f] = t.value; F.users.page = 0; $('#usersTbl').innerHTML = usersTable(); }
  if ((f === 'from' || f === 'to') && t.value) {
    F.range[f] = t.value; F.range.preset = null; F.regPage = 0;
    if (F.range.from > F.range.to) F.range[f === 'from' ? 'to' : 'from'] = t.value;
    render();
  }
  if (t.dataset.try) {
    const file = t.files[0]; if (!file) return;
    const id = $('[data-a="brief"]').dataset.v, w = t.dataset.try, key = id + ':' + w;
    if (PREVIEWS[key]) URL.revokeObjectURL(PREVIEWS[key]);
    PREVIEWS[key] = URL.createObjectURL(file);
    const s = STORIES.find((x) => x.id === id);
    t.closest('.panel').querySelector('.covers').innerHTML = coverHtml(s, w, 'Zkouška');
    render();
  }
});
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && $('#modal').innerHTML) closeModal(); });
$('#themeBtn').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme !== 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  try { localStorage.setItem('ospalek.admin.theme', dark ? 'dark' : 'light'); } catch (e) {}
  render();
});
let rz;
// při změně šířky jen překreslit grafy – celé překreslení by na mobilu shodilo klávesnici v hledání
addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => after.forEach((f) => f()), 150); });
addEventListener('hashchange', () => { render(); scrollTo(0, 0); });
render();
