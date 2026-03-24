'use client';

import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

export function NativeStatusBar() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    if (typeof document !== "undefined" && Capacitor.getPlatform() === "ios") {
      document.documentElement.style.setProperty("--safe-area-top", "0px");
      document.documentElement.style.setProperty("--safe-area-right", "0px");
      document.documentElement.style.setProperty("--safe-area-bottom", "0px");
      document.documentElement.style.setProperty("--safe-area-left", "0px");
    }

    void StatusBar.setOverlaysWebView({ overlay: false }).catch(() => undefined);
    void StatusBar.setBackgroundColor({ color: "#ffffff" }).catch(() => undefined);
    void StatusBar.setStyle({ style: Style.Dark }).catch(() => undefined);
  }, []);

  return null;
}
