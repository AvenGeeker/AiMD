import Foundation
import UIKit
import Capacitor

/** Deep links that trigger a renderer action without carrying a payload. */
enum AimdActions {
    static func handle(url: URL, root: UIViewController?) -> Bool {
        guard url.scheme == "aimarkdown" else { return false }
        let target = "\(url.host ?? "")\(url.path)"
        guard target == "favorite" || target == "/favorite" else { return false }
        openFavorite(root: root)
        return true
    }

    static func openFavorite(root: UIViewController?, requestId: String = UUID().uuidString, attempt: Int = 0) {
        guard let bridge = AimdShareInbox.findBridge(root), let webView = bridge.bridge?.webView else {
            if attempt < 12 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                    openFavorite(root: root, requestId: requestId, attempt: attempt + 1)
                }
            }
            return
        }
        let script = """
        (() => {
          if (!window.__aimdOpenFavorite || window.__aimdWidgetRequest === '\(requestId)') return;
          window.__aimdWidgetRequest = '\(requestId)';
          window.__aimdOpenFavorite();
        })();
        """
        webView.evaluateJavaScript(script, completionHandler: nil)
    }
}
