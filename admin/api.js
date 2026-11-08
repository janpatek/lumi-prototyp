// Datová vrstva administrace. Dnes běží nad ukázkovými daty v paměti, ale má stejné rozhraní,
// jaké bude mít backend (Supabase / Postgres):
//  – seznamy vrací stránky { items, next, total } a pokračují kurzorem, nikdy se netahá celá tabulka,
//  – statistiky se čtou z předpočítaných agregátů (DEMO.daily, family_summary), ne ze surových událostí,
//  – detail rodiny se dopočítá až při otevření a drží se v malé LRU mezipaměti.
// Změny z administrace (tickety, poznámky, role, audit) se zatím ukládají jen do localStorage tohoto prohlížeče.

const API = (() => {
  const D = window.DEMO;
  const now = () => new Date();
  const ls = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* jen do obnovení stránky */ } },
  };
  const revive = (o) => JSON.parse(JSON.stringify(o), (k, v) => (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? new Date(v) : v));
  const fam = new Map(D.families.map((f) => [f.id, f]));

  // ---------- Role a oprávnění ----------
  const PERMS = {
    'families.read': 'Vidět rodiny a jejich statistiky',
    'families.pii': 'Vidět jména a e-maily',
    'families.edit': 'Upravovat rodiny, poznámky',
    'families.delete': 'Exportovat a mazat data rodin (GDPR)',
    'tickets.read': 'Číst helpdesk',
    'tickets.reply': 'Odpovídat a měnit tickety',
    'billing.read': 'Vidět předplatné a platby',
    'billing.refund': 'Vracet platby, dávat dárky',
    'content.edit': 'Upravovat pohádky',
    'analytics.read': 'Statistiky a přehledy',
    'ops.read': 'Provoz a náklady na hlas',
    'team.manage': 'Spravovat tým a role',
    'audit.read': 'Číst audit log',
  };
  const ALL = Object.keys(PERMS);
  const ROLES = {
    owner: { label: 'Vlastník', perms: ALL },
    support: { label: 'Podpora', perms: ['families.read', 'families.pii', 'families.edit', 'tickets.read', 'tickets.reply', 'billing.read', 'analytics.read'] },
    content: { label: 'Obsah', perms: ['content.edit', 'analytics.read', 'ops.read', 'tickets.read', 'families.read'] },
    analyst: { label: 'Analytik', perms: ['families.read', 'analytics.read', 'billing.read', 'ops.read'] },
    finance: { label: 'Účetní', perms: ['billing.read', 'billing.refund', 'families.read', 'families.pii', 'analytics.read'] },
  };
  const roleOver = ls.get('ospalek.admin.roles.v1', {});
  const staff = D.staff.map((s) => ({ ...s, role: roleOver[s.id] || s.role }));
  ls.get('ospalek.admin.invites.v1', []).forEach((s) => staff.push(revive(s)));
  const ME = staff[0];
  let viewAs = ls.get('ospalek.admin.viewAs', 'owner');
  const can = (p) => ROLES[viewAs]?.perms.includes(p);
  const staffName = (id) => staff.find((s) => s.id === id)?.name || id;

  // ---------- Audit ----------
  const liveAudit = revive(ls.get('ospalek.admin.audit.v1', []));
  function log(action, target, detail) {
    const e = { at: now(), actor: ME.id, action, target, detail, live: true };
    liveAudit.unshift(e); if (liveAudit.length > 500) liveAudit.length = 500;
    ls.set('ospalek.admin.audit.v1', liveAudit);
    bump('audit');
  }

  // ---------- Tickety (ukázková data + změny z tohoto prohlížeče) ----------
  const tPatch = ls.get('ospalek.admin.tickets.v1', { patch: {}, created: [] });
  const tickets = [...revive(tPatch.created), ...D.tickets.map((t) => ({ ...t, msgs: [...t.msgs] }))];
  const tById = new Map(tickets.map((t) => [t.id, t]));
  Object.entries(revive(tPatch.patch)).forEach(([id, p]) => {
    const t = tById.get(Number(id)); if (!t) return;
    const { addMsgs, ...rest } = p;
    Object.assign(t, rest); if (addMsgs) t.msgs.push(...addMsgs);
  });
  const saveT = (t, p, msg) => {
    const cur = tPatch.patch[t.id] || {};
    if (msg) cur.addMsgs = [...(cur.addMsgs || []), msg];
    Object.assign(cur, p);
    if (t.local) tPatch.created = tickets.filter((x) => x.local); else tPatch.patch[t.id] = cur;
    ls.set('ospalek.admin.tickets.v1', tPatch);
  };
  const OPEN = new Set(['new', 'open', 'waiting']);
  const TSTATUS = { new: 'Nový', open: 'Otevřený', waiting: 'Čeká na rodinu', solved: 'Vyřešený', closed: 'Uzavřený' };
  const TPRI = { urgent: 'Urgentní', high: 'Vysoká', normal: 'Normální', low: 'Nízká' };
  // SLA na první odpověď; u otevřených ticketů bez odpovědi běží odpočet
  function sla(t) {
    const due = new Date(t.created.getTime() + t.slaH * 36e5);
    if (t.firstResp) return { state: t.firstResp <= due ? 'ok' : 'breached', done: true, due, ms: t.firstResp - t.created };
    if (!OPEN.has(t.status)) return { state: 'ok', done: true, due, ms: null };
    const left = due - now();
    return { state: left < 0 ? 'breached' : left < t.slaH * 36e5 * 0.25 ? 'warn' : 'ok', done: false, due, left };
  }
  const VIEWS = {
    mine: { label: 'Moje otevřené', test: (t) => OPEN.has(t.status) && t.assignee === ME.id },
    unassigned: { label: 'Nepřiřazené', test: (t) => OPEN.has(t.status) && !t.assignee },
    open: { label: 'Všechny otevřené', test: (t) => OPEN.has(t.status) },
    breach: { label: 'SLA v ohrožení', test: (t) => OPEN.has(t.status) && sla(t).state !== 'ok' },
    waiting: { label: 'Čeká na rodinu', test: (t) => t.status === 'waiting' },
    gdpr: { label: 'Osobní údaje (GDPR)', test: (t) => t.cat === 'gdpr' && OPEN.has(t.status) },
    solved: { label: 'Vyřešené', test: (t) => !OPEN.has(t.status) },
    all: { label: 'Všechny', test: () => true },
  };
  const PRI_RANK = { urgent: 0, high: 1, normal: 2, low: 3 };

  // ---------- Šablony odpovědí ----------
  const DEFAULT_TPL = [
    { id: 't1', name: 'Pozdrav a poděkování', text: 'Ahoj {jmeno},\n\ndíky, že ses ozval(a). ' },
    { id: 't2', name: 'Vrácení platby', text: 'Ahoj {jmeno},\n\nplatbu ve výši {castka} jsme ti vrátili. Peníze uvidíš na účtu do 5 pracovních dnů. Omlouváme se za komplikace.\n\nTým Ospalek' },
    { id: 't3', name: 'Zrušení předplatného', text: 'Ahoj {jmeno},\n\npředplatné se ruší v nastavení obchodu ({obchod}) v sekci Předplatná. Pohádky ti zůstanou do konce zaplaceného období.\n\nTým Ospalek' },
    { id: 't4', name: 'Oprava výslovnosti jména', text: 'Ahoj {jmeno},\n\nupravili jsme, jak vypravěčka vyslovuje jméno {dite}, a pohádky přegenerovali. Dej prosím vědět, jestli teď všechno sedí.\n\nTým Ospalek' },
    { id: 't5', name: 'GDPR: export dat', text: 'Ahoj {jmeno},\n\nv příloze posíláme export všech údajů, které o vaší rodině máme (profil, děti, historie poslechu). Kdybys chtěl(a) cokoli smazat, stačí odpovědět.\n\nTým Ospalek' },
    { id: 't6', name: 'Potřebujeme víc informací', text: 'Ahoj {jmeno},\n\nabychom to mohli prověřit, pošli nám prosím typ telefonu, verzi aplikace (máš {verze}) a název pohádky, u které to nastává.\n\nTým Ospalek' },
  ];
  const tpls = ls.get('ospalek.admin.templates.v1', DEFAULT_TPL);
  function fillTpl(text, t) {
    const f = fam.get(t.fam) || {};
    const last = D.payments.find((p) => p.fam === t.fam && p.status !== 'selhala');
    return text.replace(/\{(\w+)\}/g, (m, k) => ({
      jmeno: (f.name || '').split(' ')[0] || '', dite: f.kids?.[0]?.name || '', obchod: { iOS: 'App Store', Android: 'Google Play', Web: 'účet na webu' }[f.platform] || '',
      verze: f.appVer || '', castka: last ? `${last.czk.toLocaleString('cs-CZ')} Kč` : '', ticket: `#${t.id}`,
    }[k] ?? m));
  }

  // ---------- Stránkování ----------
  // Výsledek dotazu se drží jako „snímek“ (jako serverový kurzor), další stránky ho jen krájí.
  // V Postgresu: WHERE (sort_key, id) < ($1, $2) ORDER BY sort_key DESC, id DESC LIMIT $3 (keyset pagination).
  const snap = new Map();
  const ver = { families: 0, tickets: 0, payments: 0, audit: 0 };
  const bump = (k) => { ver[k]++; };
  function snapshot(name, params, build) {
    const key = `${name}:${ver[name]}:${JSON.stringify(params)}`;
    let s = snap.get(key);
    if (!s) {
      const t0 = performance.now();
      s = { list: build(), ms: 0 }; s.ms = performance.now() - t0;
      snap.set(key, s);
      if (snap.size > 24) snap.delete(snap.keys().next().value);
    }
    return s;
  }
  function page(s, cursor, limit) {
    const start = cursor ? Number(cursor) : 0;
    const items = s.list.slice(start, start + limit);
    return { items, next: start + limit < s.list.length ? String(start + limit) : null, total: s.list.length, ms: s.ms };
  }
  const cmp = (key, dir) => (a, b) => { const x = key(a), y = key(b); return (x > y ? 1 : x < y ? -1 : 0) * dir; };
  const norm = (q) => D.deacc(q.trim());

  // ---------- Rodiny ----------
  const SEGMENTS = {
    all: { label: 'Všechny', test: () => true },
    paying: { label: 'Platící', test: (f) => f.status === 'active' || f.status === 'past_due' },
    trial: { label: 'Zkušební týden', test: (f) => f.status === 'trial' },
    risk: { label: 'Riziko odchodu', test: (f) => f.risk },
    fans: { label: 'Fanoušci', test: (f) => f.days30 >= 20 },
    dormant: { label: 'Usnulé (30+ dní)', test: (f) => (D.days - 1 - f.lastI) >= 30 },
    past_due: { label: 'Neuhrazená platba', test: (f) => f.status === 'past_due' },
    guests: { label: 'Hosté', test: (f) => !f.email },
  };
  const FSORT = {
    created: (f) => f.created, last: (f) => f.lastSeen, plays30: (f) => f.plays30, min30: (f) => f.min30, days30: (f) => f.days30,
    health: (f) => f.health, kids: (f) => f.kids.length, name: (f) => f.name || '~', town: (f) => f.town,
  };
  const actCache = new Map();
  const notes = ls.get('ospalek.admin.notes.v1', {});
  const deleted = new Set(ls.get('ospalek.admin.deleted.v1', []));

  // ---------- Platby ----------
  const refunds = new Set(ls.get('ospalek.admin.refunds.v1', []));
  D.payments.forEach((p) => { if (refunds.has(p.id)) p.status = 'vráceno'; });
  const promos = [...D.promos, ...revive(ls.get('ospalek.admin.promos.v1', []))];
  const gifts = revive(ls.get('ospalek.admin.gifts.v1', []));

  return {
    PERMS, ROLES, TSTATUS, TPRI, VIEWS, SEGMENTS, OPEN,
    me: ME, staff, staffName, can, log,
    get viewAs() { return viewAs; },
    setViewAs(r) { viewAs = r; ls.set('ospalek.admin.viewAs', r); },
    setRole(id, role) {
      const s = staff.find((x) => x.id === id); const old = s.role; s.role = role;
      roleOver[id] = role; ls.set('ospalek.admin.roles.v1', roleOver);
      log('team.role', s.name, `Role: ${ROLES[old].label} → ${ROLES[role].label}`);
    },
    invite(email, role) {
      const s = { id: 'i' + Date.now(), name: email.split('@')[0], email, role, twofa: false, last: null, invited: true };
      staff.push(s); ls.set('ospalek.admin.invites.v1', staff.filter((x) => x.invited));
      log('team.invite', email, `Pozvánka · ${ROLES[role].label}`);
    },
    families: {
      get: (id) => (deleted.has(id) ? null : fam.get(id)),
      list(p, cursor, limit = 100) {
        const s = snapshot('families', p, () => {
          const q = norm(p.q || ''), seg = SEGMENTS[p.seg || 'all'].test;
          const out = [];
          for (const f of D.families) {
            if (deleted.has(f.id) || !seg(f)) continue;
            if (p.country && p.country !== 'all' && f.country !== p.country) continue;
            if (p.platform && p.platform !== 'all' && f.platform !== p.platform) continue;
            if (q && !f.haystack.includes(q)) continue;
            out.push(f);
          }
          // výchozí řazení (nejnovější) už pole má, netřeba třídit
          if (p.sort && !(p.sort === 'created' && p.dir === -1)) out.sort(cmp(FSORT[p.sort], p.dir));
          return out;
        });
        return page(s, cursor, limit);
      },
      count: (seg) => D.families.reduce((n, f) => n + (!deleted.has(f.id) && SEGMENTS[seg].test(f) ? 1 : 0), 0),
      activity(id) {
        if (actCache.has(id)) return actCache.get(id);
        const a = D.familyDetail(fam.get(id));
        actCache.set(id, a); if (actCache.size > 30) actCache.delete(actCache.keys().next().value);
        return a;
      },
      note: (id) => notes[id] || '',
      setNote(id, text) { notes[id] = text; ls.set('ospalek.admin.notes.v1', notes); log('family.note', id, 'Interní poznámka'); },
      remove(id) { deleted.add(id); ls.set('ospalek.admin.deleted.v1', [...deleted]); bump('families'); log('family.delete', id, 'Smazání rodiny (GDPR, ukázka)'); },
      gift(id, months) {
        gifts.push({ fam: id, months, at: now() }); ls.set('ospalek.admin.gifts.v1', gifts);
        log('family.gift', id, `Dárek: ${months} ${months === 1 ? 'měsíc' : months < 5 ? 'měsíce' : 'měsíců'} předplatného`);
      },
      gifts: (id) => gifts.filter((g) => g.fam === id),
      payments: (id) => D.payments.filter((p) => p.fam === id),
      tickets: (id) => tickets.filter((t) => t.fam === id),
    },
    tickets: {
      get: (id) => tById.get(Number(id)),
      sla,
      list(p, cursor, limit = 200) {
        const s = snapshot('tickets', p, () => {
          const v = VIEWS[p.view || 'open'].test, q = norm(p.q || '');
          const out = tickets.filter((t) => v(t) && (!q || D.deacc(`#${t.id} ${t.subject} ${fam.get(t.fam)?.haystack || ''}`).includes(q)));
          // otevřené: nejdřív podle SLA a priority, uzavřené podle data
          if (p.view === 'solved' || p.view === 'all') out.sort((a, b) => b.updated - a.updated);
          else out.sort((a, b) => { const sa = sla(a), sb = sla(b); const da = sa.done ? Infinity : sa.left, db = sb.done ? Infinity : sb.left; return PRI_RANK[a.pri] - PRI_RANK[b.pri] || da - db || b.updated - a.updated; });
          return out;
        });
        return page(s, cursor, limit);
      },
      counts() {
        const c = {}; Object.keys(VIEWS).forEach((k) => { c[k] = 0; });
        tickets.forEach((t) => { for (const k in VIEWS) if (VIEWS[k].test(t)) c[k]++; });
        return c;
      },
      all: () => tickets,
      update(id, p) {
        const t = tById.get(id), changes = [];
        if (p.status && p.status !== t.status) { changes.push(`Stav: ${TSTATUS[t.status]} → ${TSTATUS[p.status]}`); if (!OPEN.has(p.status)) p.solvedAt = now(); }
        if (p.pri && p.pri !== t.pri) changes.push(`Priorita: ${TPRI[p.pri]}`);
        if ('assignee' in p && p.assignee !== t.assignee) changes.push(`Řeší: ${p.assignee ? staffName(p.assignee) : 'nikdo'}`);
        if (!changes.length) return;
        Object.assign(t, p, { updated: now() });
        saveT(t, p); bump('tickets');
        log('ticket.update', `#${id}`, changes.join(' · '));
      },
      reply(id, text, kind, after) {
        const t = tById.get(id);
        const msg = { from: kind, author: ME.name, at: now(), text };
        t.msgs.push(msg); t.updated = msg.at;
        const p = {};
        if (kind === 'agent') {
          if (!t.firstResp) { t.firstResp = msg.at; p.firstResp = msg.at; }
          if (!t.assignee) { t.assignee = ME.id; p.assignee = ME.id; }
          const st = after || 'waiting'; if (st !== t.status) { t.status = st; p.status = st; if (!OPEN.has(st)) { t.solvedAt = msg.at; p.solvedAt = msg.at; } }
        }
        saveT(t, p, msg); bump('tickets');
        log(kind === 'agent' ? 'ticket.reply' : 'ticket.note', `#${id}`, kind === 'agent' ? `Odpověď rodině${after === 'solved' ? ' a vyřešeno' : ''}` : 'Interní poznámka');
      },
      create({ famId, subject, text, pri, cat }) {
        const id = Math.max(...tickets.map((t) => t.id)) + 1;
        const f = fam.get(famId);
        const t = { id, local: true, fam: famId, subject, cat, pri, status: 'open', assignee: ME.id, channel: 'telefon', created: now(), updated: now(), firstResp: null, solvedAt: null, slaH: D.slaH[pri], csat: null, tags: [], msgs: [{ from: 'family', author: f?.name || 'Rodina', at: now(), text }] };
        tickets.unshift(t); tById.set(id, t); saveT(t, {}); bump('tickets');
        log('ticket.create', `#${id}`, subject);
        return t;
      },
      templates: () => tpls,
      saveTemplates(list) { tpls.splice(0, tpls.length, ...list); ls.set('ospalek.admin.templates.v1', tpls); log('ticket.templates', 'Šablony', `${list.length} šablon`); },
      fillTpl,
    },
    payments: {
      list(p, cursor, limit = 100) {
        const s = snapshot('payments', p, () => {
          const q = norm(p.q || '');
          return D.payments.filter((x) => (p.status === 'all' || !p.status || x.status === p.status) && (p.store === 'all' || !p.store || x.store === p.store) && (!q || x.id.includes(q) || (fam.get(x.fam)?.haystack || '').includes(q)));
        });
        return page(s, cursor, limit);
      },
      refund(pid) {
        const p = D.payments.find((x) => x.id === pid); p.status = 'vráceno';
        refunds.add(pid); ls.set('ospalek.admin.refunds.v1', [...refunds]); bump('payments');
        log('payment.refund', p.fam, `Vrácení ${p.czk.toLocaleString('cs-CZ')} Kč (${p.store}, ukázka)`);
      },
      promos: () => promos,
      addPromo(pr) { promos.push(pr); ls.set('ospalek.admin.promos.v1', promos.filter((x) => x.local)); log('promo.create', pr.code, pr.desc); },
    },
    audit: {
      list(p, cursor, limit = 100) {
        const s = snapshot('audit', p, () => {
          const q = norm(p.q || '');
          return [...liveAudit, ...D.audit].filter((e) => (!p.actor || p.actor === 'all' || e.actor === p.actor) && (!p.kind || p.kind === 'all' || e.action.startsWith(p.kind)) && (!q || D.deacc(`${e.target} ${e.detail} ${e.action}`).includes(q)));
        });
        return page(s, cursor, limit);
      },
    },
  };
})();
