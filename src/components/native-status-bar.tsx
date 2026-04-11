'use client';

import { useEffect } from 'react';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { usePathname } from 'next/navigation';
import { StatusBar, Style } from '@capacitor/status-bar';
import {
  APP_THEME_CHANGE_EVENT,
  getAppliedAppTheme,
  getThemeMetaColor,
} from '@/lib/app-theme';
import {
  DEFAULT_NATIVE_CHROME_RESYNC_DELAYS,
  SAFE_AREA_RESYNC_EVENT,
  STATUS_BAR_REASSERT_EVENT,
} from "@/lib/native-chrome";

export function NativeStatusBar() {
  const pathname = usePathname();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    const timeoutIds = new Set<number>();
    const listenerRemovers: Array<() => Promise<void>> = [];
    let disposed = false;
    let lastScheduleAt = 0;

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
      const theme = getAppliedAppTheme();
      void StatusBar.setOverlaysWebView({ overlay: false }).catch(() => undefined);
      void StatusBar.setBackgroundColor({ color: getThemeMetaColor(theme) }).catch(() => undefined);
      void StatusBar.setStyle({ style: theme === 'dark' ? Style.Light : Style.Dark }).catch(() => undefined);
      dispatchSafeAreaResync();
    };

    const scheduleApply = () => {
      const now = Date.now();
      if (now - lastScheduleAt < 120) {
        return;
      }
      lastScheduleAt = now;
      applyStatusBar();
      clearScheduledApplies();
      DEFAULT_NATIVE_CHROME_RESYNC_DELAYS.forEach((delay) => {
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
    window.addEventListener(APP_THEME_CHANGE_EVENT, scheduleApply as EventListener);
    document.addEventListener("visibilitychange", handleVisibilityChange);

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
      window.removeEventListener(APP_THEME_CHANGE_EVENT, scheduleApply as EventListener);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
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

    return () => {
      window.clearTimeout(earlyReassertId);
    };
  }, [pathname]);

  return null;
}
