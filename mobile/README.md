# Ospalek pro Android a iOS (Capacitor)

Nativní obal webové aplikace z `../app`. Jeden projekt pro obě platformy:
`android/` a `ios/` (Xcode projekt, Swift Package Manager, bez CocoaPods) jsou v repu.

## Proč Capacitor, ne TWA

| | Capacitor | TWA (Trusted Web Activity) |
|---|---|---|
| Google Play Billing | nativní plugin (vlastní OspalekStore) | jen přes Digital Goods API + Payment Request, složitější a jen Android |
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

```bash
npm run ios             # otevře projekt v Xcode
npm run ios:build       # sestavení pro iOS Simulator (xcodebuild)
npm run ios:run         # spustí v iOS Simulatoru
```

iOS: potřeba plné Xcode (ne jen Command Line Tools) s iOS platformou: `sudo xcode-select -s /Applications/Xcode.app`.
Nastaveno: `UIBackgroundModes: audio` a `AVAudioSession` `.playback` (hraje se zamčenou obrazovkou i s přepínačem ticha), jazyk cs/sk, poloha jen při používání (`NSLocationWhenInUseUsageDescription`).
Checklist pro App Store a technický návrh pro iOS: poznámka `ios-app-store.md` ve sdílené složce poznámek sessions.

Android: Android Studio, Android SDK 36, build-tools 35.0.0 (chce je AGP 8.13) a emulátor s Androidem 16.
**JDK 21**: Java přibalená k Android Studiu 2026.2 je verze 25 a Gradle 8.14 na ní nejede. Před sestavením:

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 21) ANDROID_HOME=~/Library/Android/sdk
```

Ověřeno 10. 11. 2026: debug APK se sestaví a běží v emulátoru Pixel 8, Android 16 (Google Play). Hláška „Error injecting safe area CSS“ při startu je neškodná, Capacitor zapisuje okraje displeje dřív, než se stránka načte.

### Vydání do Google Play (podepsaný AAB)

Upload key leží mimo repo v `~/.ospalek-keys/ospalek-upload.jks` (alias `upload`), heslo je v Klíčence macOS pod „Ospalek Android upload key“. Klíč zálohujte, při ztrátě jde u Googlu vyměnit (Play App Signing), ale trvá to. Release se podepíše jen s nastavenými proměnnými:

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 21) ANDROID_HOME=~/Library/Android/sdk
export OSPALEK_UPLOAD_STORE=~/.ospalek-keys/ospalek-upload.jks
export OSPALEK_UPLOAD_PASSWORD="$(security find-generic-password -a ospalek-upload -s 'Ospalek Android upload key' -w)"
npm run android:bundle   # → android/app/build/outputs/bundle/release/app-release.aab
```

Před každým dalším nahráním zvyšte `versionCode` v `android/app/build.gradle`. Verze 5 (1.4: 103 pohádek, stahování na vyžádání, přehrávání na pozadí s ovládáním na zamčené obrazovce, nový paywall) je připravená 11. 11. 2026 k nahrání do interního testování.

`appId` je `cz.ospalek.app`. Po prvním nahrání do Google Play se už nedá změnit.

## Co ještě chybí (další kroky)

1. Platby: vlastní plugin **OspalekStore** (11. 11. 2026, místo RevenueCat): Android `android/app/src/main/java/cz/ospalek/app/StorePlugin.java` (Google Play Billing 8.3), iOS `ios/App/App/StorePlugin.swift` (StoreKit 2, registrace v `MainViewController.swift`). JS v `app/billing.js`, ověření nákupů a oznámení obchodů v `supabase/functions/store`. Chybí nastavit produkty a oznámení v Play Console a App Store Connect (`supabase/README.md`, sekce Předplatné). Na iOS jde nákup zkusit v simulátoru s `ios/App/Ospalek.storekit` (Edit Scheme → Run → Options → StoreKit Configuration).
2. Přehrávání na pozadí: hotové ve verzi 1.4 (PrehravacService, viz Přehrávání na pozadí). V Play Console je potřeba vyplnit deklaraci služby na popředí `mediaPlayback` s videem (GOOGLE-PLAY.md) a ověřit na skutečném telefonu.
3. Offline poslech a stahování na vyžádání: hotové ve verzi 1.4 (`@capacitor/filesystem`, app/remote.js).
4. Ikona Androidu je hotová (plyšový Ospalek, pozadí `#C9C3EC`, commit 5a3e0ec). Chybí úvodní obrazovka (splash) a ikona 512×512 pro záznam v Google Play.
5. Smazání účtu: v aplikaci „Smazat účet a všechna data“, na webu návod https://ospalek.cz/smazani-uctu/ (adresa do Play Console → Bezpečnost údajů).
6. Podepisovací klíč pro vydání (Play App Signing) a verze `versionCode`.

## Co je v balíčku a co se stahuje

`npm run web` (scripts/copy-web.mjs) přibalí aplikaci, obálky, kulisy a z hlasu jen věty pohádek zdarma
(`node tools/hlas/plan.mjs klice`, seznam v `www/audio/hlas/jana/bundled.json`). Balíček má tak asi 65 MB místo 480 MB.

Ostatní věty si aplikace stáhne z ospalek.cz při prvním poslechu nebo tlačítkem *Stáhnout na cestu* a uloží je
přes `@capacitor/filesystem` do složky `hlas/` v datech aplikace (app/remote.js). Při startu a po návratu
z pozadí si stáhne aktuální `app/stories.cs.js` z webu a přidá pohádky, které v balíčku ještě nejsou
(app/catalog.js), takže nové pohádky nepotřebují novou verzi v obchodě – stačí je nasadit na web.

## Přehrávání na pozadí

Pohádka hraje dál i se zhasnutým displejem. Hlas a hudba hrají ve WebView (Web Audio), aplikaci drží naživu
služba v popředí `PrehravacService` (typ mediaPlayback) s mediální relací: na zamčené obrazovce a v oznámeních
je obálka, název a tlačítka předchozí / přehrát-pozastavit / další; fungují i tlačítka na sluchátkách.
JS strana je `app/media.js`, doplněk `PrehravacPlugin` (registrovaný v MainActivity). Předchozí / další
přepíná pohádky v pořadí poličky, ze které se pohádka otevřela, a přeskočí zamčené.
Když pohádka hraje, služba drží audio focus (WebView si o něj samo neřekne): Spotify a jiné přehrávače se zastaví,
a když začne hrát jiná aplikace, pohádka se pozastaví. Po hovoru nebo budíku pokračuje sama.
Služba se spouští hned po klepnutí na Přehrát, i když se pohádka teprve připravuje (rodič často hned zhasne
displej; bez služby Android přípravu na pozadí zastaví a službu později spustit nedovolí).
Pozor na velikost dat v Intentu: obálka jde do služby jako zmenšená bitmapa přes sdílené pole
(`PrehravacService.nextArtwork`), ne jako data URL v Intentu. Intent nad ~500 kB Android nedoručí
(TransactionTooLargeException), služba nezavolá `startForeground` a systém aplikaci za pár sekund shodí
(ForegroundServiceDidNotStartInTimeException). `onStartCommand` proto `startForeground` volá vždy, v nouzi
s jednoduchým oznámením. Služba zůstává v popředí i během pauzy (nejvýš 30 minut, pak už jen obyčejné oznámení). Kdyby při pauze z popředí
odešla (hovor, zvuk oznámení, video v jiné aplikaci), Android by ji po návratu zvuku z pozadí znovu spustit nedovolil
(ForegroundServiceStartNotAllowedException): pohádka by stála a přehrávač na zamčené obrazovce by zmizel. Plugin proto
pro běžící službu v popředí používá startService. Test: pohádka hraje, aplikace na pozadí, `adb emu gsm call 777123456`
a `adb emu gsm cancel 777123456`; pohádka musí sama pokračovat a `dumpsys activity services cz.ospalek.app` ukazuje
`isForeground=true`.
Testovat release sestavení (`assembleRelease`, podepsat ladicím klíčem přes apksigner),
a s pohádkou s velkou obálkou (např. Sůl nad zlato).
Ladění: `adb shell cmd media_session dispatch next`, stav `adb shell dumpsys media_session`.
Focus: `adb shell dumpsys audio` (Audio Focus stack), hovor v emulátoru `adb emu gsm call 777123456` / `adb emu gsm cancel 777123456`.

iPhone: aplikace má v Info.plist režim pozadí `audio` a stránka si řekne o `navigator.audioSession.type = 'playback'`
(hraje i s tichým režimem a se zamčenou obrazovkou). Právě hraje na zamčené obrazovce a v Ovládacím centru dělá
vlastní doplněk `PrehravacPlugin.swift` (registrovaný v `MainViewController.swift`, stejné rozhraní jako na Androidu):
MPNowPlayingInfoCenter s obálkou, MPRemoteCommandCenter s tlačítky přehrát/pozastavit/další/předchozí/stop.
`navigator.mediaSession` se na iPhonu nepoužívá: WebKit z ní pro Web Audio ukázal jen název bez obálky a tlačítek.
Hovor, budík nebo Siri pohádku pozastaví a po konci přerušení pokračuje sama (AVAudioSession interruption);
vytažená sluchátka ji pozastaví. Po tlačítku ze zamčené obrazovky si doplněk vezme až 25 s běhu na pozadí,
aby uspaná aplikace stihla rozjet zvuk nebo připravit další pohádku.

Věty se jmény dítěte (tts-worker) leží na iPhonu v souborech (`rodina/`, app/offline.js), ne v IndexedDB:
IndexedDB ve WKWebView po zamčení telefonu přestane odpovídat a příprava další pohádky stála na 0 %.

Test v simulátoru (ověřeno 13. 11. 2026, iPhone 18 Pro, iOS 27.2, Release): pohádka hraje na pozadí i se zamčenou
obrazovkou do konce, Právě hraje má obálku a název, iOS registruje tlačítka (log `mediaremoted`: supportedCommands),
obec podle polohy (`xcrun simctl location booted set 49.17,16.74`). Simulátor ale tlačítka na zamčené obrazovce
nevykreslí, aplikaci v pauze neuspí („process is simulated“) a nedoručí přerušení hovorem – to je potřeba ověřit
na skutečném iPhonu (TestFlight). Nákup jde v simulátoru jen při spuštění z Xcode s `Ospalek.storekit`.
