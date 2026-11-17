// Ospalek – odesílání rodiny a poslechů do databáze (Supabase), aby je viděla administrace.
// Bez vyplněného ../config.js nedělá nic a aplikace běží jen nad localStorage jako dřív.
//  – Rodina dostane anonymní účet (bez e-mailu); e-mail se posílá jen u skutečného přihlášení.
//  – Vždy (evidence zákazníků pro podporu): obec, děti (jméno, pohlaví, věk), zařízení, předplatné.
//  – Statistiky (poslechy přiřazené k rodině, zdroj návštěvy) jen se souhlasem S.analytics. Bez souhlasu se poslech
//    pošle anonymně (databáze ho nepřiřadí k rodině) a na zařízení se kvůli statistikám nic neukládá.
//    Jídlo, zvíře, rodiče a místa v okolí zůstávají jen v telefonu.
//  – Co se nepovede odeslat, čeká ve frontě v localStorage (poslechy bez souhlasu ne, ty se jen zkusí poslat).
// Lokální zkouška: ?db=http://localhost:54321 (supabase/dev-server.mjs).

const SYNC = (() => {
  const C = window.OSPALEK_CONFIG || {};
  const dev = new URLSearchParams(location.search).get('db');
  const devOk = dev && /^http:\/\/localhost(:\d+)?$/.test(dev);
  const URL_ = devOk ? dev : C.supabaseUrl;
  const KEY_ = devOk ? 'dev' : C.supabaseAnonKey;
  const noop = { on: false, family() {}, playStart() { return null; }, playEnd() {}, rate() {}, link: async () => { throw new Error('Přihlášení teď není dostupné.'); }, merge: async () => { throw new Error('Přihlášení teď není dostupné.'); }, signOut() {}, call: async () => null, forget: async () => {} };
  if (!URL_ || !KEY_) return noop;

  const SKEY = 'ospalek.sb.v1', QKEY = 'ospalek.sbq.v1', SRC = 'ospalek.src.v1';
  const get = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  // Platforma a verze do administrace. Dřív se verze četla hned při načtení sync.js, kdy app.js ještě v
  // dokumentu nebyl (vždy „web-?“), a mobilní aplikace se hlásily jako Web.
  const CAP = window.Capacitor;
  const PLATFORM = CAP && CAP.isNativePlatform && CAP.isNativePlatform() ? (CAP.getPlatform() === 'ios' ? 'iOS' : 'Android') : 'Web';
  const version = () => {
    const v = ((document.querySelector('script[src*="/app.js"], script[src^="app.js"]')?.getAttribute('src') || '').match(/v=(\d+)/) || [, '?'])[1];
    return (PLATFORM === 'Web' ? 'web-' : PLATFORM.toLowerCase() + '-') + v;
  };

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
  // uloží session z přihlášení (auth/v1/token)
  const keep = (j) => set(SKEY, { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600), user: j.user && j.user.id });
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
    if (!r.ok) throw new Error(fn + ' ' + r.status);
    return r.status === 204 ? null : r.json().catch(() => null);
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
    if (job.fn === 'app_sync_family') queue = queue.filter((x) => x.fn !== 'app_sync_family');
    // rodina musí být v databázi dřív než její poslechy
    if (job.fn === 'app_sync_family') queue.unshift(job); else queue.push(job);
    persist(); flush(keepalive);
  };
  addEventListener('online', () => flush());
  setTimeout(() => flush(), 3000);

  let famT = null;
  const realEmail = (u) => (u && u.provider !== 'guest' && /@/.test(u.email || '') && !/@example\.(com|cz)$/.test(u.email) ? u.email : null);
  // nastavení aplikace pro administraci: jen volby a počty, žádná jména blízkých, místa ani oblíbené věci
  const len = (a) => (Array.isArray(a) ? a.length : 0);
  function settingsOf(S) {
    const f = S.family || {}, h = f.home || {}, m = new Date().toISOString().slice(0, 7);
    return {
      theme: S.theme || 'auto', notify: S.notify === true ? 'on' : S.notify === false ? 'off' : 'ask',
      relatives: len(f.parents), places: len(h.near) + len(h.attr) + (h.inTown ? 1 : 0), heroes: len(S.heroIds),
      favs: len(S.favs), heard: (S.history || []).filter((x) => x.done).length,
      changesMonth: S.changes && S.changes.m === m ? S.changes.n : 0, code: !!(S.codeUntil && S.codeUntil > Date.now()),
    };
  }
  function familyJob(S) {
    const consent = S.analytics === true;
    if (consent) set(SRC, firstSrc); else set(SRC, null);
    return {
      fn: 'app_sync_family',
      args: { p: {
        provider: S.user ? (S.user.provider === 'guest' ? 'guest' : S.user.provider) : 'guest',
        email: realEmail(S.user), town: S.family.home.town || null, country: S.family.home.country || null,
        platform: PLATFORM, app_version: version(), source: consent ? firstSrc : null, newsletter: !!(S.news && realEmail(S.user)), onboarded: !!S.onboarded, premium: !!S.premium, analytics: consent,
        children: S.family.children.map((k) => ({ id: String(k.id), name: (k.forms && k.forms.nom) || '', gender: k.gender === 'f' ? 'f' : 'm', age: k.age })),
        settings: settingsOf(S),
      } },
    };
  }
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); }));

  return {
    on: true,
    // přihlášení rodiny pro ověření nákupu na serveru (app/billing.js)
    token: async () => (await session()).access_token,
    // přihlášení pro tts-worker: bez něj novou větu nenamluví (kredity jsou jen pro rodiny) a podle něj ji zapíše k účtu.
    // Rodina, která už začala (S.user), účet má nebo ho dostane při prvním uložení; tady se jen nečeká, až to proběhne.
    ttsAuth: async (S) => { if (!S.user) return null; try { return (await session()).access_token; } catch (e) { return null; } },
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
    // hodnocení po dohrání (3 skvělá, 2 líbila, 1 nic moc) – uloží se ke stejnému záznamu poslechu
    rate(p, rating) {
      if (!p || ![1, 2, 3].includes(rating)) return;
      push({ fn: 'app_play', volatile: p.volatile, args: { p: { id: p.id, story: p.story, rating } } }, true);
    },
    // Přihlášení přes Google / Apple (auth.js): anonymní účet se propojí s účtem u Googlu nebo Applu,
    // takže zůstane stejné ID uživatele i s historií a předplatným. Když už ten Google/Apple účet patří
    // jinému uživateli (přihlášení na druhém telefonu), přepne se zařízení na něj.
    // Vrací { email, switched }. nonce = náhodný řetězec, jehož SHA-256 dostal Google/Apple.
    async link(provider, idToken, nonce) {
      const s = await session();
      const post = (body, token) => fetch(`${URL_}/auth/v1/token?grant_type=id_token`, { method: 'POST', headers: headers(token), body: JSON.stringify(body) });
      let switched = false;
      const r = await post({ provider, id_token: idToken, nonce, link_identity: true }, s.access_token);
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        const code = e.error_code || e.code;
        // Google / Apple účet nebo jeho e-mail už u nás patří jinému účtu → aplikace nabídne sloučení (merge)
        if (code === 'identity_already_exists' || code === 'email_exists' || code === 'user_already_exists') {
          throw Object.assign(new Error('Účet s tímto e-mailem už existuje.'), { code: 'ACCOUNT_EXISTS' });
        }
        throw new Error(e.msg || e.error_description || e.message || 'Přihlášení se nepovedlo.');
      }
      const j = await r.json();
      keep(j);
      return { email: (j.user && j.user.email) || null, switched };
    },
    // Sloučení účtů: existující účet (Google / Apple) se stane hlavním a data anonymního účtu z telefonu
    // se do něj přesunou. Lístek se vystaví ještě pod starým účtem (app_merge_ticket), po přihlášení se
    // pošle uživatel z telefonu (app_sync_family) a server přesune zbytek (app_merge_from).
    async merge(provider, idToken, nonce, S) {
      const ticket = await rpc('app_merge_ticket', {});
      const r = await fetch(`${URL_}/auth/v1/token?grant_type=id_token`, { method: 'POST', headers: headers(), body: JSON.stringify({ provider, id_token: idToken, nonce }) });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.msg || e.error_description || 'Přihlášení se nepovedlo.'); }
      const j = await r.json();
      keep(j);
      queue = queue.filter((x) => x.fn !== 'app_sync_family'); persist();
      await rpc('app_merge_from', { ticket });
      // profil z telefonu do hlavního účtu jen tehdy, když už je vyplněný (prázdný by smazal děti v účtu)
      if (S.onboarded && S.family.children.length) await rpc('app_sync_family', familyJob(S).args);
      return { email: (j.user && j.user.email) || null };
    },
    // odhlášení: zařízení dostane při dalším odeslání nový anonymní účet
    signOut() { set(SKEY, null); },
    // přímé volání s odpovědí (pohádka dne, odběr upozornění v app/daily.js); bez připojení vyhodí chybu
    call: (fn, args = {}) => rpc(fn, args),
    // „Smazat všechna data“: smaže rodinu i anonymní účet v databázi. Vrací true, když je na serveru smazáno
    // (nebo tam nic nebylo). false = server se neozval: přihlášení v telefonu ZŮSTÁVÁ, jinak by se k datům na serveru
    // už nikdo nedostal a nešla by smazat. Aplikace pak rodině řekne, ať to zkusí znovu s připojením.
    async forget() {
      if (get(SKEY)) {
        try { await rpc('app_delete_family', {}); } catch (e) {
          // přihlášení mezitím přestalo platit: zkusit jednou s obnoveným, teprve pak to vzdát
          try { await rpc('app_delete_family', {}); } catch (e2) { return false; }
        }
      }
      queue = []; persist(); set(SRC, null);
      set(SKEY, null);
      return true;
    },
  };
})();
