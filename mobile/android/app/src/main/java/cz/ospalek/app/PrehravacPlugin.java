package cz.ospalek.app;

import android.content.Intent;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Most mezi přehrávačem v aplikaci (app/media.js) a PrehravacService.
 *  update({ title, subtitle, artwork?, playing, hasPrev, hasNext }) – artwork jako data URL, jen když se změní
 *  stop() – pohádka zavřená, oznámení zmizí
 * Tlačítka ze zamčené obrazovky, oznámení a sluchátek přicházejí jako událost „action“ { action: play|pause|next|prev|stop }.
 */
@CapacitorPlugin(name = "Prehravac")
public class PrehravacPlugin extends Plugin {
    private static PrehravacPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    static void emit(String action) {
        if (instance == null) return;
        JSObject data = new JSObject();
        data.put("action", action);
        instance.notifyListeners("action", data, true);
    }

    @PluginMethod
    public void update(PluginCall call) {
        Intent i = new Intent(getContext(), PrehravacService.class).setAction(PrehravacService.ACTION_UPDATE);
        i.putExtra("title", call.getString("title", ""));
        i.putExtra("subtitle", call.getString("subtitle", ""));
        i.putExtra("playing", Boolean.TRUE.equals(call.getBoolean("playing", false)));
        i.putExtra("hasPrev", Boolean.TRUE.equals(call.getBoolean("hasPrev", false)));
        i.putExtra("hasNext", Boolean.TRUE.equals(call.getBoolean("hasNext", false)));
        // Obálka nejde službě v Intentu: data URL větší obálky má přes 500 kB, Android takový Intent
        // nedoručí (TransactionTooLargeException), služba se pak nespustí v popředí a systém aplikaci
        // po pár sekundách shodí (ForegroundServiceDidNotStartInTimeException). Proto se obálka
        // dekóduje a zmenší tady a služba si ji vezme ze sdíleného pole (stejný proces).
        String art = call.getString("artwork");
        if (art != null) {
            PrehravacService.nextArtwork = PrehravacService.decode(art);
            i.putExtra("newArtwork", true);
        }
        try {
            PrehravacService.running = true; // stop() hned potom musí službu zastavit, i když ještě nevznikla
            if (Boolean.TRUE.equals(call.getBoolean("playing", false))) ContextCompat.startForegroundService(getContext(), i);
            else getContext().startService(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Ovládání přehrávání se nepodařilo zobrazit.", e);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        // Ne stopService: kdyby služba ještě nestihla zpracovat startForegroundService (rychlé zavření
        // hned po Přehrát), Android by aplikaci shodil. ACTION_STOP se zpracuje až po předchozích příkazech.
        if (PrehravacService.running) {
            try {
                getContext().startService(new Intent(getContext(), PrehravacService.class).setAction(PrehravacService.ACTION_STOP));
            } catch (Exception e) {
                getContext().stopService(new Intent(getContext(), PrehravacService.class));
            }
        }
        call.resolve();
    }
}
