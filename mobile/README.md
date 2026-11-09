# Ospalek pro Android a iOS (Capacitor)

Nativní obal webové aplikace z `../app`. Jeden projekt pro obě platformy:
`android/` je v repu, `ios/` přidá `npx cap add ios` (session iOS).

## Proč Capacitor, ne TWA

| | Capacitor | TWA (Trusted Web Activity) |
|---|---|---|
| Google Play Billing | nativní plugin (RevenueCat nebo vlastní) | jen přes Digital Goods API + Payment Request, složitější a jen Android |
| iOS | stejný projekt (`npx cap add ios`) | neexistuje, pro App Store by byl potřeba jiný obal |
| Offline poslech | soubory v aplikaci + stahování do zařízení (Filesystem) | jen Service Worker a cache prohlížeče, ta se může vymazat |
| Zvuk na pozadí / zamčený displej | nativní přehrávač s foreground service `mediaPlayback` a ovládáním na zamčené obrazovce | jen to, co dovolí Chrome; po zhasnutí se může zastavit |
| Zámek `gate.js` | do balíčku se nedává (skript `copy-web.mjs` ho vyřadí) | TWA otevírá živý web, zámek by uviděli i recenzenti Google |
| Aktualizace obsahu | nová verze v obchodě (nebo později živé aktualizace) | okamžitě z webu |

## Jak to funguje

- `npm run web` zkopíruje `../app`, `../config.js`, `../covers`, `../audio` a `../brand/{maskot-3d/web,ikony}` do `www/` se stejnými cestami jako na webu. `app/` se kvůli mobilu nemění.
- V nativní verzi chybí zámek `gate.js` a odkazy na obchodní podmínky a zásady vedou na `https://ospalek.cz/…` (otevřou se v prohlížeči).
- `www/` a `node_modules/` nejsou v gitu. Kopie webu uvnitř `android/app/src/main/assets/public` také ne.

## Příkazy

```bash
cd mobile
npm install
npm run sync            # www + cap sync
npm run android         # otevře projekt v Android Studiu
npm run android:build   # APK přes Gradle (potřebuje JDK 21 a Android SDK)
npm run android:run     # spustí v emulátoru nebo na telefonu
```

Potřeba: Android Studio (obsahuje JDK 21 a SDK), Android SDK 36, emulátor s Android 15/16.
`appId` je `cz.ospalek.app`. Po prvním nahrání do Google Play se už nedá změnit.

## Co ještě chybí (další kroky)

1. Platby: Google Play Billing a StoreKit, návrh čeká na schválení (RevenueCat vs. přímé napojení).
2. Přehrávání na pozadí: nativní audio plugin + foreground service `mediaPlayback` (a deklarace v Play Console).
3. Offline poslech: stáhnout nahrávky do zařízení (`@capacitor/filesystem`).
4. Ikona a splash screen z `brand/maskot-3d` (`@capacitor/assets`).
5. Smazání účtu v aplikaci i přes web (požadavek Google Play pro aplikace s účtem).
6. Podepisovací klíč pro vydání (Play App Signing) a verze `versionCode`.
