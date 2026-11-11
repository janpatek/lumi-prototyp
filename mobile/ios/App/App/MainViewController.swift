import UIKit
import Capacitor

/// Hlavní obrazovka aplikace. Registruje vlastní pluginy, které nejsou v npm balíčcích.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        // Předplatné přes StoreKit 2 (Capacitor.Plugins.OspalekStore).
        bridge?.registerPluginInstance(StorePlugin())
    }
}
