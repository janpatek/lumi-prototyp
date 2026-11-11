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
import android.os.Build;
import android.os.IBinder;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.util.Base64;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.media.app.NotificationCompat.MediaStyle;
import androidx.media.session.MediaButtonReceiver;

/**
 * Přehrávání pohádky na pozadí (Android).
 * Hlas i hudba hrají ve WebView (Web Audio). Tahle služba běží „v popředí“, dokud pohádka hraje, takže
 * systém aplikaci po zhasnutí displeje neuspí. Zároveň drží mediální relaci: na zamčené obrazovce
 * a v oznámení je obálka pohádky, název a tlačítka předchozí / přehrát-pozastavit / další.
 * Stisknutá tlačítka posílá zpátky do aplikace PrehravacPlugin (událost „action“).
 */
public class PrehravacService extends Service {
    static final String ACTION_UPDATE = "cz.ospalek.app.PREHRAVAC_UPDATE";
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

    @Override
    public void onCreate() {
        super.onCreate();
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
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_UPDATE.equals(intent.getAction())) {
            title = intent.getStringExtra("title") != null ? intent.getStringExtra("title") : title;
            subtitle = intent.getStringExtra("subtitle") != null ? intent.getStringExtra("subtitle") : subtitle;
            playing = intent.getBooleanExtra("playing", false);
            hasPrev = intent.getBooleanExtra("hasPrev", false);
            hasNext = intent.getBooleanExtra("hasNext", false);
            String art = intent.getStringExtra("artwork");
            if (art != null) artwork = decode(art);
            refresh();
        } else {
            // tlačítko ze sluchátek nebo z oznámení (MediaButtonReceiver)
            MediaButtonReceiver.handleIntent(session, intent);
            if (!foreground) refresh();
        }
        return START_NOT_STICKY;
    }

    private static Bitmap decode(String dataUrl) {
        try {
            String b64 = dataUrl.contains(",") ? dataUrl.substring(dataUrl.indexOf(',') + 1) : dataUrl;
            byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        } catch (Exception e) {
            return null;
        }
    }

    private void refresh() {
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

        if (playing) {
            // hraje: služba v popředí, systém aplikaci po zhasnutí displeje neuspí
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification,
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK : 0);
            foreground = true;
        } else {
            // pozastaveno: oznámení s tlačítkem Přehrát zůstane (jde odsunout), služba už nemusí být v popředí
            if (foreground) ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_DETACH);
            foreground = false;
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
        if (foreground) ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        getSystemService(NotificationManager.class).cancel(NOTIFICATION_ID);
        session.setActive(false);
        session.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
