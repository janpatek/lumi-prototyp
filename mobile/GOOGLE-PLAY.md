# Google Play: checklist pro Ospalek

Ověřeno na stránkách Googlu 9. 11. 2026. Kroky v konzolích dělá majitel účtu, ne Claude.

## A. Účet vývojáře (organizace Magnet Marketing s.r.o.)

- [ ] **D-U-N-S číslo** firmy: zdarma u Dun & Bradstreet, vyřízení až 30 dní. Napřed ověřit, jestli ho firma už nemá (neoficiálně jde přes [Apple D-U-N-S lookup](https://developer.apple.com/enroll/duns-lookup/), stejná databáze; hodí se i pro App Store). Neplatit zprostředkovatelům. [Google: požadavky na organizaci](https://support.google.com/googleplay/android-developer/answer/13628312)
- [ ] Název a adresa u D&B musí **přesně** sedět s údaji v Play Console a v platebním profilu (Magnet Marketing s.r.o., Ponětovice 74, 664 51 Ponětovice).
- [ ] Firemní web (ospalek.cz) a telefon, firemní kontaktní e-mail a telefon + veřejný e-mail vývojáře (např. support@ospalek.cz). Ověřují se kódem.
- [ ] **Registrace:** jednorázově **25 USD** kartou (ne předplacenou). Při zamítnutí se nevrací. [answer/6112435](https://support.google.com/googleplay/android-developer/answer/6112435)
- [ ] **Platební profil (Google Payments) + obchodní účet**: bankovní účet firmy, ověření zkušebním vkladem nebo dokladem (až 5 dní).
- [ ] **Daňové údaje:** DIČ CZ21367647. Firma podle vás **není plátce DPH**. Pro příjmy od Google Commerce Limited (Irsko) se registrovat jako **identifikovaná osoba** (§ 6i ZDPH) a zadávat DIČ z té registrace. Co přesně zvolit v daňovém profilu, ověřit s účetní.
- [ ] Výplaty: měsíčně kolem 15. dne následujícího měsíce, minimum 1 USD v místní měně. Měnu výplaty pro český účet ověřit v konzoli. [answer/137997](https://support.google.com/googleplay/android-developer/answer/137997)
- Pravidlo „12 testerů po 14 dní“ platí jen pro **osobní** účty, organizace může jít rovnou do produkce. Interní testování je stejně rozumné. [answer/14151465](https://support.google.com/googleplay/android-developer/answer/14151465)

## B. Předplatné v Play Console (Zpeněžení → Produkty → Předplatná)

- [ ] Předplatné, ID např. `ospalek_plus` (ID nejde změnit), název „Ospalek Plus“.
- [ ] Základní tarif (base plan) `mesicne`: automatické obnovení, 1 měsíc, **129 Kč** v CZ (Google cenu zadává bez daně a DPH přičte; zkontrolujte, že zákazník vidí konečných 129 Kč). SK cena **4,99 €** (rozhodnuto 9. 11. 2026).
- [ ] Nabídka (offer) `tri-dny-zdarma`: zkušební doba **3 dny**, jen pro nové zákazníky. Delší vyzkoušení zdarma se dává kupóny (administrace → Kupóny).
- [ ] Země: jen **Česko a Slovensko**.
- **Poplatek Googlu:** od 30. 6. 2026 je v EHP u předplatného **10 % + 5 % billing fee = 15 %**. [answer/112622](https://support.google.com/googleplay/android-developer/answer/112622)
- Prodávajícím vůči zákazníkovi (merchant of record) je v CZ i SK Google, DPH zákazníkovi vybírá a odvádí Google. [answer/7645364](https://support.google.com/googleplay/android-developer/answer/7645364), [answer/138000](https://support.google.com/googleplay/android-developer/answer/138000)
- Předplatné v aplikaci **musí** jít přes Google Play Billing; Billing Library minimálně 8, použijeme 9. [deprecation FAQ](https://developer.android.com/google/play/billing/deprecation-faq)
- [ ] Licenční testeři (Nastavení → Testování licencí): e-maily, které testují nákupy bez placení.

## B2. RevenueCat (správa předplatného)

Cena: podle srovnávacích webů zdarma do 2 500 USD měsíčních tržeb, nad tím 1 %. Ověřte na [revenuecat.com/pricing](https://www.revenuecat.com/pricing).

- [ ] Účet a projekt „Ospalek“ na [app.revenuecat.com](https://app.revenuecat.com), aplikace Google Play s balíčkem `cz.ospalek.app` (a App Store pro iOS).
- [ ] V Google Cloud servisní účet s přístupem k Play Console (Finance, Správa objednávek) a jeho JSON klíč nahrát do RevenueCat. Návod: [RevenueCat – Google Play credentials](https://www.revenuecat.com/docs/service-credentials/creating-play-service-credentials). Propsání práv trvá až 36 hodin.
- [ ] Zapnout Real-time developer notifications (Pub/Sub téma z RevenueCat vložit do Play Console → Zpeněžení → Nastavení).
- [ ] Nárok (entitlement) `plus`, produkt `ospalek_plus:mesicne`, nabídka (offering) `default` s balíčkem Monthly.
- [ ] Veřejný SDK klíč Androidu (`goog_…`) poslat vývoji, přijde do `config.js` → `revenuecatAndroidKey`.
- [ ] Ve formuláři Data safety uvést i údaje, které sbírá RevenueCat SDK (historie nákupů, ID aplikace/uživatele). Zásady ochrany osobních údajů už RevenueCat uvádějí (verze 1.4).

## C. Před vydáním (Obsah aplikace)

- [ ] **Zásady ochrany osobních údajů:** https://ospalek.cz/ochrana-osobnich-udaju/ musí být veřejně dostupné bez hesla (už jsou mimo zámek gate.js), odkaz i v aplikaci (je v Nastavení).
- [ ] **Přístup do aplikace:** návod pro recenzenty (3 pohádky zdarma bez přihlášení; na předplatné jim stačí testovací účet licenčního testera).
- [ ] **Smazání účtu:** v aplikaci (tlačítko „Smazat všechna data“ už existuje, smaže i server) + **webový odkaz**, kde jde o smazání požádat bez aplikace (např. stránka na ospalek.cz nebo e-mail support@ospalek.cz). [answer/13327111](https://support.google.com/googleplay/android-developer/answer/13327111)
- [ ] **Bezpečnost údajů (Data safety):** jména a věk dětí, obec, e-mail (volitelně), údaje o poslechu (se souhlasem), ID zařízení/aplikace; přenos šifrovaný; možnost smazání. Vyplnit podle zásad 1.4. Navíc historie nákupů (RevenueCat).
- [ ] **Hodnocení obsahu** (dotazník IARC): nenásilný obsah pro děti.
- [ ] **Cílové publikum:** aplikaci ovládá rodič (podmínky: 18+), obsah je pro děti 2–9 let. Pokud zvolíte jen 18+, Google může publikum kvůli dětskému vzhledu přepsat na děti. Pak platí **Families policy**: žádné reklamy, žádné reklamní ID, jen certifikovaná SDK, zásady ochrany údajů zmiňující děti. Ospalek reklamy ani analytiku nemá, takže to splní. [answer/9893335](https://support.google.com/googleplay/android-developer/answer/9893335)
- [ ] **Služba na popředí `mediaPlayback`** (PrehravacService, pohádka hraje se zhasnutým displejem): v Obsahu aplikace vyplnit deklaraci služeb na popředí, typ „Přehrávání médií“, a přiložit krátké video: otevřít pohádku → Přehrát → zhasnout displej → ovládání na zamčené obrazovce. [answer/13392821](https://support.google.com/googleplay/android-developer/answer/13392821)
- [ ] Záznam v obchodě: ikona 512×512, grafika 1024×500, snímky obrazovky telefonu, krátký a dlouhý popis česky (a slovensky?).
- Technicky: cílení na **Android 16 (API 36)** povinné od 31. 8. 2026, kostra ho už má. [target-sdk](https://developer.android.com/google/play/requirements/target-sdk)
- Ověřování vývojářů Androidu (od 2027 celosvětově): aplikace z Google Play registruje Google sám, jen zkontrolovat stav v konzoli. [developer-verification](https://developer.android.com/developer-verification)

## D. Postup vydání

1. Interní testování (až 100 testerů, hned) → 2. uzavřené testování → 3. produkce CZ a SK.
