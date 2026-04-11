import UIKit
import Capacitor
import WebKit

class CaspoBridgeViewController: CAPBridgeViewController {
    private var lifecycleObservers: [NSObjectProtocol] = []
    private var isApplyingNativeChromeStyle = false
    private var pendingChromeTasks: [DispatchWorkItem] = []

    private func cancelPendingChromeTasks() {
        pendingChromeTasks.forEach { $0.cancel() }
        pendingChromeTasks.removeAll()
    }

    private func scheduleNativeChromeStyle() {
        cancelPendingChromeTasks()
        let delays: [TimeInterval] = [0, 0.12, 0.42]
        for delay in delays {
            let workItem = DispatchWorkItem { [weak self] in
                self?.applyNativeChromeStyle()
            }
            pendingChromeTasks.append(workItem)
            DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: workItem)
        }
    }

    private func applyNativeChromeStyle() {
        guard !isApplyingNativeChromeStyle else { return }
        isApplyingNativeChromeStyle = true
        defer { isApplyingNativeChromeStyle = false }

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
                self?.scheduleNativeChromeStyle()
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
        scheduleNativeChromeStyle()
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        installLifecycleObservers()
        scheduleNativeChromeStyle()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        scheduleNativeChromeStyle()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        scheduleNativeChromeStyle()
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        scheduleNativeChromeStyle()
    }

    deinit {
        cancelPendingChromeTasks()
        lifecycleObservers.forEach(NotificationCenter.default.removeObserver)
    }
}
