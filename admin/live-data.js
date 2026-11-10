// Ostrá data ze Supabase. Načte předpočítané souhrny (funkce admin_* v supabase/schema.sql) a poskládá z nich
// stejný tvar dat jako demo-data.js, takže stránky administrace nepoznají rozdíl.
// Přihlášení: e-mail a heslo člena týmu (Supabase Auth) a kód z Google Authenticatoru. Kdo není v tabulce staff
// nebo nemá ověřený kód (aal2), nic nepřečte – hlídá to databáze.
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

  // Odkaz z e-mailu (obnova hesla) vrací přihlášení v #access_token=…&type=recovery, případně #error=…
  // Přečte se hned po načtení, dřív než adresu převezme směrování administrace, a z adresy se smaže.
  const fromLink = (() => {
    const h = new URLSearchParams(location.hash.slice(1));
    if (!h.has('access_token') && !h.has('error')) return null;
    history.replaceState(null, '', location.pathname + location.search);
    if (h.has('error')) return { error: /expired/.test(h.get('error_code') || '') ? 'Odkaz z e-mailu už vypršel. Pošli si nový.' : (h.get('error_description') || 'Odkaz z e-mailu nefunguje.') };
    return { type: h.get('type'), access_token: h.get('access_token'), refresh_token: h.get('refresh_token'), expires_at: Number(h.get('expires_at')) || Math.floor(Date.now() / 1000) + Number(h.get('expires_in') || 3600) };
  })();

  async function call(method, path, body, token) {
    const r = await fetch(`${URL_}/auth/v1/${path}`, { method, headers: headers(token), body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error_description || j.msg || j.message || 'Přihlášení se nepovedlo'); e.status = r.status; e.code = j.error_code || j.code; throw e; }
    return j;
  }
  const keep = (j) => {
    const s = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600) };
    set(SKEY, s);
    return s;
  };
  const auth = async (path, body) => keep(await call('POST', path, body));
  // úroveň ověření z tokenu: aal1 = jen heslo, aal2 = heslo + kód z aplikace
  const aal = (s) => { try { return JSON.parse(atob(s.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).aal || 'aal1'; } catch (e) { return 'aal1'; } };
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

  // ---------- Přihlašovací okna ----------
  // Jedna karta, ve které se střídají kroky: heslo → (nové heslo) → kód z Google Authenticatoru.
  let box = null;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function card(html, onSubmit) {
    if (!box) { box = document.createElement('main'); box.className = 'login'; document.body.prepend(box); }
    box.innerHTML = `<form class="panel login-card" novalidate><img src="../brand/maskot-3d/web/ospalek-spi.webp" alt=""><b class="wordmark">Ospalek</b>${html}</form>`;
    const form = box.querySelector('form'), err = form.querySelector('.err');
    form.querySelector('input:not([type=hidden])')?.focus();
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const btn = form.querySelector('button[type=submit]'); btn.disabled = true; if (err) { err.textContent = ''; err.classList.remove('ok'); }
      try { await onSubmit(form); } catch (e) { if (err) err.textContent = e.message; } finally { if (btn.isConnected) btn.disabled = false; }
    });
    return form;
  }
  const done = () => { box?.remove(); box = null; };
  const codeInput = '<label for="sbCode">Kód z aplikace</label><input id="sbCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" placeholder="123456" required class="code">';
  const readCode = (form) => { const c = form.querySelector('#sbCode').value.replace(/\D/g, ''); if (c.length !== 6) throw new Error('Kód má 6 číslic.'); return c; };
  const codeErr = (e) => (e.status === 422 || e.status === 400 ? new Error('Kód nesedí nebo už vypršel. Zkus ten aktuální.') : e);

  function passwordStep(msg) {
    return new Promise((resolve) => {
      const form = card(`
        <h1>Administrace</h1>
        <p class="muted">Přihlas se účtem člena týmu v databázi.</p>
        <label for="sbMail">E-mail</label><input id="sbMail" type="email" autocomplete="username" required>
        <label for="sbPw">Heslo</label><input id="sbPw" type="password" autocomplete="current-password" required>
        <p class="err" role="alert">${esc(msg)}</p>
        <button class="btn" type="submit">Přihlásit</button>
        <button class="linkbtn" type="button" data-forgot>Zapomenuté heslo</button>`, async (f) => {
        const email = f.querySelector('#sbMail').value.trim(), password = f.querySelector('#sbPw').value;
        if (!email || !password) throw new Error('Vyplň e-mail i heslo.');
        try { await auth('token?grant_type=password', { email, password }); } catch (e) { throw e.status === 400 ? new Error('E-mail nebo heslo nesedí.') : e; }
        resolve();
      });
      form.querySelector('[data-forgot]').onclick = () => forgotStep(form.querySelector('#sbMail').value.trim()).then(resolve);
    });
  }
  // Obnova hesla: Supabase pošle e-mail s odkazem zpět sem (adresa musí být v Authentication → URL Configuration).
  function forgotStep(email) {
    return new Promise((resolve) => {
      const form = card(`
        <h1>Zapomenuté heslo</h1>
        <p class="muted">Pošleme ti e-mail s odkazem, přes který si nastavíš nové heslo.</p>
        <label for="sbMail">E-mail</label><input id="sbMail" type="email" autocomplete="username" required value="${esc(email)}">
        <p class="err" role="alert"></p>
        <button class="btn" type="submit">Poslat odkaz</button>
        <button class="linkbtn" type="button" data-back>Zpět na přihlášení</button>`, async (f) => {
        const mail = f.querySelector('#sbMail').value.trim();
        if (!/@/.test(mail)) throw new Error('Zadej e-mail.');
        const back = location.origin + location.pathname + location.search;
        try { await call('POST', 'recover?redirect_to=' + encodeURIComponent(back), { email: mail }); } catch (e) { if (e.status === 429) throw new Error('E-mailů odešlo moc najednou. Zkus to za chvíli.'); throw e; }
        // stejná odpověď, ať je e-mail v týmu nebo ne
        const err = f.querySelector('.err'); err.classList.add('ok');
        err.textContent = 'Hotovo. Pokud je e-mail v týmu, za chvíli ti přijde odkaz. Otevři ho na tomhle zařízení.';
      });
      form.querySelector('[data-back]').onclick = () => passwordStep().then(resolve);
    });
  }
  function newPasswordStep(token) {
    return new Promise((resolve) => {
      card(`
        <h1>Nové heslo</h1>
        <p class="muted">Aspoň 12 znaků. Ideálně ho nech vygenerovat správce hesel.</p>
        <label for="sbPw">Nové heslo</label><input id="sbPw" type="password" autocomplete="new-password" minlength="12" required>
        <label for="sbPw2">Znovu</label><input id="sbPw2" type="password" autocomplete="new-password" required>
        <p class="err" role="alert"></p>
        <button class="btn" type="submit">Uložit heslo</button>`, async (f) => {
        const pw = f.querySelector('#sbPw').value;
        if (pw.length < 12) throw new Error('Heslo musí mít aspoň 12 znaků.');
        if (pw !== f.querySelector('#sbPw2').value) throw new Error('Hesla se neshodují.');
        try { await call('PUT', 'user', { password: pw }, token); } catch (e) { throw e.code === 'same_password' ? new Error('Nové heslo musí být jiné než staré.') : e; }
        resolve();
      });
    });
  }
  // Druhý krok: kód z Google Authenticatoru (TOTP). Bez něj databáze administraci nic nevydá.
  async function mfaStep() {
    const s = get(SKEY);
    const user = await call('GET', 'user', null, s.access_token);
    const factors = (user.factors || []).filter((f) => f.factor_type === 'totp');
    const ok = factors.find((f) => f.status === 'verified');
    const verify = async (factorId, code) => {
      const ch = await call('POST', `factors/${factorId}/challenge`, {}, s.access_token);
      try { keep(await call('POST', `factors/${factorId}/verify`, { challenge_id: ch.id, code }, s.access_token)); } catch (e) { throw codeErr(e); }
    };
    if (ok) {
      return new Promise((resolve) => {
        const form = card(`
          <h1>Ověření</h1>
          <p class="muted">Zadej šestimístný kód z aplikace Google Authenticator (Ospalek).</p>
          ${codeInput}
          <p class="err" role="alert"></p>
          <button class="btn" type="submit">Ověřit</button>
          <button class="linkbtn" type="button" data-out>Přihlásit jiným účtem</button>`, async (f) => { await verify(ok.id, readCode(f)); resolve(); });
        form.querySelector('[data-out]').onclick = () => { set(SKEY, null); location.reload(); };
      });
    }
    // první přihlášení: nastavit aplikaci (nedokončená nastavení z dřívějška se smažou)
    for (const f of factors) await call('DELETE', `factors/${f.id}`, null, s.access_token).catch(() => {});
    const en = await call('POST', 'factors', { factor_type: 'totp', friendly_name: 'Ospalek administrace', issuer: 'Ospalek' }, s.access_token);
    // Supabase posílá QR jako SVG (někdy už s prefixem data:…); znaky jako # se musí v adrese zakódovat
    let svg = String(en.totp.qr_code || '').replace(/^data:[^,]*,/, '');
    if (/^%3C/i.test(svg)) svg = decodeURIComponent(svg);
    const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    const secret = String(en.totp.secret || '').replace(/(.{4})/g, '$1 ').trim();
    return new Promise((resolve) => {
      card(`
        <h1>Zabezpeč přihlášení</h1>
        <p class="muted">Do administrace se kromě hesla přihlašuje i kódem z mobilu. Nainstaluj si Google Authenticator, klepni na + a naskenuj kód.</p>
        <img class="qr" src="${esc(src)}" alt="QR kód pro Google Authenticator">
        <p class="hint">Nejde skenovat? Zadej ručně klíč<br><code class="secret">${esc(secret)}</code></p>
        ${codeInput}
        <p class="err" role="alert"></p>
        <button class="btn" type="submit">Ověřit a dokončit</button>`, async (f) => { await verify(en.id, readCode(f)); resolve(); });
    });
  }

  // Vrací se, až je člen týmu přihlášený heslem i kódem (aal2) a je v tabulce staff.
  async function ensureStaff() {
    if (fromLink && fromLink.error) { set(SKEY, null); await passwordStep(fromLink.error); }
    else if (fromLink && fromLink.type === 'recovery') { keep(fromLink); await newPasswordStep(fromLink.access_token); }
    for (let tries = 0; ; tries++) {
      if (!(await session())) await passwordStep(tries ? 'Přihlášení vypršelo, přihlas se znovu.' : '');
      try {
        const me = await rpc('admin_me');
        if (!me || !me.length) { set(SKEY, null); await passwordStep('Tenhle účet není v týmu (tabulka staff).'); continue; }
        if (aal(get(SKEY)) !== 'aal2') await mfaStep();
        done();
        return me[0];
      } catch (e) {
        if (e.status !== 401 && e.status !== 403) throw e;
        set(SKEY, null);
      }
    }
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
  // tlačítko Odhlásit v administraci: odhlásí ze Supabase a příště se zase chce e-mail, heslo a kód
  window.adminLogout = () => { set(SKEY, null); if (configured) set(MKEY, null); location.reload(); };
  // pozůstatek zrušeného společného hesla k administraci
  try { localStorage.removeItem('ospalek.admin.auth'); sessionStorage.removeItem('ospalek.admin.auth'); } catch (e) {}
  return { configured, url: URL_, dev: devOk, mode, setMode, ensureStaff, load, rpc, signOut: () => set(SKEY, null) };
})();
