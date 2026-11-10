// Ospalek – odesílání rodiny a poslechů do databáze (Supabase), aby je viděla administrace.
// Bez vyplněného ../config.js nedělá nic a aplikace běží jen nad localStorage jako dřív.
//  – Rodina dostane anonymní účet (bez e-mailu); e-mail se posílá jen u skutečného přihlášení.
//  – Vždy (evidence zákazníků pro podporu): obec, děti (jméno, pohlaví, věk), zařízení, předplatné.
//  – Statistiky (poslechy přiřazené k rodině, zdroj návštěvy) jen se souhlasem S.analytics. Bez souhlasu se poslech
//    pošle anonymně (databáze ho nepřiřadí k rodině) a na zařízení se kvůli statistikám nic neukládá.
//    Jídlo, zvíře, rodiče a místa v okolí zůstávají jen v telefonu.
//  – Co se nepovede odeslat, čeká ve frontě v localStorage (poslechy bez souhlasu ne, ty se jen zkusí poslat).
//  – Propojené telefony (SYNC.link): první telefon vytvoří kód, druhý ho zadá. Jen u propojené rodiny se posílá celý
//    profil (SYNC.profile) a historie poslechu (SYNC.listen), aby oba telefony měly stejnou rodinu i „Co jsme už slyšeli“.
// Lokální zkouška: ?db=http://localhost:54321 (supabase/dev-server.mjs).

const SYNC = (() => {
  const C = window.OSPALEK_CONFIG || {};
  const dev = new URLSearchParams(location.search).get('db');
  const devOk = dev && /^http:\/\/localhost(:\d+)?$/.test(dev);
  const URL_ = devOk ? dev : C.supabaseUrl;
  const KEY_ = devOk ? 'dev' : C.supabaseAnonKey;
  const noop = { on: false, family() {}, playStart() { return null; }, playEnd() {}, forget: async () => {}, profile() {}, listen() {}, profilePending: () => false, link: null };
  if (!URL_ || !KEY_) return noop;

  const SKEY = 'ospalek.sb.v1', QKEY = 'ospalek.sbq.v1', SRC = 'ospalek.src.v1';
  const get = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const VERSION = 'web-' + ((document.querySelector('script[src*="app.js"]')?.getAttribute('src') || '').match(/v=(\d+)/) || [, '?'])[1];

  // odkud rodina přišla (první návštěva): utm_source, jinak doména odkazu. Uloží se jen se souhlasem.
  const firstSrc = get(SRC) || (() => {
    const q = new URLSearchParams(location.search);
    let src = q.get('utm_source') || q.get('ref');
    if (!src && document.referrer) { try { const h = new URL(document.referrer).hostname.replace(/^www\./, ''); if (!/ospalek\.cz$|github\.io$|localhost/.test(h)) src = h; } catch (e) {} }
    return (src || 'Přímý přístup').slice(0, 60);
  })();

  const headers = (token) => ({ apikey: KEY_, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) });
  async function auth(path, body) {
    const r = await fetch(`${URL_}/auth/v1/${path}`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    if (!r.ok) throw new Error('auth ' + r.status);
    const s = await r.json();
    const sess = { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600), user: s.user && s.user.id };
    set(SKEY, sess);
    return sess;
  }
  let pending = null;
  function session() {
    const s = get(SKEY);
    if (s && s.expires_at * 1000 > Date.now() + 60e3) return Promise.resolve(s);
    // jedno přihlášení najednou, i když se odesílá víc věcí současně
    pending = pending || (s && s.refresh_token ? auth('token?grant_type=refresh_token', { refresh_token: s.refresh_token }).catch(() => auth('signup', { data: {} })) : auth('signup', { data: {} }))
      .finally(() => { pending = null; });
    return pending;
  }
  async function rpc(fn, args, keepalive) {
    const s = await session();
    const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers: headers(s.access_token), body: JSON.stringify(args), keepalive: !!keepalive });
    if (r.status === 401) { set(SKEY, { ...s, expires_at: 0 }); throw new Error('401'); }
    if (!r.ok) throw Object.assign(new Error((await r.json().catch(() => ({}))).message || fn + ' ' + r.status), { status: r.status });
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  }

  // fronta: rodina se drží jen jednou (poslední stav), poslechy v pořadí
  let queue = get(QKEY) || [];
  let flushing = false;
  const persist = () => set(QKEY, queue.filter((j) => !j.volatile).slice(-200));
  async function flush(keepalive) {
    if (flushing || !queue.length) return;
    flushing = true;
    try {
      while (queue.length) {
        const job = queue[0];
        await rpc(job.fn, job.args, keepalive);
        queue.shift(); persist();
      }
    } catch (e) { /* zkusí se znovu později */ } finally { flushing = false; }
  }
  const push = (job, keepalive) => {
    // rodina a profil: stačí poslední stav
    if (job.fn === 'app_sync_family' || job.fn === 'app_push_profile') queue = queue.filter((x) => x.fn !== job.fn);
    // rodina musí být v databázi dřív než její poslechy
    if (job.fn === 'app_sync_family') queue.unshift(job); else queue.push(job);
    persist(); flush(keepalive);
  };
  addEventListener('online', () => flush());
  setTimeout(() => flush(), 3000);

  let famT = null;
  const realEmail = (u) => (u && u.provider !== 'guest' && /@/.test(u.email || '') && !/@example\.(com|cz)$/.test(u.email) ? u.email : null);
  function familyJob(S) {
    const consent = S.analytics === true;
    if (consent) set(SRC, firstSrc); else set(SRC, null);
    return {
      fn: 'app_sync_family',
      args: { p: {
        provider: S.user ? (S.user.provider === 'guest' ? 'guest' : S.user.provider) : 'guest',
        email: realEmail(S.user), town: S.family.home.town || null, country: S.family.home.country || null,
        platform: 'Web', app_version: VERSION, source: consent ? firstSrc : null, onboarded: !!S.onboarded, premium: !!S.premium, analytics: consent,
        children: S.family.children.map((k) => ({ id: String(k.id), name: (k.forms && k.forms.nom) || '', gender: k.gender === 'f' ? 'f' : 'm', age: k.age })),
      } },
    };
  }
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); }));

  return {
    on: true,
    // po každém uložení; odešle se s krátkým zpožděním, ať se nepíše při každém písmenku
    family(S) {
      if (!S.user) return;
      clearTimeout(famT);
      famT = setTimeout(() => push(familyJob(S)), 1500);
    },
    playStart(st, S) {
      if (!S.user) return null;
      if (famT) { clearTimeout(famT); famT = null; push(familyJob(S)); }
      const p = { id: uuid(), t0: Date.now(), story: st.id, category: st.cats[0], heroes: Math.max(1, S.heroIds.length), volatile: S.analytics !== true };
      push({ fn: 'app_play', volatile: p.volatile, args: { p: { id: p.id, story: p.story, category: p.category, heroes: p.heroes, started_at: new Date(p.t0).toISOString() } } });
      return p;
    },
    // konec poslechu: dohráno, nebo zavřeno dřív (progress = kolik odstavců zaznělo)
    playEnd(p, completed, progress) {
      if (!p || p.done) return;
      p.done = !!completed;
      const sec = Math.min(7200, Math.round((Date.now() - p.t0) / 1000));
      push({ fn: 'app_play', volatile: p.volatile, args: { p: { id: p.id, story: p.story, sec, progress: completed ? 1 : Math.max(0, Math.min(1, progress || 0)), completed: !!completed } } }, true);
    },
    // propojená rodina: celý profil a poslechy do historie
    profile(p) { push({ fn: 'app_push_profile', args: { p } }); },
    listen(entry) { push({ fn: 'app_listen', args: { p: entry } }); },
    profilePending: () => queue.some((j) => j.fn === 'app_push_profile'),
    link: {
      pull: (rev) => rpc('app_pull', { rev: rev ?? -1 }),
      // rodina musí být v databázi dřív, než pro ni vznikne kód
      async invite(S, profile, listens) {
        clearTimeout(famT); famT = null; push(familyJob(S));
        for (let i = 0; i < 40 && queue.some((j) => j.fn === 'app_sync_family'); i++) { await flush(); await new Promise((r) => setTimeout(r, 250)); }
        return rpc('app_invite', { profile, listens });
      },
      join: (code) => rpc('app_join', { code }),
      unlink: () => rpc('app_unlink', {}),
      clearListens: () => rpc('app_clear_listens', {}),
    },
    // „Smazat všechna data“: smaže rodinu i anonymní účet v databázi
    async forget() {
      queue = []; persist(); set(SRC, null);
      if (get(SKEY)) { try { await rpc('app_delete_family', {}); } catch (e) { /* bez připojení zůstane účet bez dat */ } }
      set(SKEY, null);
    },
  };
})();
