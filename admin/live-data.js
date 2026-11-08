// Ostrá data ze Supabase. Načte předpočítané souhrny (funkce admin_* v supabase/schema.sql) a poskládá z nich
// stejný tvar dat jako demo-data.js, takže stránky administrace nepoznají rozdíl.
// Přihlášení: e-mail a heslo člena týmu (Supabase Auth). Kdo není v tabulce staff, nic nepřečte – hlídá to databáze.
// Lokální zkouška: admin/?db=http://localhost:54321 (supabase/dev-server.mjs).

const LIVE = (() => {
  const C = window.OSPALEK_CONFIG || {};
  const dev = new URLSearchParams(location.search).get('db');
  const devOk = dev && /^http:\/\/localhost(:\d+)?$/.test(dev);
  const URL_ = devOk ? dev : C.supabaseUrl;
  const KEY_ = devOk ? 'dev' : C.supabaseAnonKey;
  const SKEY = 'ospalek.admin.sb.v1', MKEY = 'ospalek.admin.mode';
  const configured = !!(URL_ && KEY_);
  const get = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const headers = (t) => ({ apikey: KEY_, 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) });

  async function auth(path, body) {
    const r = await fetch(`${URL_}/auth/v1/${path}`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error_description || j.msg || j.message || 'Přihlášení se nepovedlo'); e.status = r.status; throw e; }
    const s = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600), email: j.user && j.user.email };
    set(SKEY, s);
    return s;
  }
  async function session() {
    const s = get(SKEY);
    if (!s) return null;
    if (s.expires_at * 1000 > Date.now() + 60e3) return s;
    try { return await auth('token?grant_type=refresh_token', { refresh_token: s.refresh_token }); } catch (e) { set(SKEY, null); return null; }
  }
  async function rpc(fn, args = {}) {
    const s = await session();
    if (!s) throw Object.assign(new Error('Nejsi přihlášený do databáze'), { status: 401 });
    const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers: headers(s.access_token), body: JSON.stringify(args) });
    if (r.status === 204) return null;
    const j = await r.json().catch(() => null);
    if (!r.ok) throw Object.assign(new Error((j && j.message) || `${fn}: ${r.status}`), { status: r.status });
    return j;
  }

  // Přihlašovací okno pro člena týmu. Vrací se, až je přihlášený a v tabulce staff.
  function staffLogin(msg) {
    return new Promise((resolve) => {
      const box = document.createElement('main');
      box.className = 'login';
      box.innerHTML = `
        <form class="panel login-card" novalidate>
          <img src="../brand/maskot-3d/web/ospalek-spi.webp" alt="">
          <b class="wordmark">ospalek</b>
          <h1>Ostrá data</h1>
          <p class="muted">Přihlas se účtem člena týmu v databázi.</p>
          <label for="sbMail">E-mail</label><input id="sbMail" type="email" autocomplete="username" required>
          <label for="sbPw">Heslo</label><input id="sbPw" type="password" autocomplete="current-password" required>
          <p class="err" role="alert">${msg || ''}</p>
          <button class="btn" type="submit">Přihlásit</button>
          <button class="btn white" type="button" data-demo style="margin-top:8px">Zobrazit ukázková data</button>
        </form>`;
      document.body.prepend(box);
      const form = box.querySelector('form'), err = box.querySelector('.err');
      box.querySelector('#sbMail').focus();
      box.querySelector('[data-demo]').onclick = () => { setMode('demo'); location.reload(); };
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const btn = form.querySelector('button[type=submit]'); btn.disabled = true; err.textContent = '';
        try {
          await auth('token?grant_type=password', { email: box.querySelector('#sbMail').value.trim(), password: box.querySelector('#sbPw').value });
          const me = await rpc('admin_me');
          if (!me || !me.length) { set(SKEY, null); throw new Error('Tenhle účet není v týmu (tabulka staff).'); }
          box.remove(); resolve(me[0]);
        } catch (e) { err.textContent = e.status === 400 ? 'E-mail nebo heslo nesedí.' : e.message; btn.disabled = false; }
      });
    });
  }
  async function ensureStaff() {
    if (await session()) {
      try { const me = await rpc('admin_me'); if (me && me.length) return me[0]; } catch (e) { if (e.status !== 401 && e.status !== 403) throw e; }
      set(SKEY, null);
    }
    return staffLogin();
  }

  // ---------- Převod do tvaru demo-data.js ----------
  async function load(me) {
    const DAYS = 180, t0 = performance.now();
    const [fams, daily, cohorts, wau, heat, stories, staff, audit] = await Promise.all([
      rpc('admin_families'), rpc('admin_daily', { n: DAYS }), rpc('admin_cohorts', { weeks: 26 }), rpc('admin_wau', { weeks: 26 }),
      rpc('admin_heat', { n: DAYS }), rpc('admin_stories'), rpc('admin_staff'), rpc('admin_audit', { n: 2000 }),
    ]);
    const fetchMs = performance.now() - t0;
    const day0 = new Date(); day0.setHours(0, 0, 0, 0);
    const dayAt = (i) => { const d = new Date(day0); d.setDate(d.getDate() - (DAYS - 1 - i)); return d; };
    const pd = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
    const idxOf = (d) => DAYS - 1 - Math.round((day0 - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
    const W0 = (dayAt(0).getDay() + 6) % 7;
    const weekOf = (i) => Math.floor((i + W0) / 7);
    const WEEKS = weekOf(DAYS - 1) + 1;
    const deacc = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const CAT_IDS = ['noc', 'auto', 'dobro', 'zivot'];
    const z = () => new Float64Array(DAYS);
    const N = Number;

    const D = {
      live: true, me, loadedAt: new Date(), fetchMs, rpc, url: URL_, dev: devOk,
      days: DAYS, scale: 1, dayAt, weekOf, WEEKS, deacc, catIds: CAT_IDS, charsPerMin: 740, eur: 25,
      sources: [], visits: Array.from({ length: DAYS }, (_, i) => ({ date: dayAt(i), landing: 0, app: 0 })),
      daily: { plays: z(), minutes: z(), dau: z(), done: z(), genChars: z(), cacheHits: z(), mrr: z(), subs: z(), trials: z(), cat: Object.fromEntries(CAT_IDS.map((c) => [c, z()])) },
      wau: new Float64Array(WEEKS), heat: new Float64Array(7 * 24),
      cohorts: Array.from({ length: WEEKS }, () => ({ size: 0, active: new Float64Array(WEEKS) })),
      stories: (window.STORIES || []).map((s) => ({ id: s.id, free: !!s.free, cat: s.cats[0], min: 9 })),
      storyAgg: {}, payments: [], vouchers: [], promos: [], tickets: [], ttsJobs: [],
      ticketCats: { platby: 'Platby', prehravani: 'Přehrávání', hlas: 'Hlas a výslovnost', ucet: 'Účet a přihlášení', obsah: 'Obsah a přání', gdpr: 'Osobní údaje (GDPR)', chyba: 'Chyba aplikace' },
      slaH: { urgent: 2, high: 8, normal: 24, low: 72 },
    };
    daily.forEach((r) => {
      const i = idxOf(pd(r.day)); if (i < 0 || i >= DAYS) return;
      D.daily.plays[i] = N(r.plays); D.daily.minutes[i] = N(r.seconds) / 60; D.daily.done[i] = N(r.completed); D.daily.dau[i] = N(r.dau);
      D.daily.subs[i] = N(r.premium);
      CAT_IDS.forEach((c) => { D.daily.cat[c][i] = N((r.cats || {})[c] || 0); });
    });
    wau.forEach((r) => { const w = weekOf(idxOf(pd(r.week))); if (w >= 0 && w < WEEKS) D.wau[w] = N(r.families); });
    heat.forEach((r) => { D.heat[r.dow * 24 + r.hour] = N(r.plays); });
    cohorts.forEach((r) => {
      const w = weekOf(Math.max(0, idxOf(pd(r.cohort)))); if (w < 0 || w >= WEEKS) return;
      if (r.week_offset === 0) D.cohorts[w].size = N(r.families);
      if (r.week_offset < WEEKS) D.cohorts[w].active[r.week_offset] = N(r.families);
    });
    stories.forEach((r) => { D.storyAgg[r.story_id] = { plays: N(r.plays), done: N(r.completed), minutes: N(r.seconds) / 60, families: N(r.families), gens: 0 }; });
    D.stories.forEach((s) => { if (!D.storyAgg[s.id]) D.storyAgg[s.id] = { plays: 0, done: 0, minutes: 0, families: 0, gens: 0 }; });

    D.families = fams.map((r) => {
      const created = new Date(r.created_at), ci = Math.max(0, idxOf(created));
      const lastI = r.last_day ? idxOf(pd(r.last_day)) : ci;
      const premium = !!r.premium;
      const f = {
        id: 'f' + String(r.seq).padStart(5, '0'), uuid: r.id, n: N(r.seq),
        email: r.email, name: r.email ? r.email.split('@')[0] : null, provider: r.provider,
        created, ci, town: r.town || '–', country: r.country || '', source: r.source || 'Přímý přístup',
        platform: r.platform || 'Web', appVer: r.app_version || 'web',
        kids: (r.kids || []).map((k) => ({ name: k.name, g: k.g, age: k.age ?? 0 })),
        plan: premium ? 'měsíc' : null, status: premium ? 'active' : null, trialI: -1, subI: -1, subEnd: -1, failed: false, premium: premium ? 'měsíc' : null,
        plays: N(r.plays), minutes: N(r.seconds) / 60, days: N(r.days), plays30: N(r.plays30), min30: N(r.seconds30) / 60, days30: N(r.days30),
        lastSeen: new Date(r.last_seen_at), lastI, favCat: r.fav_category || 'noc', onboarded: r.onboarded, analytics: !!r.analytics, tags: [],
      };
      const idle = DAYS - 1 - lastI;
      f.health = Math.max(0, Math.min(100, Math.round(25 + f.days30 * 3.2 + Math.min(20, f.plays30) - idle * 1.6 + (premium ? 8 : 0))));
      f.risk = premium && idle >= 10;
      if (f.days30 >= 20) f.tags.push('fanoušek');
      if (f.risk) f.tags.push('riziko odchodu');
      if (!f.onboarded) f.tags.push('nedokončená registrace');
      if (!f.analytics) f.tags.push('bez statistik');
      f.haystack = deacc([f.id, f.email, f.town, ...f.kids.map((k) => k.name)].filter(Boolean).join(' '));
      return f;
    });
    D.sources = [...new Set(D.families.map((f) => f.source))];
    D.staff = staff.map((s, i) => ({ id: s.user_id, name: s.name, role: s.role, email: s.email || '', twofa: null, last: s.last_sign_in_at ? new Date(s.last_sign_in_at) : null }));
    // přihlášený člen týmu jako první (administrace ho bere jako „já“)
    D.staff.sort((a, b) => (a.name === me.name && a.role === me.role ? -1 : b.name === me.name && b.role === me.role ? 1 : 0));
    D.audit = audit.map((a) => ({ at: new Date(a.at), actor: a.actor_name || 'systém', action: a.action, target: a.target || '', detail: a.detail || '' }));

    // Poslechy jedné rodiny se načítají až při otevření detailu
    D.familyDetailAsync = async (f) => {
      const rows = await rpc('admin_family_plays', { fseq: f.n, n: DAYS });
      const out = { plays: 0, minutes: 0, days: 0, cat: [0, 0, 0, 0], story: {}, hero: f.kids.map(() => 0), done: 0, hours: new Float64Array(24), series: { plays: new Uint16Array(DAYS), minutes: new Float32Array(DAYS), events: [] } };
      const days = new Set();
      rows.forEach((p) => {
        const at = new Date(p.started_at), i = idxOf(at); if (i < 0 || i >= DAYS) return;
        const min = N(p.listened_sec) / 60, ci2 = CAT_IDS.indexOf(p.category);
        out.plays++; out.minutes += min; if (p.completed) out.done++; out.hours[at.getHours()]++; days.add(i);
        if (ci2 >= 0) out.cat[ci2] += min;
        out.story[p.story_id] = (out.story[p.story_id] || 0) + 1;
        out.series.plays[i]++; out.series.minutes[i] += min;
        out.series.events.push({ i, hour: at.getHours(), story: p.story_id, min, done: p.completed, hero: 0 });
      });
      out.days = days.size;
      return out;
    };
    D.familyDetail = () => null;
    D.deleteFamily = (f) => rpc('admin_delete_family', { fseq: f.n });
    D.log = (action, target, detail) => rpc('admin_log', { action, target: String(target || ''), detail: String(detail || '') }).catch(() => {});
    return D;
  }

  const mode = () => (configured ? (get(MKEY) || 'live') : 'demo');
  const setMode = (m) => set(MKEY, m);
  return { configured, url: URL_, dev: devOk, mode, setMode, ensureStaff, load, rpc, signOut: () => set(SKEY, null) };
})();
