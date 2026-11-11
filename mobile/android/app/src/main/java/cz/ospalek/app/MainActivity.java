package cz.ospalek.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Lokální pluginy je nutné zaregistrovat před super.onCreate, jinak je bridge nenajde.
        registerPlugin(PrehravacPlugin.class); // přehrávání na pozadí a ovládání na zamčené obrazovce
        registerPlugin(StorePlugin.class);     // předplatné přes Google Play Billing
        super.onCreate(savedInstanceState);
    }
}
