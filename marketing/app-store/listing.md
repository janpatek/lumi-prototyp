# Ospalek – záznam v App Store (čeština)

Texty a odpovědi připravené ke zkopírování do App Store Connect. Vycházejí ze záznamu pro Google Play
(`marketing/google-play/listing.md`), obchodních podmínek 1.18 a zásad ochrany osobních údajů 2.9 (11. 11. 2026).
Slovenština je v `listing-sk.md`, obrázky v `obrazky/` (návod v `_zdroj/build.mjs`).

Rozdíly proti Google Play, na které se v App Storu dbá:
- **Mimo kategorii Kids nesmí metadata působit, že aplikace je hlavně pro děti** (pravidla 1.3 a 2.3.8). Proto nikde „pro děti“
  ani „pro nejmenší“; texty mluví k rodičům. Věk pohádek („zhruba od 2 do 9 let“) uvádíme jako vhodnost, ne jako cílovku.
- Předplatné se ruší v nastavení Apple ID, ne v Google Play. Popis musí jasně říct cenu, období, zkušební dobu a automatické
  obnovení a odkázat na podmínky (pravidlo 3.1.2).
- Klíčová slova nesmí opakovat slova z názvu a podtitulu (indexují se samy) a nesmí obsahovat cizí značky (např. Večerníček).
- Na obrázcích žádné ceny ani „zdarma“, nesmí ukazovat jiné než skutečné obrazovky aplikace.

## Informace o aplikaci (App Information)

| Pole | Hodnota |
|---|---|
| Název (max. 30) | **Ospalek: pohádky na dobrou noc** (30) |
| Podtitul (max. 30) | **Hrdinou pohádky je vaše dítě** (28) |
| Primární jazyk | čeština |
| Bundle ID | `cz.ospalek.app` |
| SKU | `ospalek-ios` (jen interní, nejde změnit) |
| Primární kategorie | **Knihy** (Books) |
| Sekundární kategorie | Životní styl (Lifestyle) |
| Kids Category | **ne** (zdůvodnění v `mobile/README.md` a poznámkách k iOS: rodič spravuje účet a předplatné) |
| Obsahová práva | Aplikace nezobrazuje obsah třetích stran (pohádky, hlas a obrázky jsou naše) |
| Copyright | 2026 Magnet Marketing s.r.o. |

## Verze 1.0 (stránka produktu)

### Propagační text (max. 170, jde měnit kdykoli bez nové verze)

```
První 3 pohádky si pustíte zdarma a bez registrace. Odemčené pohádky si stáhnete do telefonu a pustíte je i bez internetu, třeba v autě.
```

### Popis (max. 4000)

```
Bylo nebylo, ve vašem městě stál jeden docela obyčejný dům. A v tom domě bydlelo vaše dítě.

Takhle začínají pohádky od Ospalka. Hlavním hrdinou je vaše dítě: s jeho jménem, oblíbeným jídlem a zvířátkem. Příběh se odehrává tam, kde bydlíte, do pokoje nakoukne maminka nebo táta a výprava míří na hrad, který znáte z výletů. Pohádku čte klidným hlasem teta Terezka a potichu k ní hraje hudba.

Zhasnete. Dítě poslouchá o sobě. A vy máte chvíli pro sebe.

JAK TO FUNGUJE
1. Přidáte dítě: jméno, věk, oblíbené jídlo a zvíře. Sourozenci můžou být v účtu dva.
2. Napíšete obec, nebo ji Ospalek najde podle polohy. Přidáte oblíbená místa z výletů. Přesnou adresu nechceme.
3. Vyberete pohádku a pustíte ji. Nastavení zabere asi tři minuty.

PROČ SI OSPALKA OBLÍBÍTE
• Dítě je hlavní hrdina. Pohádka zní jeho jménem, ne „jednoho chlapce“.
• Jméno zní česky správně. Aplikace sama navrhne všechny pády (Toník, bez Toníka, pomůžeš mi, Toníku?) a vy je jen zkontrolujete. Slovesa se řídí tím, jestli je hrdinou kluk, holka nebo sourozenci spolu.
• Známá místa. Benešov, Konopiště, rybník za vsí: pohádka se odehrává ve vašem okolí.
• Celá rodina v příběhu. Sourozenci můžou být hrdiny spolu, maminka, táta i babička dostanou svou roli.
• Klidný hlas a hudba. Čte teta Terezka, text se při čtení zvýrazňuje, hlasitost hudby si nastavíte.
• Pohádky na cestu. Každá otevřená pohádka se uloží do telefonu, takže ji pustíte i bez internetu, třeba v autě nebo na chalupě.
• Pohádka dne. Každý den vám jednu doporučíme. Když chcete, připomeneme ji večer upozorněním.
• Noční režim. Večer se aplikace sama ztlumí do tmavých barev, aby v pokoji neoslňovala.

POHÁDKY NA KAŽDOU CHVÍLI
• Na dobrou noc: pomalé příběhy, u kterých se oči zavírají samy.
• Do auta: hádanky s pauzou na odpověď. „Kdy už tam budem?“ uslyšíte mnohem méně často.
• Dobrodružství: výprava za pokladem na místo, které znáte z výletů.
• Ze života: zubař, strach ze tmy a další chvíle, kdy se hodí kousek odvahy.

Pohádky se hodí zhruba od 2 do 9 let a každá má doporučený věk. Nejmenší dostanou kratší a klidnější příběhy, starší dobrodružství a hádanky.

VYZKOUŠEJTE ZDARMA
První 3 pohádky si pustíte zdarma, bez platby a bez registrace. Účet vznikne v aplikaci sám, bez e-mailu a hesla. Všechny pohádky odemkne předplatné Ospalek Plus pro jednu rodinu a až 2 děti.

PŘEDPLATNÉ OSPALEK PLUS
• 129 Kč měsíčně (na Slovensku 4,99 €), první 3 dny zdarma pro nové předplatitele.
• Platba se strhne z vašeho účtu Apple po potvrzení nákupu, po zkušební době a pak každý měsíc.
• Předplatné se obnovuje automaticky, pokud ho nezrušíte alespoň 24 hodin před koncem období.
• Zrušíte ho kdykoli v Nastavení iPhonu → vaše jméno → Předplatná.

BEZ REKLAM A S OHLEDEM NA SOUKROMÍ
V Ospalkovi nejsou žádné reklamy. Ukládáme jen nutné minimum: křestní jména dětí, pár oblíbených věcí a obec. Přesnou adresu, fotky, příjmení ani e-mail nechceme. Údaje nikomu neprodáváme a všechna data rodiny smažete jedním tlačítkem v nastavení.

Aplikaci ovládá rodič. Pohádky jsou v češtině, pro rodiny z Česka a Slovenska.

Podmínky použití: https://ospalek.cz/obchodni-podminky/
Zásady ochrany osobních údajů: https://ospalek.cz/ochrana-osobnich-udaju/
Podpora: support@ospalek.cz
```

### Klíčová slova (max. 100 znaků, čárky bez mezer)

```
audiopohádky,usínání,spánek,uspávání,příběhy,předčítání,audiokniha,hádanky,auto,rodina,jméno,zubař
```

Slova z názvu a podtitulu (Ospalek, pohádky, dobrou noc, hrdina, dítě) už se indexují sama, proto tu nejsou.

### Adresy

| Pole | Hodnota |
|---|---|
| URL podpory | https://ospalek.cz/#podpora (patička landingu: e-mail podpory a smazání účtu; Apple chce stránku s kontaktem) |
| Marketingová URL | https://ospalek.cz |
| Zásady ochrany osobních údajů | https://ospalek.cz/ochrana-osobnich-udaju/ |
| Podmínky (EULA) | v popisu odkaz na https://ospalek.cz/obchodni-podminky/ a stejný odkaz v poli *License Agreement* (vlastní EULA), nebo nechat standardní EULA Applu; podmínky jsou nad ní |

### Obrázky (iPhone 6,9")

`obrazky/screenshot-01.jpg` … `08.jpg` (čeština), `obrazky/sk/` (slovenština), 1320×2868 JPEG. Aplikace je jen pro iPhone
(`TARGETED_DEVICE_FAMILY = 1`), takže snímky iPadu nejsou potřeba; menší iPhony App Store dopočítá z 6,9".
Ikona 1024×1024 se bere z aplikace (`mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset`).

Pořadí je stejné jako v Google Play: 1) dítě je hrdina, 2) večer s tetou Terezkou, 3) vaše město, 4) skloňování, 5) celá rodina,
6) zubař, 7) hádanky do auta, 8) rychlé nastavení. Na obrazovkách je ukázková rodina (Toník a Eliška z Benešova).

## Věkové hodnocení (Age Rating)

Na všechny otázky o obsahu (násilí, strach, sex, alkohol, hazard, sprostá slova, lékařské informace…) **Žádné / None**.
- Neomezený přístup na web: **ne** · Obsah od uživatelů nebo komunikace mezi uživateli: **ne** · Hazard a soutěže: **ne**
- Rodičovská kontrola a ověření věku v aplikaci: **ne**
- Vyjde **4+**. Kategorii „Made for Kids“ nevybírat.

## Soukromí aplikace (App Privacy)

Odpovídá zásadám 2.9. Tracking (sledování napříč aplikacemi, ATT): **ne**. Reklamy: **ne**.

| Typ údajů (Apple) | Co to je u nás | Účel | Spojeno s uživatelem |
|---|---|---|---|
| Kontaktní údaje → Jméno | křestní jména dětí (na serveru účet rodiny) | Funkce aplikace | ano |
| Poloha → Přibližná poloha | obec, kterou rodič napíše nebo nechá najít podle polohy (jen na klepnutí, zaokrouhleno na ~100 m, souřadnice neukládáme) | Funkce aplikace | ano |
| Obsah od uživatele → Jiný obsah | věk a pohlaví dětí | Funkce aplikace | ano |
| Identifikátory → ID uživatele | anonymní účet rodiny (Supabase) | Funkce aplikace | ano |
| Nákupy → Historie nákupů | stav předplatného a transakce z App Store | Funkce aplikace | ano |
| Data o používání → Interakce s produktem | které pohádky se poslouchají a jak dlouho | Analytika | ano jen se souhlasem; bez něj anonymně. Apple chce odpověď za nejširší případ: **ano** |
| Diagnostika → Jiná diagnostická data | typ zařízení a verze aplikace | Funkce aplikace (podpora) | ano |

Nesbíráme: e-mail, telefon, fotky, kontakty, přesnou polohu, zdravotní ani finanční údaje (platby vidí jen Apple), reklamní ID.
Text pohádky se jménem dítěte jde ElevenLabs kvůli namluvení; nahrávky jsou bez vazby na účet. V App Privacy se počítá do
„Jméno“ výše (zpracovatel jménem nás, ne třetí strana pro vlastní účely).

## Předplatné (In-App Purchases → Subscriptions)

| Pole | Hodnota |
|---|---|
| Skupina předplatného | Ospalek Plus |
| Product ID | **`ospalek_plus_mesicne`** (aplikace ho čeká, `app/billing.js`; nejde změnit) |
| Referenční název | Ospalek Plus měsíčně |
| Délka | 1 měsíc |
| Cena | Česko **129 Kč**, Slovensko **4,99 €** (ostatní země vypnout) |
| Úvodní nabídka | zkušební doba zdarma **3 dny**, noví předplatitelé (v souladu s obchodními podmínkami) |
| Zobrazovaný název (CZ) | Ospalek Plus |
| Popis (CZ, max. 45) | Všechny pohádky pro celou rodinu (32) |
| Zobrazovaný název (SK) | Ospalek Plus |
| Popis (SK, max. 45) | Všetky rozprávky pre celú rodinu (32) |
| Snímek pro kontrolu | obrazovka s nabídkou předplatného (paywall) ze simulátoru, 1320×2868 |
| Server notifications | `https://imiujppjewddeldjifkl.supabase.co/functions/v1/store/apple`, verze 2, produkce i sandbox (`supabase/README.md`) |

## Informace pro kontrolu (App Review Information)

- Kontakt: Jan Pátek, telefon a e-mail podle účtu vývojáře.
- Přihlášení: **není potřeba** (anonymní účet vznikne sám), pole *Sign-in required* nechat vypnuté.
- Poznámky pro recenzenta (anglicky):

```
Ospalek reads personalised Czech bedtime stories in which the user's child is the main character. The app is operated by the parent.

How to test:
1. On first launch add a child (any first name, age, favourite food and animal), then type a town (e.g. "Benešov") and tap "Hotovo".
2. Three stories marked "Zdarma" (Free) can be played without purchase.
3. Other stories are unlocked by the auto-renewable subscription "Ospalek Plus" (ospalek_plus_mesicne, 3-day free trial). Tap any locked story or the banner "Odemkněte všechny pohádky" to see the paywall; "Obnovit nákupy" restores purchases. Please use a sandbox account.
4. Background audio: start a story and lock the phone; playback continues and the lock screen shows Now Playing controls.
5. Offline: every story opened in the player is fully downloaded before it starts, so it also plays without internet afterwards.
6. Settings (gear icon) → "Smazat účet a všechna data" deletes the account and all data on our server.

No login, no ads, no third-party analytics. Stories are in Czech; the app is available in Czechia and Slovakia.
```

## Před odesláním ke kontrole

- [ ] Účet Apple Developer (organizace) schválený, Paid Apps Agreement, banka a daně vyplněné.
- [ ] App Store Small Business Program (provize 15 %).
- [ ] Předplatné založené a ve stavu *Ready to Submit*, přiložené k první verzi aplikace.
- [ ] Build nahraný z Xcode (Archive → Distribute → App Store Connect), otestovaný v TestFlightu na skutečném iPhonu:
      nákup v sandboxu, obnovení nákupu, hraní se zamčeným displejem, stažení pohádky, smazání dat.
- [x] Odkaz „Mám kód“ je v aplikaci pro iPhone skrytý (pravidlo 3.1.1 nedovoluje odemykat obsah vlastním kódem mimo
      nákup v aplikaci). Recenzent Applu testuje nákup v sandboxu; dárky a slevy na iPhonu přes nabídkové kódy App Storu
      (Offer Codes). Obchodní podmínky 1.19.
