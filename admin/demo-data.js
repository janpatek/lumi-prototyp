// Ukázková data pro administraci. Žádné skutečné osoby: e-maily jsou na doméně example.cz
// a čísla vznikají z pevného semínka, takže se při každém načtení ukážou stejná.
// Až bude backend, nahradí se tenhle soubor voláním API se stejným tvarem dat.

(function () {
  const DAYS = 180;
  let seed = 20261107;
  const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const day0 = new Date(); day0.setHours(0, 0, 0, 0);
  const dayAt = (i) => { const d = new Date(day0); d.setDate(d.getDate() - (DAYS - 1 - i)); return d; };

  const TOWNS = [
    ['Praha', 'CZ'], ['Brno', 'CZ'], ['Ostrava', 'CZ'], ['Plzeň', 'CZ'], ['Olomouc', 'CZ'], ['Liberec', 'CZ'],
    ['České Budějovice', 'CZ'], ['Hradec Králové', 'CZ'], ['Benešov', 'CZ'], ['Kladno', 'CZ'], ['Tábor', 'CZ'],
    ['Zlín', 'CZ'], ['Jihlava', 'CZ'], ['Písek', 'CZ'], ['Říčany', 'CZ'], ['Kolín', 'CZ'],
    ['Bratislava', 'SK'], ['Košice', 'SK'], ['Žilina', 'SK'], ['Nitra', 'SK'], ['Trnava', 'SK'], ['Banská Bystrica', 'SK'],
  ];
  const SOURCES = ['Přímý přístup', 'Google', 'Instagram', 'Facebook', 'Doporučení', 'Seznam'];

  // Návštěvy: pozvolný růst, víkendy a večery silnější, dvě kampaně
  const visits = [];
  for (let i = 0; i < DAYS; i++) {
    const d = dayAt(i);
    const wk = [1.25, .9, .92, .95, 1, 1.12, 1.3][d.getDay()];
    const camp = (i > 70 && i < 82 ? 1.8 : 1) * (i > 140 && i < 150 ? 1.5 : 1);
    const base = 60 + i * 1.6;
    const landing = Math.round(base * wk * camp * (0.85 + rnd() * 0.3));
    const app = Math.round(landing * (0.38 + i / DAYS * 0.2) * (0.9 + rnd() * 0.2));
    visits.push({ date: d, landing, app });
  }

  // Rodiny: registrace sledují návštěvy aplikace
  const families = [];
  let n = 1;
  visits.forEach((v, i) => {
    const count = Math.round(v.app * (0.05 + rnd() * 0.03));
    for (let k = 0; k < count; k++) {
      const created = new Date(v.date); created.setHours(Math.floor(6 + rnd() * 17), Math.floor(rnd() * 60));
      const guest = rnd() < 0.28;
      const [town, country] = pick(TOWNS);
      const age = DAYS - i;
      const plays = Math.max(0, Math.round((rnd() * 2.2) * Math.min(age, 60) / 6 + rnd() * 3));
      const premiumChance = guest ? 0 : plays > 3 ? 0.22 : 0.04;
      const premium = rnd() < premiumChance ? (rnd() < 0.35 ? 'rok' : 'měsíc') : null;
      const lastSeen = new Date(created); lastSeen.setDate(lastSeen.getDate() + Math.floor(rnd() * Math.min(age, 45)));
      families.push({
        id: 'f' + String(n).padStart(4, '0'),
        email: guest ? null : `rodina.${String(n).padStart(4, '0')}@example.cz`,
        created,
        lastSeen: lastSeen > new Date() ? new Date() : lastSeen,
        kids: rnd() < 0.55 ? 1 : rnd() < 0.8 ? 2 : 3,
        town, country,
        premium,
        plays,
        source: pick(SOURCES),
      });
      n++;
    }
  });

  window.DEMO = { days: DAYS, visits, families: families.reverse(), sources: SOURCES };
})();
