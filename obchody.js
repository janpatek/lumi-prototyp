// Odkazy do obchodů s aplikacemi – jediné místo, kde se nastavují.
// Používá je landing (landing.js), stránka /stahnout/ (QR kód) i webová adresa /app/ (posílá na /stahnout/).
// Dokud je odkaz prázdný, tlačítko obchodu má štítek „Již brzy“ a nikam nevede.
// Náhled, jak bude web vypadat s odkazy: přidejte k adrese ?obchody=nahled
window.OSPALEK_OBCHODY = {
  appStoreUrl: '',
  googlePlayUrl: 'https://play.google.com/store/apps/details?id=cz.ospalek.app',
};
