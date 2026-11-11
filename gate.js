// Zámek před spuštěním: kdo nezadal heslo, uvidí stránku „Připravujeme“ (/brzy/).
// Web je statický na veřejných GitHub Pages, takže je to jen zámek na dveřích. Zastaví náhodné
// návštěvníky a vyhledávače, ale soubory i kód si technicky přečte kdokoli (repo je veřejné).
// V repozitáři je jen otisk hesla (PBKDF2). Nové heslo: node admin/heslo.js "nové heslo"
// a vypsané hodnoty vlož do AUTH níže. Samotné heslo nikam neukládej.
// Zámek zrušíš smazáním <script src="…gate.js"> z index.html a app/index.html.

(function () {
  const AUTH = {
    salt: '127919476bcd4f8e64e933385e03ffbd',
    hash: 'faf24bbd8049808d710b5f1c172b9f1b16e7d25a1cff4699f08c7e0bd8295bdc',
    iterations: 250000,
  };
  const KEY = 'ospalek.preview';
  const read = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
  const unlocked = () => read() === AUTH.hash;

  const script = document.currentScript;
  if (!script || script.dataset.page !== 'brzy') {
    // chráněná stránka: bez hesla nic neukázat a poslat na /brzy/
    if (!unlocked()) {
      document.documentElement.style.display = 'none';
      location.replace('/brzy/?zpet=' + encodeURIComponent(location.pathname + location.search + location.hash));
    }
    return;
  }

  // stránka /brzy/: formulář s heslem
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const unhex = (s) => new Uint8Array(s.match(/../g).map((h) => parseInt(h, 16)));
  async function derive(pw) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
    return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(AUTH.salt), iterations: AUTH.iterations }, key, 256));
  }
  // jen cesty na tomhle webu, žádné //jiny-web
  function target() {
    const z = new URLSearchParams(location.search).get('zpet') || '/';
    return /^\/(?!\/)/.test(z) && !z.startsWith('/brzy') ? z : '/';
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (unlocked()) { location.replace(target()); return; }
    const form = document.getElementById('gate'), input = document.getElementById('pw'), err = document.getElementById('pwErr'), btn = form.querySelector('button');
    let fails = 0;
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (!input.value) { err.textContent = 'Zadejte heslo.'; input.focus(); return; }
      btn.disabled = true; err.textContent = '';
      // každý další špatný pokus o chvilku zdrží
      await new Promise((r) => setTimeout(r, Math.min(fails, 5) * 600));
      let ok = false;
      try { ok = (await derive(input.value)) === AUTH.hash; } catch (e) { err.textContent = 'Vstup potřebuje zabezpečené připojení (https).'; btn.disabled = false; return; }
      if (!ok) { fails++; btn.disabled = false; err.textContent = 'Heslo nesedí.'; input.select(); return; }
      try { localStorage.setItem(KEY, AUTH.hash); } catch (e) {}
      location.replace(target());
    });
  });
})();
