// Zámek před spuštěním je zrušený (11. 11. 2026), web i aplikace jsou veřejné.
// Soubor zůstává kvůli starým odkazům na /brzy/ a kvůli mezipaměti service workeru aplikace (app/sw.js):
// kdo přijde na /brzy/, pošleme ho tam, kam původně mířil, jinak na úvodní stránku.
(function () {
  const script = document.currentScript;
  if (!script || script.dataset.page !== 'brzy') return;
  const z = new URLSearchParams(location.search).get('zpet') || '/';
  location.replace(/^\/(?!\/)/.test(z) && !z.startsWith('/brzy') ? z : '/');
})();
