package cz.ospalek.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioManager;
import android.os.Build;
import android.os.IBinder;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.util.Base64;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.media.AudioAttributesCompat;
import androidx.media.AudioFocusRequestCompat;
import androidx.media.AudioManagerCompat;
import androidx.media.app.NotificationCompat.MediaStyle;
import androidx.media.session.MediaButtonReceiver;

/**
 * Přehrávání pohádky na pozadí (Android).
 * Hlas i hudba hrají ve WebView (Web Audio). Tahle služba běží „v popředí“, dokud pohádka hraje, takže
 * systém aplikaci po zhasnutí displeje neuspí. Zároveň drží mediální relaci: na zamčené obrazovce
 * a v oznámení je obálka pohádky, název a tlačítka předchozí / přehrát-pozastavit / další.
 * Stisknutá tlačítka posílá zpátky do aplikace PrehravacPlugin (událost „action“).
 * Když pohádka hraje, drží si „audio focus“: Spotify a jiné přehrávače se zastaví. Když si zvuk vezme
 * jiná aplikace, pohádka se pozastaví; po hovoru nebo krátkém hlášení (navigace) zase pokračuje.
 * WebView si focus samo neřekne, proto to dělá tahle služba.
 */
public class PrehravacService extends Service {
    static final String ACTION_UPDATE = "cz.ospalek.app.PREHRAVAC_UPDATE";
    static final String ACTION_STOP = "cz.ospalek.app.PREHRAVAC_STOP";
    /** služba běží (PrehravacPlugin.stop() jí pak pošle ACTION_STOP, ne stopService) */
    static volatile boolean running;
    /** zmenšená obálka od PrehravacPlugin (Intent by byl pro Android moc velký) */
    static volatile Bitmap nextArtwork;
    /** služba je teď v popředí: další příkazy jdou přes startService (startForegroundService by z pozadí Android zakázal) */
    static volatile boolean foregroundNow;
    /** jak dlouho drží pozastavená pohádka službu v popředí (pak už jen obyčejné oznámení) */
    private static final long PAUSE_KEEP_FOREGROUND_MS = 30 * 60 * 1000L;
    private final android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable pauseExpired = () -> {
        // pohádka stojí dlouho: služba už nemusí držet aplikaci naživu
        if (!this.playing && this.foreground) {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_DETACH);
            this.foreground = false;
            foregroundNow = false;
            try { refresh(false); } catch (Exception e) { Log.w("Ospalek", "pauseExpired: " + e); }
        }
    };
    /** delší strana obálky v oznámení a na zamčené obrazovce */
    private static final int ARTWORK_MAX = 512;
    private static final String CHANNEL = "prehravani";
    private static final int NOTIFICATION_ID = 7;

    private MediaSessionCompat session;
    private Bitmap artwork;
    private String title = "";
    private String subtitle = "";
    private boolean playing;
    private boolean hasPrev;
    private boolean hasNext;
    private boolean foreground;

    private AudioManager audio;
    private AudioFocusRequestCompat focusRequest;
    private boolean hasFocus;
    private boolean pausedByFocus; // pozastavila to jiná aplikace na chvíli (hovor), po návratu pokračovat

    private final AudioManager.OnAudioFocusChangeListener focusListener = change -> {
        switch (change) {
            case AudioManager.AUDIOFOCUS_LOSS:
                // jiná aplikace začala hrát (Spotify, video): pohádka se pozastaví a sama už nepokračuje
                hasFocus = false;
                pausedByFocus = false;
                if (playing) PrehravacPlugin.emit("pause");
                break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                // hovor, budík, hlasová zpráva: pozastavit a potom pokračovat
                if (playing) {
                    pausedByFocus = true;
                    PrehravacPlugin.emit("pause");
                }
                break;
            case AudioManager.AUDIOFOCUS_GAIN:
                hasFocus = true;
                if (pausedByFocus) {
                    pausedByFocus = false;
                    PrehravacPlugin.emit("play");
                }
                break;
            default:
                // AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK (pokyn navigace): pohádka hraje dál
                break;
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Přehrávání pohádky", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Ovládání pohádky, která právě hraje");
            ch.setShowBadge(false);
            getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
        session = new MediaSessionCompat(this, "Ospalek");
        session.setCallback(new MediaSessionCompat.Callback() {
            @Override public void onPlay() { PrehravacPlugin.emit("play"); }
            @Override public void onPause() { PrehravacPlugin.emit("pause"); }
            @Override public void onSkipToNext() { PrehravacPlugin.emit("next"); }
            @Override public void onSkipToPrevious() { PrehravacPlugin.emit("prev"); }
            @Override public void onStop() { PrehravacPlugin.emit("stop"); }
        });
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        session.setSessionActivity(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        session.setActive(true);

        audio = getSystemService(AudioManager.class);
        focusRequest = new AudioFocusRequestCompat.Builder(AudioManagerCompat.AUDIOFOCUS_GAIN)
            .setAudioAttributes(new AudioAttributesCompat.Builder()
                .setUsage(AudioAttributesCompat.USAGE_MEDIA)
                .setContentType(AudioAttributesCompat.CONTENT_TYPE_SPEECH)
                .build())
            .setWillPauseWhenDucked(false)
            .setOnAudioFocusChangeListener(focusListener)
            .build();
    }

    private void requestFocus() {
        if (hasFocus || audio == null) return;
        hasFocus = AudioManagerCompat.requestAudioFocus(audio, focusRequest) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
    }

    private void abandonFocus() {
        if (!hasFocus || audio == null) return;
        AudioManagerCompat.abandonAudioFocusRequest(audio, focusRequest);
        hasFocus = false;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        try {
            handle(intent);
        } catch (Exception e) {
            // oznámení nebo mediální relace se nepovedly: pohádka hraje dál, aplikace nesmí spadnout
            Log.w("Ospalek", "PrehravacService: " + e);
        }
        // Spuštění přes startForegroundService (Přehrát, tlačítko sluchátek) musí VŽDY skončit voláním
        // startForeground, jinak Android aplikaci za pár sekund shodí. Když se plné oznámení nepovedlo,
        // stačí jednoduché bez obálky.
        if (!foreground && (playing || (intent != null && !ACTION_UPDATE.equals(intent.getAction()) && !ACTION_STOP.equals(intent.getAction())))) {
            fallbackForeground();
        }
        return START_NOT_STICKY;
    }

    private void fallbackForeground() {
        try {
            Notification n = new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_ospalek)
                .setContentTitle(title.isEmpty() ? "Ospalek" : title)
                .setContentText(subtitle)
                .setContentIntent(PendingIntent.getActivity(this, 0,
                    new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT))
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOnlyAlertOnce(true)
                .build();
            ServiceCompat.startForeground(this, NOTIFICATION_ID, n,
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK : 0);
            foreground = true;
            if (!playing) {
                ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
                foreground = false;
            }
        } catch (Exception e) {
            Log.w("Ospalek", "fallbackForeground: " + e);
        }
    }

    private void handle(Intent intent) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            // zavřená pohádka; přichází po případném startForegroundService, takže startForeground už proběhlo
            stopSelf();
        } else if (intent != null && ACTION_UPDATE.equals(intent.getAction())) {
            title = intent.getStringExtra("title") != null ? intent.getStringExtra("title") : title;
            subtitle = intent.getStringExtra("subtitle") != null ? intent.getStringExtra("subtitle") : subtitle;
            playing = intent.getBooleanExtra("playing", false);
            hasPrev = intent.getBooleanExtra("hasPrev", false);
            hasNext = intent.getBooleanExtra("hasNext", false);
            if (playing) {
                // pohádka hraje (rodič klepl na Přehrát): ostatní přehrávače ztichnou
                pausedByFocus = false;
                requestFocus();
            }
            if (intent.getBooleanExtra("newArtwork", false)) artwork = nextArtwork;
            refresh(false);
        } else {
            // tlačítko ze sluchátek nebo z oznámení (MediaButtonReceiver)
            MediaButtonReceiver.handleIntent(session, intent);
            // MediaButtonReceiver službu spouští přes startForegroundService: startForeground musí
            // proběhnout vždy, jinak by Android aplikaci shodil (i když pohádka nehraje)
            if (!foreground) refresh(true);
            // žádná pohádka není otevřená (aplikace ji zavřela): služba nemá co ovládat
            if (title.isEmpty() && !playing) {
                ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
                getSystemService(NotificationManager.class).cancel(NOTIFICATION_ID);
                stopSelf();
                // systém prázdné oznámení služby někdy odebere až po chvíli; pro jistotu ještě jednou
                new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                    if (!running) ((NotificationManager) getApplicationContext().getSystemService(NOTIFICATION_SERVICE)).cancel(NOTIFICATION_ID);
                }, 1500);
            }
        }
    }

    /** data URL obálky → bitmapa zmenšená na ARTWORK_MAX (velká bitmapa by se do oznámení a relace nevešla) */
    static Bitmap decode(String dataUrl) {
        try {
            String b64 = dataUrl.contains(",") ? dataUrl.substring(dataUrl.indexOf(',') + 1) : dataUrl;
            byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
            Bitmap b = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            if (b == null) return null;
            int w = b.getWidth(), h = b.getHeight(), max = Math.max(w, h);
            if (max <= ARTWORK_MAX) return b;
            float k = (float) ARTWORK_MAX / max;
            return Bitmap.createScaledBitmap(b, Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)), true);
        } catch (Throwable e) {
            return null;
        }
    }

    private void refresh(boolean mustStartForeground) {
        MediaMetadataCompat.Builder meta = new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, subtitle)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, "Ospalek");
        if (artwork != null) {
            meta.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, artwork);
            meta.putBitmap(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON, artwork);
        }
        session.setMetadata(meta.build());

        long actions = PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE
            | PlaybackStateCompat.ACTION_PLAY_PAUSE | PlaybackStateCompat.ACTION_STOP;
        if (hasPrev) actions |= PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS;
        if (hasNext) actions |= PlaybackStateCompat.ACTION_SKIP_TO_NEXT;
        session.setPlaybackState(new PlaybackStateCompat.Builder()
            .setActions(actions)
            .setState(playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
                PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN, playing ? 1f : 0f)
            .build());

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_ospalek)
            .setContentTitle(title)
            .setContentText(subtitle)
            .setLargeIcon(artwork)
            .setContentIntent(session.getController().getSessionActivity())
            .setDeleteIntent(MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_STOP))
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setOngoing(playing);
        int n = 0;
        int[] compact = new int[3];
        if (hasPrev) {
            b.addAction(new NotificationCompat.Action(android.R.drawable.ic_media_previous, "Předchozí pohádka",
                MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS)));
            compact[n] = n; n++;
        }
        b.addAction(playing
            ? new NotificationCompat.Action(android.R.drawable.ic_media_pause, "Pozastavit",
                MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_PAUSE))
            : new NotificationCompat.Action(android.R.drawable.ic_media_play, "Přehrát",
                MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_PLAY)));
        compact[n] = n; n++;
        if (hasNext) {
            b.addAction(new NotificationCompat.Action(android.R.drawable.ic_media_next, "Další pohádka",
                MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_SKIP_TO_NEXT)));
            compact[n] = n; n++;
        }
        int[] shown = new int[n];
        System.arraycopy(compact, 0, shown, 0, n);
        b.setStyle(new MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(shown));
        Notification notification = b.build();

        handler.removeCallbacks(pauseExpired);
        if (playing || mustStartForeground || foreground) {
            // Hraje, nebo je pozastavená a služba už v popředí je: zůstává v popředí. Kdyby při pauze
            // (hovor, zvuk oznámení, video v jiné aplikaci) z popředí odešla, Android by ji po návratu zvuku
            // z pozadí znovu spustit nedovolil: pohádka by nepokračovala, aplikaci by systém uspal
            // a přehrávač na zamčené obrazovce by zmizel.
            try {
                ServiceCompat.startForeground(this, NOTIFICATION_ID, notification,
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK : 0);
                foreground = true;
                if (!playing && mustStartForeground && title.isEmpty()) {
                    // jen splněný start z tlačítka sluchátek bez otevřené pohádky: hned zpátky mimo popředí
                    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_DETACH);
                    foreground = false;
                } else if (!playing) {
                    handler.postDelayed(pauseExpired, PAUSE_KEEP_FOREGROUND_MS);
                }
                foregroundNow = foreground;
            } catch (Exception e) {
                // Android 12+ nedovolí službu v popředí spustit z pozadí (např. Přehrát ze zamčené obrazovky
                // po delší pauze). Pohádka hraje dál, jen oznámení zůstane obyčejné.
                Log.w("Ospalek", "startForeground: " + e);
                getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification);
            }
        } else {
            // pozastaveno dlouho (nebo služba v popředí nikdy nebyla): obyčejné oznámení s tlačítkem Přehrát
            foreground = false;
            foregroundNow = false;
            getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification);
        }
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // aplikace odsunutá z přehledu: pohádka skončí, oznámení zmizí
        stopSelf();
    }

    @Override
    public void onDestroy() {
        running = false;
        foregroundNow = false;
        handler.removeCallbacks(pauseExpired);
        abandonFocus();
        if (foreground) ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        getSystemService(NotificationManager.class).cancel(NOTIFICATION_ID);
        // po zavření pohádky už tlačítka sluchátek / auta nemají aplikaci budit (systém by jinak
        // službu znovu spouštěl přes MediaButtonReceiver a musela by ukázat oznámení)
        session.setMediaButtonReceiver(null);
        session.setActive(false);
        session.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
