package cz.ospalek.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // vlastní doplněk: přehrávání na pozadí a ovládání na zamčené obrazovce (PrehravacPlugin)
        registerPlugin(PrehravacPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
