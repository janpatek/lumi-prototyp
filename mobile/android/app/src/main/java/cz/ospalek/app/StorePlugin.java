package cz.ospalek.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Předplatné Ospalka přes Google Play Billing. Nahrazuje RevenueCat.
 *
 * JS strana (app/billing.js) volá metody product, buy, entitlement, restore a manage.
 * Tvary výsledků jsou závazné. Časy jsou v milisekundách.
 *
 * Play Billing nedává konec období ani informaci, jestli běží zkušební doba.
 * To dopočítá server z purchase tokenu, proto plugin žádné "expires" nevrací.
 */
@CapacitorPlugin(name = "OspalekStore")
public class StorePlugin extends Plugin implements PurchasesUpdatedListener {

    private static final String TAG = "OspalekStore";
    private static final String PACKAGE = "cz.ospalek.app";

    /** Jediný BillingClient pro celý plugin. Vzniká líně při prvním volání. */
    private BillingClient billingClient;

    /** Úlohy čekající na připojení ke službě Play. */
    private final List<ConnectionTask> waiting = new ArrayList<>();
    private boolean connecting = false;

    /** Rozpracovaný nákup. Výsledek přijde v onPurchasesUpdated. */
    private PluginCall pendingBuyCall;
    private String pendingBuyProductId;

    private interface ConnectionTask {
        void onReady();

        void onError(BillingResult result);
    }

    // ---------------------------------------------------------------------
    // Připojení
    // ---------------------------------------------------------------------

    private synchronized BillingClient client() {
        if (billingClient == null) {
            billingClient = BillingClient.newBuilder(getContext())
                .setListener(this)
                .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
                .enableAutoServiceReconnection()
                .build();
        }
        return billingClient;
    }

    /** Spustí úlohu, až bude klient připojený. Když spojení spadlo, připojí se znovu. */
    private void withConnection(ConnectionTask task) {
        BillingClient client = client();
        if (client.isReady()) {
            task.onReady();
            return;
        }
        synchronized (this) {
            waiting.add(task);
            if (connecting) return;
            connecting = true;
        }
        client.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(@NonNull BillingResult result) {
                List<ConnectionTask> tasks;
                synchronized (StorePlugin.this) {
                    connecting = false;
                    tasks = new ArrayList<>(waiting);
                    waiting.clear();
                }
                for (ConnectionTask t : tasks) {
                    if (result.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                        t.onReady();
                    } else {
                        t.onError(result);
                    }
                }
            }

            @Override
            public void onBillingServiceDisconnected() {
                // Další volání se připojí znovu (a enableAutoServiceReconnection to zkusí i samo).
                synchronized (StorePlugin.this) {
                    connecting = false;
                }
                Log.w(TAG, "Spojení s Google Play bylo přerušeno.");
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        if (billingClient != null) {
            billingClient.endConnection();
            billingClient = null;
        }
        super.handleOnDestroy();
    }

    // ---------------------------------------------------------------------
    // product({ productId, basePlanId })
    // ---------------------------------------------------------------------

    @PluginMethod
    public void product(final PluginCall call) {
        final String productId = call.getString("productId");
        final String basePlanId = call.getString("basePlanId");
        if (isEmpty(productId) || isEmpty(basePlanId)) {
            call.reject("Chybí productId nebo basePlanId.", "INVALID_ARGUMENT");
            return;
        }
        loadProduct(call, productId, basePlanId, (details, offer) -> {
            JSObject out = new JSObject();
            out.put("productId", details.getProductId());

            ProductDetails.PricingPhase recurring = recurringPhase(details, basePlanId, offer);
            if (recurring != null) {
                out.put("price", recurring.getFormattedPrice());
                out.put("priceMicros", recurring.getPriceAmountMicros());
                out.put("currency", recurring.getPriceCurrencyCode());
            } else {
                out.put("price", null);
                out.put("priceMicros", null);
                out.put("currency", null);
            }

            ProductDetails.PricingPhase trial = trialPhase(offer);
            out.put("trial", trial != null);
            out.put("trialDays", trial != null ? trialDays(trial) : 0);
            out.put("offerToken", offer.getOfferToken());
            call.resolve(out);
        });
    }

    private interface ProductCallback {
        void onProduct(ProductDetails details, ProductDetails.SubscriptionOfferDetails offer);
    }

    /** Načte ProductDetails a vybere nabídku, kterou by koupil buy. Při chybě call rejectne. */
    private void loadProduct(final PluginCall call, final String productId, final String basePlanId, final ProductCallback cb) {
        withConnection(new ConnectionTask() {
            @Override
            public void onReady() {
                QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
                    .setProductList(Collections.singletonList(
                        QueryProductDetailsParams.Product.newBuilder()
                            .setProductId(productId)
                            .setProductType(BillingClient.ProductType.SUBS)
                            .build()))
                    .build();
                client().queryProductDetailsAsync(params, (result, queryResult) -> {
                    if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                        rejectBilling(call, result);
                        return;
                    }
                    ProductDetails details = null;
                    for (ProductDetails d : queryResult.getProductDetailsList()) {
                        if (productId.equals(d.getProductId())) {
                            details = d;
                            break;
                        }
                    }
                    if (details == null) {
                        call.reject("Předplatné " + productId + " v Google Play nebylo nalezeno.", "NOT_FOUND");
                        return;
                    }
                    ProductDetails.SubscriptionOfferDetails offer = chooseOffer(details, basePlanId);
                    if (offer == null) {
                        call.reject("Plán " + basePlanId + " předplatného " + productId + " v Google Play nebyl nalezen.", "NOT_FOUND");
                        return;
                    }
                    cb.onProduct(details, offer);
                });
            }

            @Override
            public void onError(BillingResult result) {
                rejectBilling(call, result);
            }
        });
    }

    /**
     * Nabídka se zkušební fází (fáze za 0), pokud na ni má uživatel nárok, jinak základní plán bez offerId.
     * Play vrací jen nabídky, na které má uživatel nárok.
     */
    @Nullable
    private static ProductDetails.SubscriptionOfferDetails chooseOffer(ProductDetails details, String basePlanId) {
        List<ProductDetails.SubscriptionOfferDetails> offers = details.getSubscriptionOfferDetails();
        if (offers == null) return null;
        ProductDetails.SubscriptionOfferDetails base = null;
        for (ProductDetails.SubscriptionOfferDetails o : offers) {
            if (!basePlanId.equals(o.getBasePlanId())) continue;
            if (trialPhase(o) != null) return o;
            if (o.getOfferId() == null && base == null) base = o;
        }
        return base;
    }

    @Nullable
    private static ProductDetails.PricingPhase trialPhase(ProductDetails.SubscriptionOfferDetails offer) {
        for (ProductDetails.PricingPhase p : offer.getPricingPhases().getPricingPhaseList()) {
            if (p.getPriceAmountMicros() == 0) return p;
        }
        return null;
    }

    /** Cena opakované fáze základního plánu (ne nulová zkušební). */
    @Nullable
    private static ProductDetails.PricingPhase recurringPhase(ProductDetails details, String basePlanId,
                                                              ProductDetails.SubscriptionOfferDetails chosen) {
        ProductDetails.SubscriptionOfferDetails source = chosen;
        List<ProductDetails.SubscriptionOfferDetails> offers = details.getSubscriptionOfferDetails();
        if (offers != null) {
            for (ProductDetails.SubscriptionOfferDetails o : offers) {
                if (basePlanId.equals(o.getBasePlanId()) && o.getOfferId() == null) {
                    source = o;
                    break;
                }
            }
        }
        List<ProductDetails.PricingPhase> phases = source.getPricingPhases().getPricingPhaseList();
        for (ProductDetails.PricingPhase p : phases) {
            if (p.getRecurrenceMode() == ProductDetails.RecurrenceMode.INFINITE_RECURRING) return p;
        }
        return phases.isEmpty() ? null : phases.get(phases.size() - 1);
    }

    private static final Pattern ISO_PERIOD = Pattern.compile("P(?:(\\d+)Y)?(?:(\\d+)M)?(?:(\\d+)W)?(?:(\\d+)D)?");

    /** Délka zkušební fáze ve dnech z ISO 8601 (P3D → 3, P1W → 7, P1M → 30). */
    private static int trialDays(ProductDetails.PricingPhase phase) {
        Matcher m = ISO_PERIOD.matcher(phase.getBillingPeriod());
        if (!m.matches()) return 0;
        int days = num(m.group(1)) * 365 + num(m.group(2)) * 30 + num(m.group(3)) * 7 + num(m.group(4));
        int cycles = Math.max(1, phase.getBillingCycleCount());
        return days * cycles;
    }

    private static int num(String s) {
        return s == null ? 0 : Integer.parseInt(s);
    }

    // ---------------------------------------------------------------------
    // buy({ productId, basePlanId, account })
    // ---------------------------------------------------------------------

    @PluginMethod
    public void buy(final PluginCall call) {
        final String productId = call.getString("productId");
        final String basePlanId = call.getString("basePlanId");
        final String account = call.getString("account");
        if (isEmpty(productId) || isEmpty(basePlanId)) {
            call.reject("Chybí productId nebo basePlanId.", "INVALID_ARGUMENT");
            return;
        }
        synchronized (this) {
            if (pendingBuyCall != null) {
                call.reject("Jiný nákup právě probíhá.", "BUSY");
                return;
            }
        }
        loadProduct(call, productId, basePlanId, (details, offer) -> {
            final Activity activity = getActivity();
            if (activity == null) {
                call.reject("Aplikace teď nemůže otevřít platbu, zkuste to prosím znovu.", "NO_ACTIVITY");
                return;
            }
            BillingFlowParams.Builder builder = BillingFlowParams.newBuilder()
                .setProductDetailsParamsList(Collections.singletonList(
                    BillingFlowParams.ProductDetailsParams.newBuilder()
                        .setProductDetails(details)
                        .setOfferToken(offer.getOfferToken())
                        .build()));
            // UUID rodiny, server podle něj páruje předplatné s rodinou.
            if (!isEmpty(account)) builder.setObfuscatedAccountId(account);
            final BillingFlowParams flowParams = builder.build();

            synchronized (StorePlugin.this) {
                if (pendingBuyCall != null) {
                    call.reject("Jiný nákup právě probíhá.", "BUSY");
                    return;
                }
                pendingBuyCall = call;
                pendingBuyProductId = productId;
            }
            call.setKeepAlive(true);

            activity.runOnUiThread(() -> {
                BillingResult result = client().launchBillingFlow(activity, flowParams);
                if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                    // Dialog se neotevřel, onPurchasesUpdated nepřijde (s výjimkou některých chyb, ty ošetří takeBuyCall).
                    PluginCall pending = takeBuyCall();
                    if (pending != null) finishBuyWithResult(pending, productId, result, null);
                }
            });
        });
    }

    @Nullable
    private synchronized PluginCall takeBuyCall() {
        PluginCall c = pendingBuyCall;
        pendingBuyCall = null;
        pendingBuyProductId = null;
        return c;
    }

    @Override
    public void onPurchasesUpdated(@NonNull BillingResult result, @Nullable List<Purchase> purchases) {
        String productId;
        synchronized (this) {
            productId = pendingBuyProductId;
        }
        PluginCall call = takeBuyCall();
        if (call == null) {
            // Aktualizace bez čekajícího volání (např. dokončená odložená platba). Potvrdíme ji,
            // aby ji Google nevrátil. Stav si JS zjistí přes entitlement.
            if (result.getResponseCode() == BillingClient.BillingResponseCode.OK && purchases != null) {
                for (Purchase p : purchases) {
                    if (p.getPurchaseState() == Purchase.PurchaseState.PURCHASED && !p.isAcknowledged()) {
                        acknowledge(p, ok -> { });
                    }
                }
            }
            return;
        }
        finishBuyWithResult(call, productId, result, purchases);
    }

    private void finishBuyWithResult(final PluginCall call, final String productId, BillingResult result,
                                     @Nullable List<Purchase> purchases) {
        call.setKeepAlive(false);
        int code = result.getResponseCode();
        if (code == BillingClient.BillingResponseCode.OK) {
            Purchase p = findPurchase(purchases, productId);
            if (p == null) {
                call.reject("Google Play nákup potvrdil, ale nevrátil ho.", "ERROR");
                return;
            }
            resolveBuy(call, p, productId);
        } else if (code == BillingClient.BillingResponseCode.USER_CANCELED) {
            JSObject out = new JSObject();
            out.put("status", "cancelled");
            out.put("purchase", JSObject.NULL);
            call.resolve(out);
        } else if (code == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) {
            // Předplatné už uživatel má, vrátíme nalezenou koupi jako úspěch.
            queryPurchase(productId, new PurchaseCallback() {
                @Override
                public void onPurchase(@Nullable Purchase p) {
                    if (p == null) {
                        rejectBilling(call, result);
                    } else {
                        resolveBuy(call, p, productId);
                    }
                }

                @Override
                public void onError(BillingResult error) {
                    rejectBilling(call, error);
                }
            });
        } else {
            rejectBilling(call, result);
        }
    }

    private void resolveBuy(final PluginCall call, final Purchase p, final String productId) {
        if (p.getPurchaseState() == Purchase.PurchaseState.PENDING) {
            JSObject out = new JSObject();
            out.put("status", "pending");
            out.put("purchase", purchaseJson(p, productId, false));
            call.resolve(out);
            return;
        }
        ensureAcknowledged(p, acknowledged -> {
            JSObject out = new JSObject();
            out.put("status", "ok");
            out.put("purchase", purchaseJson(p, productId, acknowledged));
            call.resolve(out);
        });
    }

    // ---------------------------------------------------------------------
    // entitlement({ productId }) a restore({ productId })
    // ---------------------------------------------------------------------

    @PluginMethod
    public void entitlement(final PluginCall call) {
        final String productId = call.getString("productId");
        if (isEmpty(productId)) {
            call.reject("Chybí productId.", "INVALID_ARGUMENT");
            return;
        }
        queryPurchase(productId, new PurchaseCallback() {
            @Override
            public void onPurchase(@Nullable Purchase p) {
                if (p == null || p.getPurchaseState() != Purchase.PurchaseState.PURCHASED) {
                    JSObject out = new JSObject();
                    out.put("active", false);
                    out.put("willRenew", false);
                    out.put("purchase", JSObject.NULL);
                    call.resolve(out);
                    return;
                }
                ensureAcknowledged(p, acknowledged -> {
                    JSObject out = new JSObject();
                    out.put("active", true);
                    out.put("willRenew", p.isAutoRenewing());
                    out.put("purchase", purchaseJson(p, productId, acknowledged));
                    call.resolve(out);
                });
            }

            @Override
            public void onError(BillingResult result) {
                rejectBilling(call, result);
            }
        });
    }

    @PluginMethod
    public void restore(final PluginCall call) {
        entitlement(call);
    }

    private interface PurchaseCallback {
        void onPurchase(@Nullable Purchase p);

        void onError(BillingResult result);
    }

    /** Najde aktuální koupi předplatného productId (přednostně ve stavu PURCHASED). */
    private void queryPurchase(final String productId, final PurchaseCallback cb) {
        withConnection(new ConnectionTask() {
            @Override
            public void onReady() {
                QueryPurchasesParams params = QueryPurchasesParams.newBuilder()
                    .setProductType(BillingClient.ProductType.SUBS)
                    .build();
                client().queryPurchasesAsync(params, (result, list) -> {
                    if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                        cb.onError(result);
                        return;
                    }
                    cb.onPurchase(findPurchase(list, productId));
                });
            }

            @Override
            public void onError(BillingResult result) {
                cb.onError(result);
            }
        });
    }

    @Nullable
    private static Purchase findPurchase(@Nullable List<Purchase> purchases, String productId) {
        if (purchases == null) return null;
        Purchase fallback = null;
        for (Purchase p : purchases) {
            if (productId != null && !p.getProducts().contains(productId)) continue;
            if (p.getPurchaseState() == Purchase.PurchaseState.PURCHASED) return p;
            if (fallback == null) fallback = p;
        }
        return fallback;
    }

    // ---------------------------------------------------------------------
    // Potvrzení koupě
    // ---------------------------------------------------------------------

    private interface AckCallback {
        void done(boolean acknowledged);
    }

    /** Nepotvrzenou koupi potvrdí. Bez potvrzení Google platbu do 3 dnů vrátí. */
    private void ensureAcknowledged(Purchase p, AckCallback cb) {
        if (p.getPurchaseState() != Purchase.PurchaseState.PURCHASED || p.isAcknowledged()) {
            cb.done(p.isAcknowledged());
            return;
        }
        acknowledge(p, cb);
    }

    private void acknowledge(final Purchase p, final AckCallback cb) {
        withConnection(new ConnectionTask() {
            @Override
            public void onReady() {
                AcknowledgePurchaseParams params = AcknowledgePurchaseParams.newBuilder()
                    .setPurchaseToken(p.getPurchaseToken())
                    .build();
                client().acknowledgePurchase(params, result -> {
                    boolean ok = result.getResponseCode() == BillingClient.BillingResponseCode.OK;
                    if (!ok) {
                        // Koupě platí, jen ji zatím nikdo nepotvrdil. Potvrdit ji může i server
                        // nebo další volání entitlement, proto nevracíme chybu.
                        Log.w(TAG, "Potvrzení koupě selhalo: " + result.getResponseCode() + " " + result.getDebugMessage());
                    }
                    cb.done(ok);
                });
            }

            @Override
            public void onError(BillingResult result) {
                Log.w(TAG, "Potvrzení koupě selhalo, služba není dostupná: " + result.getResponseCode());
                cb.done(false);
            }
        });
    }

    // ---------------------------------------------------------------------
    // manage({ productId })
    // ---------------------------------------------------------------------

    @PluginMethod
    public void manage(final PluginCall call) {
        String productId = call.getString("productId");
        String url = "https://play.google.com/store/account/subscriptions?package=" + PACKAGE;
        if (!isEmpty(productId)) url += "&sku=" + Uri.encode(productId);
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        Activity activity = getActivity();
        try {
            if (activity != null) {
                activity.startActivity(intent);
            } else {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            }
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("Správu předplatného v Google Play se nepodařilo otevřít.", "UNAVAILABLE");
        }
    }

    // ---------------------------------------------------------------------
    // Pomocné
    // ---------------------------------------------------------------------

    private static JSObject purchaseJson(Purchase p, String productId, boolean acknowledged) {
        JSObject o = new JSObject();
        o.put("token", p.getPurchaseToken());
        String pid = productId;
        if (pid == null && !p.getProducts().isEmpty()) pid = p.getProducts().get(0);
        o.put("productId", pid);
        String orderId = p.getOrderId();
        o.put("orderId", orderId != null ? orderId : JSObject.NULL);
        o.put("purchaseTime", p.getPurchaseTime());
        o.put("autoRenewing", p.isAutoRenewing());
        o.put("acknowledged", acknowledged || p.isAcknowledged());
        o.put("state", stateName(p.getPurchaseState()));
        return o;
    }

    private static String stateName(int state) {
        switch (state) {
            case Purchase.PurchaseState.PURCHASED:
                return "purchased";
            case Purchase.PurchaseState.PENDING:
                return "pending";
            default:
                return "unspecified";
        }
    }

    private static void rejectBilling(PluginCall call, BillingResult result) {
        int code = result.getResponseCode();
        Log.w(TAG, "Billing chyba " + code + ": " + result.getDebugMessage());
        call.reject(czechMessage(code), codeName(code));
    }

    /** Název kódu z BillingClient.BillingResponseCode. Čísla místo konstant kvůli zastaralému SERVICE_TIMEOUT. */
    private static String codeName(int code) {
        switch (code) {
            case -3: return "SERVICE_TIMEOUT";
            case -2: return "FEATURE_NOT_SUPPORTED";
            case -1: return "SERVICE_DISCONNECTED";
            case 0: return "OK";
            case 1: return "USER_CANCELED";
            case 2: return "SERVICE_UNAVAILABLE";
            case 3: return "BILLING_UNAVAILABLE";
            case 4: return "ITEM_UNAVAILABLE";
            case 5: return "DEVELOPER_ERROR";
            case 6: return "ERROR";
            case 7: return "ITEM_ALREADY_OWNED";
            case 8: return "ITEM_NOT_OWNED";
            case 12: return "NETWORK_ERROR";
            default: return "UNKNOWN_" + code;
        }
    }

    private static String czechMessage(int code) {
        switch (code) {
            case -3: return "Google Play neodpověděl včas. Zkuste to prosím znovu.";
            case -2: return "Toto zařízení předplatné v Google Play nepodporuje.";
            case -1: return "Spojení s Google Play se přerušilo. Zkuste to prosím znovu.";
            case 2: return "Google Play je teď nedostupný. Zkontrolujte připojení k internetu.";
            case 3: return "Platby přes Google Play nejsou na tomto zařízení dostupné. Zkontrolujte, že jste přihlášeni k účtu Google.";
            case 4: return "Předplatné teď není v Google Play k dispozici.";
            case 5: return "Chyba v nastavení předplatného v aplikaci.";
            case 7: return "Předplatné už máte.";
            case 8: return "Předplatné na tomto účtu Google nebylo nalezeno.";
            case 12: return "Chyba sítě. Zkontrolujte připojení k internetu a zkuste to znovu.";
            default: return "Platba přes Google Play se nepovedla. Zkuste to prosím znovu.";
        }
    }

    private static boolean isEmpty(String s) {
        return s == null || s.trim().isEmpty();
    }
}
