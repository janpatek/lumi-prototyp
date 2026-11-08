// Ukázková data pro administraci. Žádné skutečné osoby: e-maily jsou na doméně example.cz,
// jména jsou náhodné kombinace a čísla vznikají z pevného semínka, takže se pokaždé ukážou stejná.
//
// Tvar dat odpovídá tomu, co bude vracet backend:
//  – families: souhrn rodiny (v databázi materializovaný pohled family_summary, přepočet v noci + při události),
//  – daily: denní agregáty za celou aplikaci (tabulka daily_stats), grafy nikdy nesčítají surové události,
//  – familyDetail(id): podrobná aktivita jedné rodiny, počítá se až při otevření detailu (endpoint /families/:id/activity).
// Ostrý režim (live-data.js) vrací stejný tvar dat ze Supabase; tyhle funkce se pak vůbec nevolají.
// Zátěžový test: admin/?zatez=20 vytvoří 20× víc rodin (cca 28 tisíc) a ukáže, jak se chovají tabulky.

window.makeDemo = function () {
  const DAYS = 180;
  const SCALE = Math.max(1, Math.min(50, Number(new URLSearchParams(location.search).get('zatez')) || 1));
  const mk = (s) => () => { s = (s + 0x6d2b79f5) | 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const rnd = mk(20261107);
  const pick = (a, r = rnd) => a[Math.floor(r() * a.length)];
  const day0 = new Date(); day0.setHours(0, 0, 0, 0);
  const dayAt = (i) => { const d = new Date(day0); d.setDate(d.getDate() - (DAYS - 1 - i)); return d; };
  const at = (i, h, m = 0) => { const d = dayAt(i); d.setHours(h, m); return d; };
  const NOW = Date.now();
  const deacc = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // pondělí prvního týdne, ať se týdny lámou stejně jako v grafech
  const W0 = (() => { const d = dayAt(0); return (d.getDay() + 6) % 7; })();
  const weekOf = (i) => Math.floor((i + W0) / 7);
  const WEEKS = weekOf(DAYS - 1) + 1;

  const TOWNS = [
    ['Praha', 'CZ'], ['Praha', 'CZ'], ['Brno', 'CZ'], ['Ostrava', 'CZ'], ['Plzeň', 'CZ'], ['Olomouc', 'CZ'], ['Liberec', 'CZ'],
    ['České Budějovice', 'CZ'], ['Hradec Králové', 'CZ'], ['Benešov', 'CZ'], ['Kladno', 'CZ'], ['Tábor', 'CZ'],
    ['Zlín', 'CZ'], ['Jihlava', 'CZ'], ['Písek', 'CZ'], ['Říčany', 'CZ'], ['Kolín', 'CZ'],
    ['Bratislava', 'SK'], ['Košice', 'SK'], ['Žilina', 'SK'], ['Nitra', 'SK'], ['Trnava', 'SK'], ['Banská Bystrica', 'SK'],
  ];
  const SOURCES = ['Přímý přístup', 'Google', 'Instagram', 'Facebook', 'Doporučení', 'Seznam'];
  const FIRST_F = ['Petra', 'Lucie', 'Jana', 'Kateřina', 'Tereza', 'Martina', 'Veronika', 'Barbora', 'Michaela', 'Eva', 'Lenka', 'Zuzana', 'Markéta', 'Kristýna'];
  const FIRST_M = ['Martin', 'Tomáš', 'Jakub', 'Petr', 'Jan', 'Lukáš', 'Ondřej', 'David', 'Michal', 'Filip'];
  const FIRST_SK = ['Zuzana', 'Katarína', 'Mária', 'Lucia', 'Peter', 'Martin', 'Jozef', 'Andrea'];
  const SURN = [['Novák', 'Nováková'], ['Svoboda', 'Svobodová'], ['Dvořák', 'Dvořáková'], ['Černý', 'Černá'], ['Procházka', 'Procházková'], ['Kučera', 'Kučerová'], ['Veselý', 'Veselá'], ['Horák', 'Horáková'], ['Němec', 'Němcová'], ['Marek', 'Marková'], ['Pokorný', 'Pokorná'], ['Pospíšil', 'Pospíšilová'], ['Hájek', 'Hájková'], ['Král', 'Králová'], ['Jelínek', 'Jelínková'], ['Růžička', 'Růžičková'], ['Beneš', 'Benešová'], ['Fiala', 'Fialová'], ['Sedláček', 'Sedláčková'], ['Doležal', 'Doležalová'], ['Zeman', 'Zemanová'], ['Kolář', 'Kolářová'], ['Navrátil', 'Navrátilová'], ['Čermák', 'Čermáková'], ['Urban', 'Urbanová'], ['Vaněk', 'Vaňková'], ['Blažek', 'Blažková'], ['Kříž', 'Křížová']];
  const SURN_SK = [['Kováč', 'Kováčová'], ['Horváth', 'Horváthová'], ['Varga', 'Vargová'], ['Tóth', 'Tóthová'], ['Baláž', 'Balážová'], ['Szabó', 'Szabová']];
  const KID_M = ['Toník', 'Jakub', 'Matyáš', 'Vojtěch', 'Adam', 'Ondra', 'Šimon', 'Filip', 'Kryštof', 'Matěj', 'Tobiáš', 'Štěpán', 'Max', 'Daniel', 'Samuel'];
  const KID_F = ['Eliška', 'Anna', 'Ema', 'Sofie', 'Viktorie', 'Natálie', 'Rozálie', 'Karolína', 'Adéla', 'Julie', 'Laura', 'Agáta', 'Bára', 'Klára', 'Marie'];
  const PLATFORMS = [['iOS', 0.46], ['Android', 0.39], ['Web', 0.15]];
  const VERSIONS = { iOS: ['1.4.2', '1.4.2', '1.4.1', '1.3.0'], Android: ['1.4.2', '1.4.1', '1.4.1', '1.3.0'], Web: ['web'] };
  const weighted = (pairs, r = rnd) => { let x = r(); for (const [v, w] of pairs) { if ((x -= w) < 0) return v; } return pairs[pairs.length - 1][0]; };

  // Pohádky: skutečný katalog z app/stories.cs.js, délky jsou plánované produkční (5–15 min)
  const CAT_IDS = ['noc', 'auto', 'dobro', 'zivot'];
  const LEN = { hvezdicka: 9, vyprava: 11, hadanky: 7, drak: 12, lednice: 8, zubar: 10 };
  const STORIES = (window.STORIES || []).map((s) => ({ id: s.id, free: !!s.free, cat: s.cats[0], min: LEN[s.id] || 9 }));
  const CHARS_PER_MIN = 740; // test ElevenLabs: 1 292 znaků ≈ 1:45 audia
  const DONE_P = { noc: 0.88, auto: 0.66, dobro: 0.74, zivot: 0.81 };
  // kdy se poslouchá: na dobrou noc večer, do auta přes den a o víkendu
  const HOURS = {
    noc: [[19, 0.24], [20, 0.36], [21, 0.2], [18, 0.08], [13, 0.06], [22, 0.06]],
    auto: [[8, 0.12], [10, 0.16], [11, 0.12], [14, 0.14], [16, 0.18], [17, 0.16], [9, 0.12]],
    dobro: [[10, 0.12], [15, 0.16], [17, 0.18], [18, 0.2], [19, 0.22], [16, 0.12]],
    zivot: [[7, 0.12], [17, 0.18], [18, 0.22], [19, 0.3], [20, 0.18]],
  };
  const ARCH = { fan: { p: 0.78, lam: 2.1, life: [60, 400] }, regular: { p: 0.42, lam: 1.5, life: [30, 300] }, casual: { p: 0.16, lam: 1.2, life: [8, 120] }, tried: { p: 0.5, lam: 1.3, life: [0, 4] } };

  // ---------- Návštěvy ----------
  const visits = [];
  for (let i = 0; i < DAYS; i++) {
    const d = dayAt(i);
    const wk = [1.25, 0.9, 0.92, 0.95, 1, 1.12, 1.3][d.getDay()];
    const camp = (i > 70 && i < 82 ? 1.8 : 1) * (i > 140 && i < 150 ? 1.5 : 1);
    const base = 60 + i * 1.6;
    const landing = Math.round(base * wk * camp * (0.85 + rnd() * 0.3) * SCALE);
    const app = Math.round(landing * (0.38 + (i / DAYS) * 0.2) * (0.9 + rnd() * 0.2));
    visits.push({ date: d, landing, app });
  }

  // ---------- Denní agregáty (daily_stats) ----------
  const z = () => new Float64Array(DAYS);
  const daily = { plays: z(), minutes: z(), dau: z(), done: z(), genChars: z(), cacheHits: z(), mrr: z(), subs: z(), trials: z(), cat: Object.fromEntries(CAT_IDS.map((c) => [c, z()])) };
  const wau = new Float64Array(WEEKS);
  const heat = new Float64Array(7 * 24); // den v týdnu (po = 0) × hodina
  const storyAgg = Object.fromEntries(STORIES.map((s) => [s.id, { plays: 0, done: 0, minutes: 0, families: 0, gens: 0 }]));
  const cohorts = Array.from({ length: WEEKS }, () => ({ size: 0, active: new Float64Array(WEEKS) }));

  // Simulace aktivity jedné rodiny. Stejné semínko = stejný výsledek, proto se dá zopakovat pro detail.
  function simulate(f, collect) {
    const r = mk(f.seed);
    const a = ARCH[f.arch];
    const cats = f.catW;
    const out = { plays: 0, minutes: 0, days: 0, plays30: 0, min30: 0, days30: 0, last: f.ci, cat: [0, 0, 0, 0], story: {}, hero: f.kids.map(() => 0), done: 0, hours: new Float64Array(24), weeks: new Set() };
    const series = collect ? { plays: new Uint16Array(DAYS), minutes: new Float32Array(DAYS), events: [] } : null;
    let seen = 0; // bitová maska pohádek, které už rodina slyšela (první přehrání = generování hlasu)
    for (let i = f.ci; i <= f.endI; i++) {
      if (i !== f.ci && r() > a.p * (i >= f.subI && f.subI >= 0 ? 1.15 : 1)) continue;
      const k = 1 + Math.floor(r() * a.lam * 1.25);
      out.days++; out.last = i; out.weeks.add(weekOf(i));
      if (i > DAYS - 31) out.days30++;
      if (!collect) daily.dau[i]++;
      for (let j = 0; j < k; j++) {
        const cat = weighted(cats, r);
        const paid = f.subI >= 0 && i >= f.subI && (f.subEnd < 0 || i <= f.subEnd);
        const pool = STORIES.filter((s) => (paid || s.free));
        const inCat = pool.filter((s) => s.cat === cat);
        const st = pick(inCat.length ? inCat : pool, r);
        const done = r() < DONE_P[st.cat];
        const min = done ? st.min : st.min * (0.15 + r() * 0.7);
        const hour = weighted(HOURS[st.cat], r);
        const si = STORIES.indexOf(st);
        const first = !(seen & (1 << si)); seen |= 1 << si;
        const hero = Math.floor(r() * f.kids.length);
        out.plays++; out.minutes += min; out.cat[CAT_IDS.indexOf(st.cat)] += min; out.hero[hero]++; out.hours[hour]++;
        out.story[st.id] = (out.story[st.id] || 0) + 1;
        if (done) out.done++;
        if (i > DAYS - 31) { out.plays30++; out.min30 += min; }
        if (collect) {
          series.plays[i]++; series.minutes[i] += min;
          series.events.push({ i, hour, story: st.id, min, done, hero });
        } else {
          daily.plays[i]++; daily.minutes[i] += min; daily.cat[st.cat][i]++;
          if (done) daily.done[i]++;
          if (first) daily.genChars[i] += st.min * CHARS_PER_MIN; else daily.cacheHits[i]++;
          heat[((dayAt(i).getDay() + 6) % 7) * 24 + hour]++;
          const sa = storyAgg[st.id]; sa.plays++; sa.minutes += min; if (done) sa.done++;
          if (first) { sa.families++; sa.gens++; }
        }
      }
    }
    return collect ? { ...out, series } : out;
  }

  // ---------- Rodiny ----------
  const families = [];
  let n = 1;
  visits.forEach((v, ci) => {
    const count = Math.round(v.app * (0.05 + rnd() * 0.03));
    for (let k = 0; k < count; k++) {
      const guest = rnd() < 0.28;
      const [town, country] = pick(TOWNS);
      const sk = country === 'SK';
      const fem = rnd() < 0.78;
      const first = sk ? pick(FIRST_SK) : pick(fem ? FIRST_F : FIRST_M);
      const sur = pick(sk ? SURN_SK : SURN)[/a$/.test(first) || first === 'Mária' ? 1 : 0];
      const id = 'f' + String(n).padStart(5, '0');
      const kidsN = rnd() < 0.55 ? 1 : rnd() < 0.8 ? 2 : 3;
      const kids = [];
      for (let k = 0; k < kidsN; k++) { const g = rnd() < 0.5 ? 'm' : 'f'; let name = pick(g === 'm' ? KID_M : KID_F); if (kids.some((x) => x.name === name)) name = (g === 'm' ? KID_M : KID_F)[(KID_M.indexOf(name) + KID_F.indexOf(name) + 3 + k) % 15]; kids.push({ name, g, age: 2 + Math.floor(rnd() * 7) }); }
      const arch = weighted([['fan', 0.14], ['regular', 0.3], ['casual', 0.34], ['tried', 0.22]]);
      const A = ARCH[arch];
      const life = Math.round(A.life[0] + rnd() ** 1.6 * (A.life[1] - A.life[0]));
      const platform = weighted(PLATFORMS);
      // preference kategorií: každá rodina má svou oblíbenou
      const fav = weighted([['noc', 0.5], ['auto', 0.2], ['dobro', 0.18], ['zivot', 0.12]]);
      const catW = CAT_IDS.map((c) => [c, c === fav ? 0.55 : 0.15]);
      // předplatné: zkušební týden, pak jediný tarif (měsíční, 129 Kč za celou rodinu); fanoušci kupují častěji
      // (rnd() u tarifu zůstává, aby se nerozhodila posloupnost náhodných čísel a data zůstala stejná)
      const wantP = guest ? 0 : { fan: 0.62, regular: 0.34, casual: 0.08, tried: 0.01 }[arch];
      let subI = -1, subEnd = -1, plan = null, status = null, trialI = -1, failed = false;
      if (rnd() < wantP) {
        trialI = Math.min(DAYS - 1, ci + Math.floor(rnd() * 6));
        if (trialI + 7 > DAYS - 1) { status = 'trial'; rnd(); plan = 'měsíc'; }
        else if (rnd() < 0.64) {
          subI = trialI + 7; rnd(); plan = 'měsíc'; status = 'active';
          for (let m = subI + 30; m < DAYS; m += 30) if (rnd() < 0.07) { subEnd = m; status = 'canceled'; break; }
          if (status === 'active' && rnd() < 0.035) { status = 'past_due'; failed = true; }
        } else status = 'expired';
      }
      if (!guest && !plan && rnd() < 0.012) { plan = 'dárek'; status = 'active'; subI = ci; }
      const paying = status === 'active' || status === 'past_due' || status === 'trial';
      const endI = Math.min(DAYS - 1, ci + (paying && rnd() < 0.85 ? DAYS : life));
      const base = first.toLowerCase();
      const f = {
        id, n, seed: 7919 * n + 13,
        email: guest ? null : `${deacc(base)}.${deacc(sur)}${n % 97}@example.cz`,
        name: guest ? null : `${first} ${sur}`,
        created: new Date(Math.min(NOW - 6e5, at(ci, Math.floor(6 + rnd() * 17), Math.floor(rnd() * 60)))), ci,
        town, country, source: pick(SOURCES), platform, appVer: pick(VERSIONS[platform]),
        kids, arch, catW, endI, fav,
        plan, status, trialI, subI, subEnd, failed,
        premium: paying ? plan : null,
        tags: [],
      };
      const s = simulate(f, false);
      f.plays = s.plays; f.minutes = s.minutes; f.days = s.days; f.plays30 = s.plays30; f.min30 = s.min30; f.days30 = s.days30;
      f.lastSeen = at(s.last, 19, 30); if (f.lastSeen > NOW) f.lastSeen = new Date(NOW - 3e5); if (f.lastSeen < f.created) f.lastSeen = f.created;
      f.lastI = s.last;
      f.favCat = CAT_IDS[s.cat.indexOf(Math.max(...s.cat))];
      // zdraví účtu 0–100: jak často poslouchají teď proti tomu, jak dlouho jsou s námi
      const idle = DAYS - 1 - s.last;
      f.health = Math.max(0, Math.min(100, Math.round(25 + f.days30 * 3.2 + Math.min(20, f.plays30) - idle * 1.6 + (paying ? 8 : 0))));
      f.risk = paying && idle >= 10;
      if (f.days30 >= 20) f.tags.push('fanoušek');
      if (f.risk) f.tags.push('riziko odchodu');
      if (status === 'trial') f.tags.push('zkušební');
      // kohortní retence po týdnech
      const cw = weekOf(ci); cohorts[cw].size++;
      s.weeks.forEach((w) => { cohorts[cw].active[w - cw]++; wau[w]++; });
      f.haystack = deacc([id, f.email, f.name, town, ...kids.map((x) => x.name)].filter(Boolean).join(' '));
      families.push(f);
      n++;
    }
  });

  // ---------- Předplatné a platby ----------
  // ceník od 8. 11. 2026: jen měsíční předplatné 129 Kč; cena pro Slovensko zatím neurčená, 4,99 € je předpoklad
  const PRICE = { CZ: 129, SK: 4.99 };
  const EUR = 25; // pevný kurz pro ukázku
  const STORE = { iOS: 'App Store', Android: 'Google Play', Web: 'Stripe' };
  const fee = (store, czk) => (store === 'Stripe' ? Math.round((czk * 0.015 + 6.5) * 100) / 100 : Math.round(czk * 0.15 * 100) / 100);
  const payments = [];
  const mrrDiff = new Float64Array(DAYS + 1), subDiff = new Float64Array(DAYS + 1);
  let pn = 1;
  families.forEach((f) => {
    if (f.status === 'trial') { for (let i = f.trialI; i < DAYS; i++) daily.trials[i]++; }
    if (f.subI < 0 || f.plan === 'dárek') {
      if (f.plan === 'dárek') { subDiff[f.subI]++; subDiff[DAYS]--; }
      return;
    }
    const cur = f.country === 'SK' ? 'EUR' : 'CZK';
    const amt = PRICE[f.country];
    const czk = cur === 'EUR' ? Math.round(amt * EUR * 100) / 100 : amt;
    const store = STORE[f.platform];
    const step = 30;
    const end = f.subEnd >= 0 ? f.subEnd : DAYS;
    const monthly = czk;
    mrrDiff[f.subI] += monthly; mrrDiff[end] -= monthly;
    subDiff[f.subI]++; subDiff[end]--;
    for (let i = f.subI; i < end; i += step) {
      const last = i + step >= end;
      const st = f.failed && last ? 'selhala' : rnd() < 0.012 ? 'vráceno' : 'zaplaceno';
      payments.push({ id: 'p' + String(pn++).padStart(6, '0'), fam: f.id, at: at(i, Math.floor(rnd() * 24), Math.floor(rnd() * 60)), store, plan: f.plan, cur, amount: amt, czk, fee: st === 'selhala' ? 0 : fee(store, czk), status: st });
    }
  });
  let m = 0, sc = 0;
  for (let i = 0; i < DAYS; i++) { m += mrrDiff[i]; sc += subDiff[i]; daily.mrr[i] = m; daily.subs[i] = sc; }
  payments.sort((a, b) => b.at - a.at);

  const VOUCHERS = [];
  for (let i = 0; i < 24; i++) {
    const code = 'DAREK-' + Math.floor(rnd() * 0xfffff).toString(16).toUpperCase().padStart(5, '0');
    const sold = at(Math.floor(40 + rnd() * (DAYS - 41)), 10 + Math.floor(rnd() * 10));
    VOUCHERS.push({ code, kind: rnd() < 0.7 ? '12 měsíců' : '3 měsíce', sold, buyer: `darce.${i + 1}@example.cz`, redeemed: rnd() < 0.6 ? families[Math.floor(rnd() * families.length)].id : null });
  }
  const PROMOS = [
    { code: 'INSTAGRAM20', desc: '20 % na 12 měsíců', uses: Math.round(41 * SCALE), limit: null, until: dayAt(DAYS - 1 + 30) },
    { code: 'SKOLKA', desc: 'Měsíc zdarma pro rodiče ze školek', uses: Math.round(17 * SCALE), limit: 200, until: dayAt(DAYS - 1 + 60) },
    { code: 'MIKULAS', desc: '2 měsíce za cenu jednoho', uses: 0, limit: null, until: dayAt(DAYS - 1 + 40) },
  ];

  // ---------- Tým ----------
  const STAFF = [
    { id: 'u1', name: 'Jan', role: 'owner', email: 'jan@example.cz', twofa: true, last: new Date(NOW - 6e5) },
    { id: 'u2', name: 'Klára D.', role: 'support', email: 'klara@example.cz', twofa: true, last: new Date(NOW - 36e5 * 2) },
    { id: 'u3', name: 'Ondřej M.', role: 'support', email: 'ondrej@example.cz', twofa: false, last: new Date(NOW - 36e5 * 20) },
    { id: 'u4', name: 'Tereza H.', role: 'content', email: 'tereza@example.cz', twofa: true, last: new Date(NOW - 36e5 * 49) },
    { id: 'u5', name: 'Martin B.', role: 'analyst', email: 'martin@example.cz', twofa: true, last: new Date(NOW - 36e5 * 100) },
    { id: 'u6', name: 'Eva K.', role: 'finance', email: 'eva@example.cz', twofa: false, last: new Date(NOW - 36e5 * 170) },
  ];

  // ---------- Helpdesk ----------
  const SLA_H = { urgent: 2, high: 8, normal: 24, low: 72 };
  const SCEN = [
    { cat: 'platby', pri: 'high', s: 'Strhla se mi platba dvakrát', t: 'Dobrý den, v bance vidím dvě platby za předplatné ve stejný den. Můžete to prosím prověřit?', r: 'Ahoj, díky za upozornění. Druhou platbu jsme ti vrátili, peníze uvidíš na účtu do 5 pracovních dnů. Omlouváme se.' },
    { cat: 'platby', pri: 'normal', s: 'Jak zruším předplatné?', t: 'Chtěla bych zrušit předplatné, ale nevím, kde to v aplikaci najdu.', r: 'Ahoj, předplatné se ruší v nastavení obchodu (App Store nebo Google Play) v sekci Předplatná. Kdyby něco nešlo, napiš.' },
    { cat: 'platby', pri: 'normal', s: 'Předplatné zrušené, ale platba přišla', t: 'Předplatné jsem rušil minulý týden a dnes mi stejně přišla platba.', r: 'Ahoj, podívali jsme se na to. Zrušení se propsalo až po obnovení, platbu ti proto vracíme celou.' },
    { cat: 'prehravani', pri: 'high', s: 'Pohádka se zasekne v polovině', t: 'Pohádka o drakovi se vždycky v půlce zastaví a dál nejde. Zkoušeli jsme to několikrát.', r: 'Ahoj, díky za popis. Našli jsme chybu v uložené nahrávce a vygenerovali ji znovu. Zkus to prosím teď.' },
    { cat: 'prehravani', pri: 'normal', s: 'V autě bez signálu nejde přehrát', t: 'Na dálnici nám vypadl signál a pohádka do auta přestala hrát. Dá se stáhnout dopředu?', r: 'Ahoj, offline režim chystáme. Zatím pomůže pustit pohádku jednou doma na wifi, pak se načte z mezipaměti.' },
    { cat: 'hlas', pri: 'normal', s: 'Vypravěčka špatně vyslovuje jméno', t: 'Naše dcera se jmenuje Rozálie a vypravěčka to čte s divným přízvukem. Jde to opravit?', r: 'Ahoj, upravili jsme výslovnost jména a pohádky přegenerovali. Dej vědět, jestli to teď sedí.' },
    { cat: 'hlas', pri: 'low', s: 'Jméno je ve špatném pádu', t: 'V pohádce o hvězdičce je „s Matěj“ místo „s Matějem“. Asi chyba?', r: 'Ahoj, máš pravdu. V nastavení dítěte jde pády jména upravit, my jsme to opravili za tebe.' },
    { cat: 'ucet', pri: 'normal', s: 'Nemůžu se přihlásit přes Apple', t: 'Po přeinstalování aplikace mě přihlášení přes Apple hodí na prázdnou obrazovku.', r: 'Ahoj, šlo o chybu ve verzi 1.4.1, oprava je ve verzi 1.4.2. Po aktualizaci by přihlášení mělo fungovat.' },
    { cat: 'ucet', pri: 'low', s: 'Chci přidat babičku do účtu', t: 'Babička by ráda pouštěla pohádky na svém telefonu. Jde to se stejným předplatným?', r: 'Ahoj, ano. Babička se přihlásí stejným účtem a předplatné platí i u ní.' },
    { cat: 'obsah', pri: 'low', s: 'Přání: pohádka o nočníku', t: 'Řešíme nočník a moc by se nám hodila pohádka na tohle téma. Plánujete něco?', r: 'Ahoj, skvělý tip, přidali jsme ho do plánu pohádek Ze života.' },
    { cat: 'obsah', pri: 'low', s: 'Pohádka o zubaři pomohla!', t: 'Jen jsem chtěla poděkovat, syn po pohádce o zubaři šel k zubaři úplně v klidu.', r: 'Ahoj, to nás moc těší! Díky, že jsi napsala.' },
    { cat: 'gdpr', pri: 'high', s: 'Žádost o smazání všech dat', t: 'Prosím o smazání účtu a všech údajů o mých dětech.', r: 'Ahoj, účet i údaje o dětech jsme smazali. Potvrzení ti přijde e-mailem.' },
    { cat: 'gdpr', pri: 'high', s: 'Export údajů o dětech', t: 'Chci vědět, jaké údaje o dětech u vás máte. Pošlete mi je prosím.', r: 'Ahoj, export všech údajů najdeš v příloze. Obsahuje profil rodiny, děti a historii poslechu.' },
    { cat: 'chyba', pri: 'urgent', s: 'Aplikace spadne po aktualizaci', t: 'Po poslední aktualizaci na Androidu aplikace hned po spuštění spadne.', r: 'Ahoj, opravu jsme vydali ve verzi 1.4.2. Po aktualizaci by to mělo být v pořádku.' },
  ];
  const TICKET_CATS = { platby: 'Platby', prehravani: 'Přehrávání', hlas: 'Hlas a výslovnost', ucet: 'Účet a přihlášení', obsah: 'Obsah a přání', gdpr: 'Osobní údaje (GDPR)', chyba: 'Chyba aplikace' };
  const tickets = [];
  const withEmail = families.filter((f) => f.email);
  const tCount = Math.round(withEmail.length * 0.11);
  const agents = ['u2', 'u3', 'u2', 'u1'];
  for (let i = 0; i < tCount; i++) {
    const f = withEmail[Math.floor(rnd() * withEmail.length)];
    const sc2 = weighted(SCEN.map((x) => [x, 1 / SCEN.length]));
    // novější tickety častěji, posledních pár hodin vždy něco čeká
    const ageH = i < 8 ? rnd() * 10 : Math.min((DAYS - 1 - f.ci) * 24, (rnd() ** 2.2) * 24 * 90);
    const created = new Date(NOW - ageH * 36e5);
    if (created < f.created) continue;
    const pri = sc2.pri === 'normal' && rnd() < 0.15 ? 'high' : sc2.pri;
    const answered = ageH > SLA_H[pri] * 0.6 ? rnd() < 0.96 : rnd() < 0.35;
    const respH = SLA_H[pri] * (rnd() < 0.86 ? rnd() * 0.9 : 1 + rnd() * 1.5);
    const firstResp = answered && respH < ageH ? new Date(created.getTime() + respH * 36e5) : null;
    let status = 'new';
    if (firstResp) {
      const age = ageH / 24;
      status = age > 6 ? (rnd() < 0.7 ? 'closed' : 'solved') : age > 2 ? weighted([['solved', 0.55], ['waiting', 0.25], ['open', 0.2]]) : weighted([['waiting', 0.5], ['open', 0.3], ['solved', 0.2]]);
    } else if (ageH > 1 && rnd() < 0.4) status = 'open';
    const assignee = status === 'new' && rnd() < 0.7 ? null : pick(agents);
    const msgs = [{ from: 'family', author: f.name, at: created, text: sc2.t }];
    if (rnd() < 0.3) msgs.push({ from: 'note', author: STAFF.find((x) => x.id === (assignee || 'u2')).name, at: new Date(created.getTime() + respH * 0.5 * 36e5), text: pick(['Ověřit v RevenueCat.', 'Stejný problém hlásili i další dva lidé.', 'Rodina je předplatitel od začátku, vyjít vstříc.', 'Předat Tereze kvůli obsahu.']) });
    if (firstResp) msgs.push({ from: 'agent', author: STAFF.find((x) => x.id === (assignee || 'u2')).name, at: firstResp, text: sc2.r });
    if (status === 'waiting' || (firstResp && rnd() < 0.3 && status !== 'new')) {
      const t2 = new Date(firstResp.getTime() + (0.5 + rnd() * 20) * 36e5);
      if (t2 < NOW && status !== 'waiting') { msgs.push({ from: 'family', author: f.name, at: t2, text: pick(['Děkuju, už to funguje.', 'Super, díky moc!', 'Pořád to nejde, zkoušela jsem to znovu.']) }); }
    }
    const solvedAt = status === 'solved' || status === 'closed' ? new Date(Math.min(NOW - 36e5, (firstResp || created).getTime() + rnd() * 48 * 36e5)) : null;
    tickets.push({
      id: 0, fam: f.id, subject: sc2.s, cat: sc2.cat, pri, status, assignee,
      channel: weighted([['e-mail', 0.55], ['aplikace', 0.35], ['Instagram', 0.1]]),
      created, updated: msgs[msgs.length - 1].at, firstResp, solvedAt, slaH: SLA_H[pri],
      csat: solvedAt && rnd() < 0.55 ? weighted([[5, 0.62], [4, 0.24], [3, 0.08], [2, 0.04], [1, 0.02]]) : null,
      msgs, tags: rnd() < 0.2 ? ['opakovaný'] : [],
    });
  }
  tickets.sort((a, b) => a.created - b.created).forEach((t, i) => { t.id = 1001 + i; });
  tickets.reverse();

  // ---------- Audit (vygenerovaná historie, nové záznamy přidává administrace) ----------
  const audit = [];
  tickets.slice(0, 160).forEach((t) => {
    if (t.firstResp) audit.push({ at: t.firstResp, actor: t.assignee || 'u2', action: 'ticket.reply', target: `#${t.id}`, detail: 'Odpověď rodině' });
    if (t.solvedAt) audit.push({ at: t.solvedAt, actor: t.assignee || 'u2', action: 'ticket.status', target: `#${t.id}`, detail: 'Stav: vyřešeno' });
  });
  payments.filter((p) => p.status === 'vráceno').slice(0, 30).forEach((p) => audit.push({ at: new Date(p.at.getTime() + 864e5), actor: 'u6', action: 'payment.refund', target: p.fam, detail: `Vrácení ${p.czk.toLocaleString('cs-CZ')} Kč (${p.store})` }));
  for (let i = 0; i < 90; i++) {
    const who = pick(STAFF);
    audit.push({ at: new Date(NOW - rnd() * 30 * 864e5), actor: who.id, action: 'auth.login', target: who.name, detail: `Přihlášení · ${pick(['Chrome, macOS', 'Safari, iOS', 'Firefox, Windows'])}` });
  }
  [['story.edit', 'zubar', 'Úprava textu pohádky'], ['story.edit', 'drak', 'Nová obálka'], ['family.export', 'f00042', 'Export údajů rodiny (GDPR)'], ['family.delete', 'f00117', 'Smazání rodiny na žádost (GDPR)'], ['team.role', 'Ondřej M.', 'Role: podpora'], ['promo.create', 'SKOLKA', 'Nový kód']].forEach(([action, target, detail], i) => {
    audit.push({ at: new Date(NOW - (i * 4 + 1.3) * 864e5), actor: action.startsWith('story') ? 'u4' : 'u1', action, target, detail });
  });
  audit.sort((a, b) => b.at - a.at);

  // ---------- Hlas: fronta generování (poslední úlohy) ----------
  const ttsJobs = [];
  for (let i = 0; i < 40; i++) {
    const f = families[Math.floor(rnd() * Math.min(families.length, 300))];
    const st = pick(STORIES);
    const status = i < 2 ? 'běží' : rnd() < 0.06 ? 'selhalo' : 'hotovo';
    ttsJobs.push({ id: 'j' + (9000 - i), fam: f.id, story: st.id, chars: Math.round(st.min * CHARS_PER_MIN * (0.9 + rnd() * 0.2)), at: new Date(NOW - i * (8 + rnd() * 30) * 6e4), ms: status === 'hotovo' ? Math.round(9000 + rnd() * 25000) : null, status, err: status === 'selhalo' ? pick(['429 Too Many Requests', 'Časový limit 60 s', '503 od ElevenLabs']) : null });
  }

  return {
    days: DAYS, scale: SCALE, visits, families: families.reverse(), sources: SOURCES, daily, wau, heat, cohorts, weekOf, WEEKS, dayAt,
    stories: STORIES, storyAgg, catIds: CAT_IDS, charsPerMin: CHARS_PER_MIN,
    payments, vouchers: VOUCHERS, promos: PROMOS, eur: EUR,
    staff: STAFF, tickets, ticketCats: TICKET_CATS, slaH: SLA_H, audit, ttsJobs,
    familyDetail: (f) => simulate(f, true),
    deacc,
  };
};
