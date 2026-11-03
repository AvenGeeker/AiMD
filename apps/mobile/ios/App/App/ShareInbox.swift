import Foundation
import UIKit
import Capacitor

enum AimdShareInbox {
    static let appGroup = "group.com.aimarkdown.mobile"
    static let defaultsKey = "aimd.pendingShare"

    static func consumeAndInject(root: UIViewController?, attempt: Int = 0) {
        guard let defaults = UserDefaults(suiteName: appGroup),
              let json = defaults.string(forKey: defaultsKey),
              !json.isEmpty else { return }
        guard let bridge = findBridge(root), let webView = bridge.bridge?.webView else {
            if attempt < 12 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                    consumeAndInject(root: root, attempt: attempt + 1)
                }
            }
            return
        }
        let script = "window.__aimdReceiveShare && window.__aimdReceiveShare(\(json));"
        webView.evaluateJavaScript(script) { _, _ in
            defaults.removeObject(forKey: defaultsKey)
        }
    }

    private static func findBridge(_ controller: UIViewController?) -> CAPBridgeViewController? {
        guard let controller else { return nil }
        if let bridge = controller as? CAPBridgeViewController { return bridge }
        for child in controller.children {
            if let found = findBridge(child) { return found }
        }
        if let presented = controller.presentedViewController {
            return findBridge(presented)
        }
        return nil
    }
}
