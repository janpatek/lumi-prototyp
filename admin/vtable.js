// Virtualizovaná tabulka. V DOM je jen tolik řádků, kolik se vejde na obrazovku (+ rezerva),
// při posunu se stejné řádky jen přesunou a přepíše se jim obsah. Tabulka s 30 tisíci rodinami
// tak má pořád jen asi 40 řádků v DOM. Data si načítá po stránkách přes kurzor, až když jsou potřeba.
//
// vtable(host, {
//   cols: [{ k, label, w: '120px' | 'minmax(160px,1fr)', cls: 'r', sort: true, html: (row) => '…' }],
//   rowH: 38, fetch: (cursor, limit) => ({ items, next, total, ms }), key: (row) => id,
//   sort: { k, dir }, onSort: (k) => …, onOpen: (row, i) => …, selected: id, empty: 'text', foot: (state) => '…'
// })

function vtable(host, o) {
  const rowH = o.rowH || 38, over = 8, limit = o.limit || 100;
  const tpl = o.cols.map((c) => c.w || '1fr').join(' ');
  // společná minimální šířka pro hlavičku i řádky, jinak by si každý řádek rozpočítal sloupce jinak
  const minW = o.cols.reduce((n, c) => n + (Number((String(c.w || '').match(/(\d+)px/) || [])[1]) || 80), 0);
  host.innerHTML = `
    <div class="vt" style="--vt-cols:${tpl};--vt-h:${rowH}px;--vt-minw:${minW}px">
      <div class="vt-scroll" tabindex="0" role="grid" aria-rowcount="0">
        <div class="vt-head" role="row" ${o.noHead ? 'hidden' : ''}>${o.cols.map((c) => `<div class="vt-c ${c.cls || ''}" role="columnheader" ${o.sort && o.sort.k === c.k ? `aria-sort="${o.sort.dir > 0 ? 'ascending' : 'descending'}"` : ''}>${c.sort ? `<button data-vsort="${c.k}">${c.label}<span class="vt-ar">${o.sort && o.sort.k === c.k ? (o.sort.dir > 0 ? '↑' : '↓') : ''}</span></button>` : c.label}</div>`).join('')}</div>
        <div class="vt-body"></div>
      </div>
      ${o.foot ? '<div class="vt-foot"></div>' : ''}
    </div>`;
  const sc = host.querySelector('.vt-scroll'), body = host.querySelector('.vt-body'), foot = host.querySelector('.vt-foot');
  let rows = [], next = null, total = 0, ms = 0, started = false, pool = [], sel = o.selected ?? null, cursorI = -1, raf = 0, pending = false;

  function load(upTo) {
    // stránky se načítají postupně; u skutečného API je fetch asynchronní a řádky mezitím ukazují kostru
    while (!pending && (!started || (next !== null && rows.length < upTo))) {
      const r = o.fetch(started ? next : null, limit);
      started = true;
      if (r && typeof r.then === 'function') { pending = true; r.then((x) => { pending = false; apply(x); paint(true); }); return; }
      apply(r);
    }
  }
  function apply(r) {
    rows.push(...r.items); next = r.next; total = r.total; ms = r.ms ?? ms;
    body.style.height = total * rowH + 'px';
    sc.setAttribute('aria-rowcount', total);
  }
  function paint(force) {
    raf = 0;
    const top = Math.max(0, sc.scrollTop - rowH), h = sc.clientHeight || 600;
    const first = Math.max(0, Math.floor(top / rowH) - over);
    const count = Math.ceil(h / rowH) + over * 2;
    load(first + count);
    while (pool.length < count) {
      const el = document.createElement('div'); el.className = 'vt-row'; el.setAttribute('role', 'row'); el._i = -1;
      body.appendChild(el); pool.push(el);
    }
    for (let j = 0; j < pool.length; j++) {
      const i = first + j, el = pool[j];
      if (i >= total || j >= count) { if (el._i !== -2) { el.style.display = 'none'; el._i = -2; } continue; }
      const row = rows[i];
      if (el._i !== i || el._row !== row || force) {
        el._i = i; el._row = row;
        el.style.display = '';
        el.style.transform = `translateY(${i * rowH}px)`;
        el.setAttribute('aria-rowindex', i + 1);
        el.innerHTML = row ? o.cols.map((c) => `<div class="vt-c ${c.cls || ''}">${c.html(row)}</div>`).join('') : '<div class="vt-c vt-skel"></div>';
      }
      const on = row && o.key && o.key(row) === sel;
      if (el._on !== on) { el.classList.toggle('on', !!on); el._on = on; }
      el.classList.toggle('kb', i === cursorI);
    }
    if (!total && started) body.innerHTML = `<div class="vt-empty">${o.empty || 'Nic nenalezeno.'}</div>`, pool = [];
    if (foot) foot.innerHTML = o.foot({ total, loaded: rows.length, ms });
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => paint(false)); };
  sc.addEventListener('scroll', schedule, { passive: true });
  const ro = new ResizeObserver(schedule); ro.observe(sc);
  sc.addEventListener('click', (ev) => {
    const s = ev.target.closest('[data-vsort]');
    if (s) { o.onSort && o.onSort(s.dataset.vsort); return; }
    if (ev.target.closest('a, button, input, select')) return;
    const el = ev.target.closest('.vt-row');
    if (el && el._row && o.onOpen) { cursorI = el._i; o.onOpen(el._row, el._i); }
  });
  sc.addEventListener('keydown', (ev) => {
    if (!['ArrowDown', 'ArrowUp', 'Enter', 'PageDown', 'PageUp'].includes(ev.key) || !total) return;
    ev.preventDefault();
    if (ev.key === 'Enter') { if (rows[cursorI] && o.onOpen) o.onOpen(rows[cursorI], cursorI); return; }
    const step = ev.key.startsWith('Page') ? Math.floor(sc.clientHeight / rowH) : 1;
    api.move(ev.key === 'ArrowDown' || ev.key === 'PageDown' ? step : -step, !!o.openOnMove);
  });
  const api = {
    // znovu načíst od začátku (nový filtr nebo řazení)
    reset(fetch, keepScroll) {
      if (fetch) o.fetch = fetch;
      rows = []; next = null; total = 0; started = false; pending = false;
      body.innerHTML = ''; pool = [];
      if (!keepScroll) sc.scrollTop = 0;
      paint(true);
    },
    // překreslit viditelné řádky (změnil se obsah, ne množina)
    refresh() { paint(true); },
    select(id) { sel = id; paint(false); },
    move(d, open) {
      cursorI = Math.max(0, Math.min(total - 1, cursorI + d));
      load(cursorI + 1);
      const y = cursorI * rowH, head = rowH;
      if (y < sc.scrollTop) sc.scrollTop = y;
      else if (y + rowH > sc.scrollTop + sc.clientHeight - head) sc.scrollTop = y + rowH * 2 - sc.clientHeight;
      paint(false);
      if (open && rows[cursorI] && o.onOpen) o.onOpen(rows[cursorI], cursorI);
    },
    focus() { sc.focus({ preventScroll: true }); },
    get total() { return total; },
    rows: () => rows,
    destroy() { ro.disconnect(); cancelAnimationFrame(raf); },
  };
  paint(true);
  return api;
}
