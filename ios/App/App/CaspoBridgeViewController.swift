import UIKit
import Capacitor
import WebKit

class CaspoBridgeViewController: CAPBridgeViewController {
    private var lifecycleObservers: [NSObjectProtocol] = []

    private func applyNativeChromeStyle() {
        view.backgroundColor = .white
        webView?.backgroundColor = .white
        webView?.scrollView.backgroundColor = .white
        webView?.isOpaque = true
        webView?.scrollView.contentInsetAdjustmentBehavior = .never
        webView?.scrollView.contentInset = .zero
        webView?.scrollView.scrollIndicatorInsets = .zero
        webView?.scrollView.verticalScrollIndicatorInsets = .zero
        webView?.scrollView.horizontalScrollIndicatorInsets = .zero
        if #available(iOS 13.0, *) {
            webView?.scrollView.automaticallyAdjustsScrollIndicatorInsets = false
        }
        additionalSafeAreaInsets = .zero
        setNeedsStatusBarAppearanceUpdate()
    }

    private func installLifecycleObservers() {
        guard lifecycleObservers.isEmpty else { return }
        let center = NotificationCenter.default
        let names: [NSNotification.Name] = [
            UIApplication.willEnterForegroundNotification,
            UIApplication.didBecomeActiveNotification
        ]

        lifecycleObservers = names.map { name in
            center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                self?.applyNativeChromeStyle()
            }
        }
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        return .darkContent
    }

    override var prefersStatusBarHidden: Bool {
        return false
    }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        applyNativeChromeStyle()
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        installLifecycleObservers()
        applyNativeChromeStyle()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        applyNativeChromeStyle()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        applyNativeChromeStyle()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        applyNativeChromeStyle()
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        applyNativeChromeStyle()
    }

    deinit {
        lifecycleObservers.forEach(NotificationCenter.default.removeObserver)
    }
}
