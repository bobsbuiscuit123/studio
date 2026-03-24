import UIKit
import Capacitor
import WebKit

class CaspoBridgeViewController: CAPBridgeViewController {
    private func applyNativeChromeStyle() {
        view.backgroundColor = .white
        webView?.backgroundColor = .white
        webView?.scrollView.backgroundColor = .white
        webView?.isOpaque = true
        webView?.scrollView.contentInset = .zero
        webView?.scrollView.verticalScrollIndicatorInsets = .zero
        webView?.scrollView.horizontalScrollIndicatorInsets = .zero
    }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        applyNativeChromeStyle()
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        applyNativeChromeStyle()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        applyNativeChromeStyle()
    }
}
