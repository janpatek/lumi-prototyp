import Foundation
import UIKit
import StoreKit
import Capacitor

/// Předplatné Ospalek Plus přes StoreKit 2 (nahrazuje RevenueCat).
/// V JS je dostupný jako `Capacitor.Plugins.OspalekStore` (obal je v app/billing.js).
/// Všechny časy vracíme v milisekundách od epochy.
@objc(StorePlugin)
public class StorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StorePlugin"
    public let jsName = "OspalekStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "product", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "buy", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "entitlement", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "manage", returnType: CAPPluginReturnPromise)
    ]

    /// Úloha, která po celou dobu běhu aplikace poslouchá Transaction.updates.
    private var updatesTask: Task<Void, Never>?

    override public func load() {
        // Dokončí nákupy z jiných zařízení, obnovy předplatného a koupě schválené
        // rodičem (Ask to Buy). Bez finish() by je App Store posílal znovu.
        updatesTask = Task.detached(priority: .background) {
            for await result in Transaction.updates {
                if case .verified(let transaction) = result {
                    await transaction.finish()
                }
            }
        }
    }

    deinit {
        updatesTask?.cancel()
    }

    // MARK: - product({ productId })

    @objc func product(_ call: CAPPluginCall) {
        guard let productId = call.getString("productId"), !productId.isEmpty else {
            call.reject("Chybí productId", "INVALID_ARGUMENT")
            return
        }
        Task {
            do {
                guard let product = try await Self.loadProduct(productId) else {
                    call.reject("Produkt \(productId) neexistuje", "NOT_FOUND")
                    return
                }
                // Zkušební doba se nabízí jen tomu, kdo na úvodní nabídku ještě má nárok.
                var trial = false
                var trialDays = 0
                if let subscription = product.subscription,
                   let offer = subscription.introductoryOffer,
                   offer.paymentMode == .freeTrial {
                    trial = await subscription.isEligibleForIntroOffer
                    trialDays = Self.days(of: offer.period) * max(offer.periodCount, 1)
                }
                let micros = NSDecimalNumber(decimal: product.price * 1_000_000).int64Value
                call.resolve([
                    "productId": product.id,
                    "price": product.displayPrice,
                    "priceMicros": Int(micros),
                    "currency": product.priceFormatStyle.currencyCode,
                    "trial": trial,
                    "trialDays": trialDays
                ])
            } catch {
                call.reject("Produkt se nepodařilo načíst: \(error.localizedDescription)", "STORE_ERROR", error)
            }
        }
    }

    // MARK: - buy({ productId, account })

    @objc func buy(_ call: CAPPluginCall) {
        guard let productId = call.getString("productId"), !productId.isEmpty else {
            call.reject("Chybí productId", "INVALID_ARGUMENT")
            return
        }
        let account = call.getString("account")
        Task {
            do {
                guard let product = try await Self.loadProduct(productId) else {
                    call.reject("Produkt \(productId) neexistuje", "NOT_FOUND")
                    return
                }
                // UUID rodiny: server podle něj páruje předplatné s rodinou.
                var options: Set<Product.PurchaseOption> = []
                if let account = account, let uuid = UUID(uuidString: account) {
                    options.insert(.appAccountToken(uuid))
                }

                let result = try await self.purchase(product, options: options)
                switch result {
                case .success(let verification):
                    switch verification {
                    case .verified(let transaction):
                        await transaction.finish()
                        let purchase = await Self.purchaseObject(transaction, jws: verification.jwsRepresentation)
                        call.resolve(["status": "ok", "purchase": purchase])
                    case .unverified(_, let error):
                        call.reject("Nákup se nepodařilo ověřit: \(error.localizedDescription)", "UNVERIFIED", error)
                    }
                case .userCancelled:
                    call.resolve(["status": "cancelled", "purchase": NSNull()])
                case .pending:
                    // Čeká na schválení rodičem (Ask to Buy) nebo na dořešení platby.
                    // Dokončí se pak přes Transaction.updates.
                    call.resolve(["status": "pending", "purchase": NSNull()])
                @unknown default:
                    call.reject("Neznámý výsledek nákupu", "UNKNOWN")
                }
            } catch StoreKitError.userCancelled {
                call.resolve(["status": "cancelled", "purchase": NSNull()])
            } catch {
                call.reject("Nákup se nepodařil: \(error.localizedDescription)", "PURCHASE_FAILED", error)
            }
        }
    }

    // MARK: - entitlement({ productId })

    @objc func entitlement(_ call: CAPPluginCall) {
        guard let productId = call.getString("productId"), !productId.isEmpty else {
            call.reject("Chybí productId", "INVALID_ARGUMENT")
            return
        }
        Task {
            call.resolve(await Self.entitlementObject(productId))
        }
    }

    // MARK: - restore({ productId })

    @objc func restore(_ call: CAPPluginCall) {
        guard let productId = call.getString("productId"), !productId.isEmpty else {
            call.reject("Chybí productId", "INVALID_ARGUMENT")
            return
        }
        Task {
            do {
                // Vynutí synchronizaci s App Store (může se zeptat na heslo k Apple ID).
                try await AppStore.sync()
            } catch StoreKitError.userCancelled {
                call.reject("Přihlášení k Apple ID bylo zrušeno", "CANCELLED")
                return
            } catch {
                call.reject("Obnovení nákupů se nepodařilo: \(error.localizedDescription)", "STORE_ERROR", error)
                return
            }
            call.resolve(await Self.entitlementObject(productId))
        }
    }

    // MARK: - manage()

    @objc func manage(_ call: CAPPluginCall) {
        Task { @MainActor in
            do {
                guard let scene = self.bridge?.viewController?.view.window?.windowScene else {
                    throw StoreKitError.unknown
                }
                try await AppStore.showManageSubscriptions(in: scene)
            } catch {
                // Záloha: stránka správy předplatného v App Storu.
                if let url = URL(string: "https://apps.apple.com/account/subscriptions") {
                    await UIApplication.shared.open(url)
                }
            }
            call.resolve()
        }
    }

    // MARK: - Pomocné funkce

    /// Nákup s potvrzovacím listem ukotveným ve scéně aplikace (iOS 17+), jinak klasicky.
    private func purchase(_ product: Product, options: Set<Product.PurchaseOption>) async throws -> Product.PurchaseResult {
        if #available(iOS 17.0, *) {
            let scene = await MainActor.run { self.bridge?.viewController?.view.window?.windowScene }
            if let scene = scene {
                return try await product.purchase(confirmIn: scene, options: options)
            }
        }
        return try await product.purchase(options: options)
    }

    private static func loadProduct(_ productId: String) async throws -> Product? {
        try await Product.products(for: [productId]).first
    }

    /// Délka periody ve dnech (měsíc a rok přibližně, pro zkušební dobu stačí).
    private static func days(of period: Product.SubscriptionPeriod) -> Int {
        switch period.unit {
        case .day: return period.value
        case .week: return period.value * 7
        case .month: return period.value * 30
        case .year: return period.value * 365
        @unknown default: return period.value
        }
    }

    private static func ms(_ date: Date) -> Int {
        Int((date.timeIntervalSince1970 * 1000).rounded())
    }

    /// Je transakce ze zkušební doby zdarma (úvodní nabídka typu free trial)?
    private static func isTrial(_ transaction: Transaction) -> Bool {
        if #available(iOS 17.2, *) {
            guard let offer = transaction.offer else { return false }
            return offer.type == .introductory && offer.paymentMode == .freeTrial
        }
        return transaction.offerType == .introductory
    }

    /// Obnoví se předplatné na konci období? Když to nevíme, vrací false.
    private static func willRenew(_ transaction: Transaction) async -> Bool {
        guard let product = try? await loadProduct(transaction.productID),
              let statuses = try? await product.subscription?.status else {
            return false
        }
        // Hledáme stav patřící ke stejnému řetězci předplatného (originalID).
        let matching = statuses.first { status in
            if case .verified(let t) = status.transaction { return t.originalID == transaction.originalID }
            return false
        } ?? statuses.first
        guard let status = matching, case .verified(let renewal) = status.renewalInfo else {
            return false
        }
        return renewal.willAutoRenew
    }

    /// Tvar `purchase`, se kterým počítá app/billing.js.
    private static func purchaseObject(_ transaction: Transaction, jws: String) async -> JSObject {
        let renew = await willRenew(transaction)
        return [
            "jws": jws,
            "transactionId": String(transaction.id),
            "originalTransactionId": String(transaction.originalID),
            "productId": transaction.productID,
            "purchaseDate": ms(transaction.purchaseDate),
            "expires": transaction.expirationDate.map { ms($0) as JSValue } ?? NSNull(),
            "trial": isTrial(transaction),
            "willRenew": renew
        ]
    }

    /// `{ active, willRenew, purchase }` podle Transaction.currentEntitlements.
    private static func entitlementObject(_ productId: String) async -> JSObject {
        var found: (Transaction, String)?
        for await result in Transaction.currentEntitlements {
            guard case .verified(let transaction) = result,
                  transaction.productID == productId,
                  transaction.revocationDate == nil else { continue }
            // Kdyby jich bylo víc, bereme tu s nejpozdějším koncem.
            if let current = found?.0,
               (current.expirationDate ?? .distantPast) >= (transaction.expirationDate ?? .distantPast) {
                continue
            }
            found = (transaction, result.jwsRepresentation)
        }
        guard let (transaction, jws) = found else {
            return ["active": false, "willRenew": false, "purchase": NSNull()]
        }
        let purchase = await purchaseObject(transaction, jws: jws)
        let active = (transaction.expirationDate ?? .distantPast) > Date()
        return [
            "active": active,
            "willRenew": purchase["willRenew"] ?? false,
            "purchase": purchase
        ]
    }
}
