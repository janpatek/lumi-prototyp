// Přihlášení do administrace. Web je statický na veřejných GitHub Pages, takže tohle je jen zámek
// na dveřích: zastaví náhodné návštěvníky, ale soubory ve složce admin/ si technicky stáhne kdokoli.
// Proto tu nesmí být žádná skutečná osobní data ani klíče. V repozitáři je jen otisk hesla (PBKDF2).
// Nové heslo: node admin/heslo.js "nové heslo" a vypsané hodnoty vlož sem.

(function () {
  const AUTH = {
    salt: '46dd5bd17b5fc9ad5da179930aa356d9',
    hash: 'dcf6761e5f2b413cd94cfb671d213c561a274b3b79e325b2d03fe328948d07a9',
    iterations: 250000,
  };
  const KEY = 'ospalek.admin.auth';
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const unhex = (s) => new Uint8Array(s.match(/../g).map((h) => parseInt(h, 16)));

  async function derive(pw) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
    return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(AUTH.salt), iterations: AUTH.iterations }, key, 256));
  }
  const read = (st) => { try { return st.getItem(KEY); } catch (e) { return null; } };
  const signedIn = () => [sessionStorage, localStorage].some((st) => read(st) === AUTH.hash);

  window.adminLogout = () => {
    [sessionStorage, localStorage].forEach((st) => { try { st.removeItem(KEY); } catch (e) {} });
    location.reload();
  };

  window.adminGate = (start) => {
    if (signedIn()) { document.body.classList.remove('locked'); start(); return; }
    document.body.classList.add('locked');
    const box = document.createElement('main');
    box.className = 'login';
    box.innerHTML = `
      <form class="panel login-card" novalidate>
        <img src="../brand/maskot-3d/web/ospalek-spi.webp" alt="">
        <b class="wordmark">ospalek</b>
        <h1>Administrace</h1>
        <p class="muted">Pro vstup zadej heslo.</p>
        <label for="pw">Heslo</label>
        <input id="pw" type="password" autocomplete="current-password" required>
        <label class="check"><input type="checkbox" id="remember"> Pamatovat si mě na tomhle zařízení</label>
        <p class="err" id="pwErr" role="alert"></p>
        <button class="btn" type="submit">Přihlásit</button>
      </form>`;
    document.body.prepend(box);
    const form = box.querySelector('form'), input = box.querySelector('#pw'), err = box.querySelector('#pwErr'), btn = box.querySelector('button');
    let fails = 0;
    input.focus();
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (!input.value) { err.textContent = 'Zadej heslo.'; return; }
      btn.disabled = true; err.textContent = '';
      // každý další špatný pokus o chvilku zdrží
      await new Promise((r) => setTimeout(r, Math.min(fails, 5) * 600));
      let ok = false;
      try { ok = (await derive(input.value)) === AUTH.hash; } catch (e) { err.textContent = 'Přihlášení potřebuje zabezpečené připojení (https).'; btn.disabled = false; return; }
      if (!ok) {
        fails++; btn.disabled = false; err.textContent = 'Heslo nesedí.'; input.select(); return;
      }
      try { (box.querySelector('#remember').checked ? localStorage : sessionStorage).setItem(KEY, AUTH.hash); } catch (e) {}
      box.remove();
      document.body.classList.remove('locked');
      start();
    });
  };
})();
