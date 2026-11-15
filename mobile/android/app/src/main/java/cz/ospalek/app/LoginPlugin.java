package cz.ospalek.app;

import android.app.Activity;
import android.os.CancellationSignal;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.credentials.ClearCredentialStateRequest;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.ClearCredentialException;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.NoCredentialException;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;

/**
 * Volitelné přihlášení přes Google (app/auth.js). Credential Manager ukáže systémové okno s Google účty
 * v telefonu a vrátí ID token. Ten ověří Supabase (aplikace mu pošle i původní nonce) a propojí ho
 * s anonymním účtem uživatele.
 *
 *  google({ nonce }) → { idToken, email, name }   nonce = SHA-256 (hex) náhodného řetězce z auth.js
 *  signOut()                                     zapomene zvolený účet (příště se znovu nabídne výběr)
 *
 * Web client ID (OAuth klient typu „Web“ v Google Cloud, stejný jako v Supabase) je v config.js
 * jako googleWebClientId a přichází z aplikace v parametru clientId. Android klient (balíček + SHA-1
 * podpisového klíče) musí v Google Cloud existovat, jinak Google vrátí chybu „developer console is not set up“.
 */
@CapacitorPlugin(name = "OspalekLogin")
public class LoginPlugin extends Plugin {
    private static final String TAG = "OspalekLogin";

    @PluginMethod
    public void google(final PluginCall call) {
        String clientId = call.getString("clientId");
        String nonce = call.getString("nonce");
        if (clientId == null || clientId.isEmpty()) {
            call.reject("Přihlášení přes Google není v aplikaci nastavené.", "NOT_CONFIGURED");
            return;
        }
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Aplikace teď nemůže otevřít přihlášení, zkuste to prosím znovu.", "NO_ACTIVITY");
            return;
        }
        GetSignInWithGoogleOption.Builder option = new GetSignInWithGoogleOption.Builder(clientId);
        if (nonce != null && !nonce.isEmpty()) option.setNonce(nonce);
        GetCredentialRequest request = new GetCredentialRequest.Builder()
            .addCredentialOption(option.build())
            .build();

        CredentialManager manager = CredentialManager.create(activity);
        manager.getCredentialAsync(activity, request, new CancellationSignal(), ContextCompat.getMainExecutor(activity),
            new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override
                public void onResult(GetCredentialResponse response) {
                    Credential c = response.getCredential();
                    if (c instanceof CustomCredential && GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(c.getType())) {
                        try {
                            GoogleIdTokenCredential g = GoogleIdTokenCredential.createFrom(((CustomCredential) c).getData());
                            JSObject out = new JSObject();
                            out.put("idToken", g.getIdToken());
                            out.put("email", g.getId());
                            out.put("name", g.getDisplayName());
                            call.resolve(out);
                        } catch (Exception e) {
                            Log.w(TAG, "Neplatný Google token", e);
                            call.reject("Google vrátil neplatné přihlášení. Zkuste to prosím znovu.", "INVALID", e);
                        }
                    } else {
                        call.reject("Google vrátil neočekávané přihlášení.", "INVALID");
                    }
                }

                @Override
                public void onError(@NonNull GetCredentialException e) {
                    if (e instanceof GetCredentialCancellationException) {
                        call.reject("Přihlášení bylo zrušeno.", "CANCELLED");
                    } else if (e instanceof NoCredentialException) {
                        call.reject("V telefonu není přihlášený žádný Google účet. Přidejte ho v Nastavení → Účty a zkuste to znovu.", "NO_ACCOUNT");
                    } else {
                        Log.w(TAG, "Přihlášení přes Google selhalo: " + e.getType() + " " + e.getMessage());
                        call.reject("Přihlášení přes Google se nepovedlo. Zkuste to prosím znovu.", "ERROR", e);
                    }
                }
            });
    }

    @PluginMethod
    public void apple(PluginCall call) {
        call.reject("Přihlášení přes Apple je jen na iPhonu.", "UNAVAILABLE");
    }

    @PluginMethod
    public void signOut(final PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        CredentialManager.create(activity).clearCredentialStateAsync(new ClearCredentialStateRequest(), new CancellationSignal(),
            ContextCompat.getMainExecutor(activity), new CredentialManagerCallback<Void, ClearCredentialException>() {
                @Override
                public void onResult(Void unused) { call.resolve(); }

                @Override
                public void onError(@NonNull ClearCredentialException e) { call.resolve(); }
            });
    }
}
