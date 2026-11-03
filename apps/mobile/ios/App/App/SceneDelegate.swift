import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = CAPBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
        if !connectionOptions.urlContexts.contains(where: { AimdActions.handle(url: $0.url, root: window?.rootViewController) }) {
            AimdShareInbox.consumeAndInject(root: window?.rootViewController)
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
        if URLContexts.contains(where: { AimdActions.handle(url: $0.url, root: window?.rootViewController) }) {
            return
        }
        if URLContexts.contains(where: { $0.url.scheme == "aimarkdown" }) {
            AimdShareInbox.consumeAndInject(root: window?.rootViewController)
        }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
