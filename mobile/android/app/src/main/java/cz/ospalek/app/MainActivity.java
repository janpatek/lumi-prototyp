package cz.ospalek.app;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "Ospalek";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Lokální pluginy je nutné zaregistrovat před super.onCreate, jinak je bridge nenajde.
        registerPlugin(PrehravacPlugin.class); // přehrávání na pozadí a ovládání na zamčené obrazovce
        registerPlugin(StorePlugin.class);     // předplatné přes Google Play Billing
        super.onCreate(savedInstanceState);

        // Proces WebView (stránka aplikace, hlas i hudba) může Android ukončit, nejčastěji kvůli paměti.
        // Capacitor to sám neošetří a Android pak zavře celou aplikaci („Render process's crash wasn't
        // handled“). Tady se výpadek převezme: zastaví se oznámení přehrávače a aktivita se vytvoří znovu
        // s novým WebView. Aplikace se načte zpátky a přehrávač nabídne pokračovat (app.js, resume).
        // Systémové Zpět (gesto i tlačítko): nejdřív ho dostane aplikace (zavře okno, přehrávač, poličku).
        // Bez toho Android aktivitu ukončil a celá aplikace se zavřela i uprostřed pohádky.
        // Na hlavní obrazovce se aplikace jen odsune do pozadí, pohádka může dohrát.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView wv = getBridge() != null ? getBridge().getWebView() : null;
                if (wv == null) {
                    moveTaskToBack(true);
                    return;
                }
                try {
                    wv.evaluateJavascript("(window.ospalekBack && window.ospalekBack()) ? '1' : '0'", result -> {
                        if (!"\"1\"".equals(result)) moveTaskToBack(true);
                    });
                } catch (Exception e) {
                    moveTaskToBack(true);
                }
            }
        });

        if (getBridge() != null) {
            getBridge().addWebViewListener(new WebViewListener() {
                @Override
                public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                    Log.w(TAG, "WebView skončilo (crash=" + (detail != null && detail.didCrash()) + "), aplikace se načte znovu");
                    try {
                        stopService(new Intent(MainActivity.this, PrehravacService.class));
                    } catch (Exception e) {
                        Log.w(TAG, "Přehrávač se nepodařilo zastavit", e);
                    }
                    new Handler(Looper.getMainLooper()).post(() -> {
                        if (!isFinishing() && !isDestroyed()) recreate();
                    });
                    return true; // výpadek je ošetřený, Android aplikaci nezavře
                }
            });
        }
    }
}
