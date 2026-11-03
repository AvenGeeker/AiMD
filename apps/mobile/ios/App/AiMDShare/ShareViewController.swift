import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    private let appGroup = "group.com.aimarkdown.mobile"
    private let defaultsKey = "aimd.pendingShare"

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        let label = UILabel()
        label.text = "正在打开 AiMD…"
        label.font = .systemFont(ofSize: 15, weight: .medium)
        label.translatesAutoresizingMaskIntoConstraints = false
        let spinner = UIActivityIndicatorView(style: .medium)
        spinner.startAnimating()
        spinner.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        view.addSubview(spinner)
        NSLayoutConstraint.activate([
            spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -18),
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.topAnchor.constraint(equalTo: spinner.bottomAnchor, constant: 10),
        ])
        Task { await collectAndOpen() }
    }

    private func collectAndOpen() async {
        var text = ""
        var files: [[String: String]] = []
        for item in extensionContext?.inputItems ?? [] {
            guard let provider = (item as? NSExtensionItem)?.attachments?.first else { continue }
            if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                if let url = await loadURL(provider) { text += "\n\(url.absoluteString)" }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                if let value = await loadText(provider) { text += "\n\(value)" }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                if let file = await copyFile(provider) { files.append(file) }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier) {
                if let file = await copyFile(provider) { files.append(file) }
            }
        }
        let payload: [String: Any] = [
            "id": UUID().uuidString,
            "source": "ios",
            "receivedAt": ISO8601DateFormatter().string(from: Date()),
            "text": text.trimmingCharacters(in: .whitespacesAndNewlines),
            "files": files,
        ]
        if let data = try? JSONSerialization.data(withJSONObject: payload),
           let json = String(data: data, encoding: .utf8),
           let defaults = UserDefaults(suiteName: appGroup) {
            defaults.set(json, forKey: defaultsKey)
            defaults.synchronize()
        }
        if let url = URL(string: "aimarkdown://share") {
            extensionContext?.open(url) { _ in }
        }
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }

    private func loadURL(_ provider: NSItemProvider) async -> URL? {
        await withCheckedContinuation { continuation in
            provider.loadItem(forTypeIdentifier: UTType.url.identifier) { item, _ in
                continuation.resume(returning: item as? URL)
            }
        }
    }

    private func loadText(_ provider: NSItemProvider) async -> String? {
        await withCheckedContinuation { continuation in
            provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) { item, _ in
                if let value = item as? String { continuation.resume(returning: value) }
                else if let data = item as? Data { continuation.resume(returning: String(data: data, encoding: .utf8)) }
                else { continuation.resume(returning: nil) }
            }
        }
    }

    private func copyFile(_ provider: NSItemProvider) async -> [String: String]? {
        let type = provider.registeredTypeIdentifiers.first ?? UTType.data.identifier
        return await withCheckedContinuation { continuation in
            provider.loadFileRepresentation(forTypeIdentifier: type) { url, _ in
                guard let url, let container = FileManager.default.containerURL(
                    forSecurityApplicationGroupIdentifier: self.appGroup
                ) else {
                    continuation.resume(returning: nil)
                    return
                }
                let dir = container.appendingPathComponent("ShareInbox", isDirectory: true)
                try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                let name = "\(UUID().uuidString)-\(url.lastPathComponent)"
                let target = dir.appendingPathComponent(name)
                try? FileManager.default.copyItem(at: url, to: target)
                let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
                continuation.resume(returning: ["path": target.path, "name": url.lastPathComponent, "mime": mime])
            }
        }
    }
}
