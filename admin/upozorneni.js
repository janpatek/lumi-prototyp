// ---------- Pohádka dne a večerní upozornění ----------
// Ostrá data: nastavení, plán a historie v Supabase (admin_push, admin_push_save, admin_daily_set), zkoušku posílá
// push-worker (POST /test) na zařízení přihlášeného člena týmu. Ukázková data: vše jen v tomhle prohlížeči a zkouška
// je místní upozornění bez serveru. Spravuje vlastník a role Obsah (push.manage), v databázi hlídá require_push.

const PUSH_START = Date.UTC(2026, 0, 5); // začátek střídání, stejný jako daily_pick v databázi a app/daily.js
const PUSH_DEF = { enabled: true, hour: 19, title: 'Je čas na pohádku 🌙', body: 'Čeká na vás pohádka „{pohadka}“.', rotation: null };
const PUSHS = { state: 'idle', data: null, err: '', busy: false };

// ukázková data: stejný tvar jako admin_push z databáze
const pushDemo = (() => {
  const K = 'ospalek.admin.push.v1';
  const st = () => store.get(K) || { settings: { ...PUSH_DEF, rotation: STORIES.map((s) => s.id) }, plan: {}, log: [] };
  const put = (x) => store.set(K, x);
  const subsN = Math.round(D.families.length * 0.42);
  const pick = (x, day) => x.plan[day] || rotPick(x.settings.rotation, day);
  return {
    load: async () => {
      const x = st(), today = iso(TODAY);
      const plan = Array.from({ length: 28 }, (_, i) => { const day = iso(addDays(TODAY, i)); return { day, story: pick(x, day), manual: !!x.plan[day], by: x.plan[day] ? API.me.name : null }; });
      // vymyšlená historie: posledních 14 večerů
      const log = x.log.concat(Array.from({ length: 14 }, (_, i) => {
        const d = addDays(TODAY, -i - 1); d.setHours(x.settings.hour, 0, 4);
        const t = subsN - i * 3, f = Math.round(t * 0.02);
        return { id: 1000 - i, day: iso(d), kind: 'daily', story_id: pick(x, iso(d)), title: x.settings.title, body: x.settings.body, started_at: d.toISOString(), finished_at: d.toISOString(), targets: t, ok: t - f, failed: f, removed: Math.round(f / 2) };
      }));
      return { today, settings: x.settings, plan, log, subs: { total: subsN, web: subsN, ios: 0, android: 0, reached7: subsN - 5, mine: 0, new7: 11 } };
    },
    save: async (p) => { const x = st(); Object.assign(x.settings, p); put(x); },
    setDay: async (day, story) => { const x = st(); if (story) x.plan[day] = story; else delete x.plan[day]; put(x); },
    test: async (msg) => {
      const x = st();
      x.log.unshift({ id: Date.now(), day: iso(TODAY), kind: 'test', story_id: msg.story, title: msg.title, body: msg.body, started_at: new Date().toISOString(), finished_at: new Date().toISOString(), targets: 1, ok: 1, failed: 0, removed: 0, actor: API.me.name });
      put(x);
    },
  };
})();
const pushApi = () => D.push || pushDemo;

function rotPick(rotation, day) {
  const r = rotation && rotation.length ? rotation : STORIES.map((s) => s.id);
  const n = Math.round((Date.parse(day + 'T00:00:00Z') - PUSH_START) / 864e5);
  return r[((n % r.length) + r.length) % r.length];
}
const storyById = (id) => STORIES.find((s) => s.id === id);
const storyName = (id) => { const s = storyById(id); return s ? safeTitle(s) : `${id} (není v seznamu pohádek)`; };
// text upozornění tak, jak ho uvidí rodina s Toníkem (v telefonu se doplní jméno jejich dítěte)
const pushBody = (body, id) => esc(body).replace(/[„"]?\{pohadka\}[“"]?/g, `„${esc(storyName(id))}“`);

function loadPush(force) {
  if (PUSHS.state === 'loading' || (PUSHS.state === 'ok' && !force)) return;
  PUSHS.state = 'loading';
  pushApi().load().then((d) => { PUSHS.state = 'ok'; PUSHS.data = d; PUSHS.err = ''; }, (e) => { PUSHS.state = 'err'; PUSHS.err = e.message; })
    .then(() => { if (route() === 'upozorneni') render(); });
}

function pagePush() {
  loadPush();
  const top = head('Pohádka dne a upozornění', 'Která pohádka je dnes navrchu aplikace a co večer přijde rodinám do telefonu',
    `<button class="btn" data-a="pushTest"${PUSHS.busy ? ' disabled' : ''}>${I.bell}Poslat zkoušku sem</button>`) + demoBar('Zkouška tu je jen místní upozornění v tomhle prohlížeči.');
  if (PUSHS.state !== 'ok') {
    return PUSHS.state === 'err'
      ? `${top}<section class="panel"><h2>Nepodařilo se načíst</h2><p class="err">${esc(PUSHS.err)}</p><button class="btn sm" data-a="pushReload">Zkusit znovu</button></section>`
      : `${top}<section class="panel"><p class="muted">Načítám…</p></section>`;
  }
  const d = PUSHS.data, s = { ...PUSH_DEF, ...d.settings }, sub = d.subs || {};
  const rotation = s.rotation && s.rotation.length ? s.rotation : STORIES.map((x) => x.id);
  const today = d.plan[0];
  const lastDaily = d.log.find((l) => l.kind === 'daily');
  const missing = STORIES.filter((x) => !rotation.includes(x.id));
  const unknown = rotation.filter((id) => !storyById(id));
  const hours = [16, 17, 18, 19, 20, 21];
  const when = (t) => new Date(t).toLocaleString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
  const dayLabel = (day, i) => (i === 0 ? 'Dnes' : i === 1 ? 'Zítra' : fday(parseIso(day)));
  const access = (id) => { const x = storyById(id); return !x ? '<span class="tag peach">chybí</span>' : x.free ? '<span class="tag honey">Zdarma</span>' : '<span class="tag line">Placená</span>'; };

  return `${top}
    <div class="tiles">
      ${tile('Odběratelé upozornění', fmt(sub.total || 0), `+${fmt(sub.new7 || 0)} za 7 dní · ${pct(sub.total || 0, D.families.length)} rodin`)}
      ${tile('Dnes', `<span style="font-size:20px">${esc(storyName(today.story))}</span>`, today.manual ? `vybráno ručně${today.by ? ` (${esc(today.by)})` : ''}` : 'podle střídání')}
      ${tile('Poslední večer', lastDaily ? `${fmt(lastDaily.ok)} / ${fmt(lastDaily.targets)}` : '–', lastDaily ? `doručeno ${fday(parseIso(lastDaily.day))}${lastDaily.removed ? ` · ${fmt(lastDaily.removed)} zaniklých odběrů smazáno` : ''}` : 'zatím se neposílalo')}
      ${tile('Upozornění', s.enabled ? `<span class="status-ok">v ${s.hour}:00</span>` : '<span class="status-bad">vypnutá</span>', s.enabled ? 'každý den podle pražského času' : 'rodiny nic nedostanou, pohádka dne v aplikaci zůstává')}
    </div>

    <div class="grid2">
      <section class="panel"><div class="panel-head"><h2>Večerní upozornění</h2></div>
        <label class="check"><input type="checkbox" id="pEnabled" ${s.enabled ? 'checked' : ''}> Posílat každý den</label>
        <div class="fields2">
          <div><label for="pHour">Kdy</label><select id="pHour">${hours.map((h) => `<option value="${h}" ${s.hour === h ? 'selected' : ''}>${h}:00</option>`).join('')}</select></div>
          <div></div>
        </div>
        <label for="pTitle">Nadpis</label><input id="pTitle" data-f="pushPrev" maxlength="60" value="${esc(s.title)}">
        <label for="pBody">Text</label><input id="pBody" data-f="pushPrev" maxlength="160" value="${esc(s.body)}">
        <p class="hint">Místo <b>{pohadka}</b> se doplní název pohádky dne se jménem dítěte z té rodiny (doplní ho až telefon, jména na server nejdou). Když telefon název nezná, napíše se „na dnešní večer“.</p>
        <div class="row-acts" style="margin-top:12px;justify-content:flex-start;align-items:center"><button class="btn" data-a="pushSave">Uložit</button><span class="err" id="pErr"></span></div>
      </section>
      <section class="panel"><div class="panel-head"><h2>Jak to uvidí rodina</h2><span class="muted">dnes v ${s.hour}:00</span></div>
        <div class="lock-mock">
          <div class="lock-time">${s.hour}:00</div>
          <div class="notif"><img src="../app/icon-192.png" alt=""><div><b id="pvTitle">${esc(s.title)}</b><span id="pvBody">${pushBody(s.body, today.story)}</span></div><small>teď</small></div>
        </div>
        <p class="hint">Klepnutí otevře aplikaci rovnou na pohádce dne. Rodiny bez předplatného u placené pohádky uvidí nabídku předplatného.</p>
      </section>
    </div>

    <section class="panel"><div class="panel-head"><h2>Plán na 4 týdny</h2><span class="muted">${d.plan.filter((x) => x.manual).length} dní vybráno ručně, ostatní podle střídání</span></div>
      <div class="table-wrap"><table><thead><tr><th>Den</th><th>Pohádka dne</th><th>Přístup</th><th>Kdo vybral</th></tr></thead><tbody>
      ${d.plan.map((p, i) => {
        const auto = rotPick(rotation, p.day);
        return `<tr><td><b>${dayLabel(p.day, i)}</b> <span class="muted">${fshort(parseIso(p.day))}</span></td>
          <td><select data-f="pushDay" data-day="${p.day}" style="width:auto;max-width:100%;padding:4px 8px">
            <option value="">Střídání: ${esc(storyName(auto))}</option>
            ${STORIES.map((x) => `<option value="${esc(x.id)}" ${p.manual && p.story === x.id ? 'selected' : ''}>${esc(safeTitle(x))}</option>`).join('')}
          </select></td>
          <td>${access(p.story)}</td><td class="muted">${p.manual ? esc(p.by || 'tým') : 'automaticky'}</td></tr>`;
      }).join('')}
      </tbody></table></div>
    </section>

    <section class="panel"><div class="panel-head"><h2>Střídání</h2><span class="muted">dny bez ručního výběru jdou po řadě dokola</span></div>
      <div class="chips-row">${rotation.map((id, i) => `<span class="tag ${storyById(id) ? 'line' : 'peach'}">${i + 1}. ${esc(storyName(id))}</span>`).join(' ')}</div>
      ${missing.length || unknown.length ? `<div class="notice" style="margin-top:12px"><img src="../brand/maskot-3d/web/ospalek-hlava.webp" alt=""><div>
        ${missing.length ? `Ve střídání chybí ${missing.length} ${plural(missing.length, 'pohádka', 'pohádky', 'pohádek')}: ${missing.map((x) => esc(safeTitle(x))).join(', ')}. ` : ''}
        ${unknown.length ? `Pohádky ${unknown.map(esc).join(', ')} už v seznamu nejsou. ` : ''}
        <button class="btn sm" data-a="pushRotate" style="margin-top:8px">Střídat všech ${STORIES.length} pohádek</button></div></div>` : ''}
    </section>

    <section class="panel"><div class="panel-head"><h2>Historie rozesílání</h2><button class="btn white sm" data-a="pushReload">Načíst znovu</button></div>
      ${d.log.length ? `<div class="table-wrap"><table><thead><tr><th>Kdy</th><th>Druh</th><th>Pohádka</th><th class="num">Odesláno</th><th class="num">Doručeno</th><th class="num">Nedoručeno</th><th class="num">Smazané odběry</th></tr></thead><tbody>
      ${d.log.slice(0, 40).map((l) => `<tr><td>${when(l.started_at)}</td><td>${l.kind === 'test' ? `<span class="tag sky">Zkouška</span>${l.actor ? ` <span class="muted">${esc(l.actor)}</span>` : ''}` : '<span class="tag">Denní</span>'}</td>
        <td>${esc(storyName(l.story_id))}</td><td class="num">${fmt(l.targets)}</td><td class="num">${fmt(l.ok)}</td><td class="num">${l.failed ? `<span class="status-warn">${fmt(l.failed)}</span>` : 0}</td><td class="num">${fmt(l.removed)}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">Zatím se nic neposílalo.</p>'}
    </section>

    <div class="notice"><img src="../brand/maskot-3d/web/ospalek-spi.webp" alt=""><div>
      <b>Kdo upozornění dostane:</b> rodiny, které v aplikaci připomínku zapnuly a povolily upozornění. Ptáme se v posledním kroku úvodního nastavení,
      ostatním jednou v knihovně. Vypnout jde v nastavení aplikace. Na iPhonu chodí upozornění jen z Ospalka přidaného na plochu (iOS 16.4 a novější).
      Nedoručitelné odběry (odinstalovaný prohlížeč, zrušené povolení) se po odpovědi push služby samy smažou.
    </div></div>`;
}
PAGES.upozorneni = pagePush;

// ---------- Akce ----------
async function pushRun(work, ok) {
  try { await work(); toast(ok); PUSHS.state = 'idle'; loadPush(true); } catch (e) { toast(e.message); }
}
// odběr tohoto prohlížeče pro zkoušku (service worker aplikace, rozsah /app/)
async function adminSubscribe() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Tenhle prohlížeč upozornění neumí. Na iPhonu zkoušej z Ospalka přidaného na plochu.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Upozornění jsou v tomhle prohlížeči zakázaná. Povol je u webu v nastavení prohlížeče.');
  const reg = await navigator.serviceWorker.register('../app/sw.js', { scope: '../app/' });
  await new Promise((res) => { const w = reg.installing || reg.waiting; if (!w || reg.active) return res(); w.addEventListener('statechange', () => w.state === 'activated' && res()); });
  if (!D.live) return reg;
  const key = await D.push.key();
  if (!key) throw new Error('Chybí veřejný klíč VAPID (pushKey v config.js). Návod: push-worker/README.md.');
  const u8 = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((key.length + 3) % 4)), (c) => c.charCodeAt(0));
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8 });
  const j = sub.toJSON();
  await D.push.subscribe({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, platform: 'web' });
  return reg;
}

Object.assign(ACTIONS, {
  pushReload: () => { PUSHS.state = 'idle'; loadPush(true); render(); },
  pushSave: () => {
    const p = { enabled: $('#pEnabled').checked, hour: Number($('#pHour').value), title: $('#pTitle').value.trim(), body: $('#pBody').value.trim() };
    if (!p.title || !p.body) { $('#pErr').textContent = 'Nadpis i text musí být vyplněné.'; return; }
    pushRun(() => pushApi().save(p), 'Upozornění jsou uložená');
    if (!D.live) API.log('push.settings', 'Upozornění', `${p.enabled ? 'zapnuto' : 'vypnuto'} · v ${p.hour}:00`);
  },
  pushRotate: () => {
    const rotation = STORIES.map((s) => s.id);
    pushRun(() => pushApi().save({ rotation }), `Střídá se všech ${rotation.length} pohádek`);
  },
  pushTest: async () => {
    if (PUSHS.busy || PUSHS.state !== 'ok') return;
    PUSHS.busy = true; render();
    const s = { ...PUSH_DEF, ...PUSHS.data.settings }, story = PUSHS.data.plan[0].story;
    try {
      const reg = await adminSubscribe();
      if (D.live) {
        const r = await D.push.test();
        toast(r.ok ? `Zkouška odešla na ${r.ok} ${plural(r.ok, 'zařízení', 'zařízení', 'zařízení')}` : 'Zkoušku se nepodařilo doručit');
      } else {
        // ukázková data: místní upozornění, stejný text a vzhled jako ze serveru
        await reg.showNotification(s.title, { body: s.body.replace(/[„"]?\{pohadka\}[“"]?/g, `„${storyName(story)}“`), icon: '../app/icon-192.png', tag: 'pohadka-dne', data: { story } });
        await pushDemo.test({ title: s.title, body: s.body, story });
        toast('Zkouška je v upozorněních');
      }
    } catch (e) { toast(e.message); }
    PUSHS.busy = false; PUSHS.state = 'idle'; loadPush(true); render();
  },
});

document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.dataset.f !== 'pushDay') return;
  const day = t.dataset.day, story = t.value;
  pushRun(() => pushApi().setDay(day, story), story ? `${fday(parseIso(day))}: ${storyName(story)}` : `${fday(parseIso(day))}: podle střídání`);
  if (!D.live) API.log('push.plan', fdate(parseIso(day)), story ? `Pohádka dne: ${story}` : 'Vráceno do střídání');
});
// náhled upozornění se mění při psaní
document.addEventListener('input', (ev) => {
  if (ev.target.dataset.f !== 'pushPrev' || !PUSHS.data) return;
  $('#pvTitle').textContent = $('#pTitle').value || ' ';
  $('#pvBody').innerHTML = pushBody($('#pBody').value, PUSHS.data.plan[0].story);
});
