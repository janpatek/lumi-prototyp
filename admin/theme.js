// Téma administrace: ruční volba z administrace, jinak podle systému. Běží v <head> před vykreslením stránky.
// Vlastní soubor místo inline skriptu, ať Content-Security-Policy v index.html nemusí inline skripty povolovat.
(function () {
  var pref = null;
  try { pref = localStorage.getItem('ospalek.admin.theme'); } catch (e) {}
  var dark = pref ? pref === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();
