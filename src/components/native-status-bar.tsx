'use client';

import { useEffect } from 'react';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { usePathname } from 'next/navigation';
import { StatusBar, Style } from '@capacitor/status-bar';

const SAFE_AREA_RESYNC_EVENT = "caspo:safe-area-resync";
const STATUS_BAR_REASSERT_EVENT = "caspo:status-bar-reassert";

export function NativeStatusBar() {
  const pathname = usePathname();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    const timeoutIds = new Set<number>();
    const listenerRemovers: Array<() => Promise<void>> = [];
    let disposed = false;

    const clearScheduledApplies = () => {
      timeoutIds.forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      timeoutIds.clear();
    };

    const dispatchSafeAreaResync = () => {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(SAFE_AREA_RESYNC_EVENT));
      }
    };

    const applyStatusBar = () => {
      void StatusBar.setOverlaysWebView({ overlay: false }).catch(() => undefined);
      void StatusBar.setBackgroundColor({ color: "#ffffff" }).catch(() => undefined);
      void StatusBar.setStyle({ style: Style.Dark }).catch(() => undefined);
      dispatchSafeAreaResync();
    };

    const scheduleApply = () => {
      applyStatusBar();
      clearScheduledApplies();
      [140, 420, 900].forEach((delay) => {
        const timeoutId = window.setTimeout(applyStatusBar, delay);
        timeoutIds.add(timeoutId);
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        scheduleApply();
      }
    };

    const handleStatusBarReassert = () => {
      scheduleApply();
    };

    scheduleApply();

    window.addEventListener("focus", scheduleApply);
    window.addEventListener("pageshow", scheduleApply);
    window.addEventListener("orientationchange", scheduleApply);
    window.addEventListener(STATUS_BAR_REASSERT_EVENT, handleStatusBarReassert);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.visualViewport?.addEventListener("resize", scheduleApply);

    void App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) {
        scheduleApply();
      }
    }).then((handle) => {
      if (disposed) {
        void handle.remove();
        return;
      }
      listenerRemovers.push(() => handle.remove());
    });

    void App.addListener("resume", () => {
      scheduleApply();
    }).then((handle) => {
      if (disposed) {
        void handle.remove();
        return;
      }
      listenerRemovers.push(() => handle.remove());
    });

    return () => {
      disposed = true;
      clearScheduledApplies();
      window.removeEventListener("focus", scheduleApply);
      window.removeEventListener("pageshow", scheduleApply);
      window.removeEventListener("orientationchange", scheduleApply);
      window.removeEventListener(STATUS_BAR_REASSERT_EVENT, handleStatusBarReassert);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.visualViewport?.removeEventListener("resize", scheduleApply);
      listenerRemovers.forEach((removeListener) => {
        void removeListener();
      });
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !Capacitor.isNativePlatform()) {
      return;
    }

    const dispatchReassert = () => {
      window.dispatchEvent(new Event(STATUS_BAR_REASSERT_EVENT));
    };

    dispatchReassert();
    const earlyReassertId = window.setTimeout(dispatchReassert, 120);
    const lateReassertId = window.setTimeout(dispatchReassert, 480);

    return () => {
      window.clearTimeout(earlyReassertId);
      window.clearTimeout(lateReassertId);
    };
  }, [pathname]);

  return null;
}
