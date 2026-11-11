# Večerní upozornění „Je čas na pohádku“ (push-worker)

Každý den v 19:00 (pražského času, hodina jde změnit v administraci) dostanou rodiny, které si v aplikaci zapnuly
připomínku, upozornění s pohádkou dne. Klepnutí otevře aplikaci rovnou na té pohádce.

```
aplikace ──(app_push_subscribe)──► Supabase push_subs
administrace ──(admin_push_save, admin_daily_set)──► push_settings, daily_story
Cloudflare cron (každou hodinu) ──► ospalek-push ──(push_start, push_batch)──► Supabase
                                       └─► push služba prohlížeče (Google / Apple / Mozilla / Microsoft) ──► telefon (app/sw.js)
```

- **Pohádka dne** je pro všechny stejná: ručně vybraná v administraci (stránka *Pohádka dne*), jinak další v pořadí ze střídání.
  Stejná pohádka je navrchu knihovny v aplikaci.
- **Jména dětí na server nejdou.** Zpráva nese jen nadpis, text se zástupným `{pohadka}` a id pohádky. Název se jménem
  dítěte („Toník a kouzelná lednice“) si aplikace ukládá v zařízení a doplní ho až service worker (`app/sw.js`).
- **Zprávy jsou zašifrované** pro konkrétní prohlížeč (RFC 8291) a podepsané klíčem VAPID (RFC 8292). Push služba obsah nepřečte.
- Zaniklé odběry (push služba odpoví 404/410) a odběry 5× po sobě nedoručené se samy smažou. Účet může mít nejvýš 3 zařízení.
- **iPhone:** upozornění chodí jen z Ospalka přidaného na plochu (Safari → Sdílet → Přidat na plochu, iOS 16.4+). Aplikace to rodinám vysvětlí.
- **Mobilní aplikace (Capacitor)** Web Push neumí. Potřebuje nativní upozornění (APNs / FCM), zatím nejsou.

## Zapojení (jednou, asi 15 minut)

1. **Databáze:** v Supabase → SQL Editor spusť znovu celý `supabase/schema.sql` (přidá tabulky `push_settings`, `daily_story`,
   `push_subs`, `push_log` a funkce `app_daily`, `app_push_*`, `admin_push*`, `admin_daily_set`, `push_*`).
2. **Worker:** `cd push-worker && npx wrangler deploy` (stejný účet Cloudflare jako `tts-worker`).
3. **Tajný klíč Supabase:** v Supabase → Project Settings → API Keys vytvoř *Secret key* (`sb_secret_…`, pojmenuj ho třeba `push-worker`) a vlož ho:
   ```bash
   cd push-worker && npx wrangler secret put SUPABASE_SECRET
   ```
   Klíč smí v databázi volat jen `push_start`, `push_batch` a `push_report`. Do webu ani do repozitáře nepatří.
4. **Klíče VAPID:** `node push-worker/klice.mjs`. Soukromý klíč uloží rovnou do Workeru, veřejný zapíše do `config.js` a `wrangler.toml`.
   Pak ještě jednou `cd push-worker && npx wrangler deploy` a změnu `config.js` nahraj na web. Teprve potom se aplikace začne na připomínku ptát.
   Klíče neměň: nové klíče zruší všechny odběry.
5. **Zkouška:** administrace → *Pohádka dne* → *Poslat zkoušku sem*. Prohlížeč se zeptá na povolení a upozornění přijde do pár vteřin.
   Stav Workeru: `https://ospalek-push.jan-patek.workers.dev/` vrací `{"vapid":true,"db":true}`.

## Kolik rodin zvládne

Tarif Workers Free dovolí jednomu volání 50 požadavků ven. Worker proto posílá po dávkách (`BATCH_SIZE` = 40), každou dávku
jako samostatné volání sebe sama (vazba `SELF`). Na Free tak zvládne zhruba 1 800 odběrů za večer.
Nad to přejdi na Workers Paid (5 USD měsíčně, 1 000 požadavků na volání) a zvyš `BATCH_SIZE` na 400 (~18 000 odběrů).
Výsledek každého večera je v administraci v *Historii rozesílání* a v Cloudflare → Workers → ospalek-push → Logs.

## Lokální zkouška bez Cloudflaru

```bash
node supabase/dev-server.mjs --seed 60
```

```bash
node push-worker/dev.mjs
```

- `node push-worker/test.mjs` ověří šifrování a podpis VAPID (prohlížeč napodobený podle RFC).
- `http://localhost:8788/__cron?t=2026-11-11T19:00:00%2B01:00` spustí denní rozeslání, jako by byl ten čas.
- Napodobená push služba je `http://localhost:8788/fake-push/…` (co přijala, ukáže `/__inbox`).
- Administrace: `http://localhost:5174/admin/?db=http://localhost:54321&push=http://localhost:8788#upozorneni`.
- Aplikace: `http://localhost:5174/app/?db=http://localhost:54321&tts=http://localhost:8787`. Klíč VAPID si vezme z napodobeniny Supabase.
  V Chromu nebo Firefoxu na `localhost` dostaneš skutečný odběr od Googlu/Mozilly a lokální Worker na něj upozornění opravdu doručí.
