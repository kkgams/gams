// macOS regression against any preview serving canonical Host /css and /fonts.
// swift test/check-game-icons-webkit.swift http://127.0.0.1:8820/
import Cocoa
import WebKit

guard CommandLine.arguments.count == 2, let url = URL(string: CommandLine.arguments[1]) else {
    print("Usage: swift test/check-game-icons-webkit.swift <preview-url>")
    exit(2)
}

final class IconProbe: NSObject, WKNavigationDelegate {
    let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 1100, height: 720))
    let window = NSWindow(contentRect: NSRect(x: -3000, y: -3000, width: 1100, height: 720), styleMask: .borderless, backing: .buffered, defer: false)
    init(url: URL) {
        super.init()
        window.contentView = view
        view.navigationDelegate = self
        view.load(URLRequest(url: url))
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        print("WebKit navigation failed: \(error)")
        exit(1)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let source = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("game-icons.browser.js")
        let script: String
        do {
            script = try String(contentsOf: source, encoding: .utf8)
                .replacingOccurrences(of: "export async function", with: "async function")
                + "\nreturn JSON.stringify(await checkGameIconLigatures());"
        } catch {
            print("Cannot read Host regression: \(error)")
            exit(2)
        }
        webView.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
            switch result {
            case .success(let value): print("WebKit: \(value)"); exit(0)
            case .failure(let error): print("WebKit regression failed: \(error)"); exit(1)
            }
        }
    }
}
let app = NSApplication.shared
let probe = IconProbe(url: url)
Timer.scheduledTimer(withTimeInterval: 60, repeats: false) { _ in print("WebKit regression timed out"); exit(2) }
app.run()
