'use client';

import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

export function NativeStatusBar() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    void StatusBar.setOverlaysWebView({ overlay: true }).catch(() => undefined);
    void StatusBar.setStyle({ style: Style.Dark }).catch(() => undefined);
  }, []);

  return null;
}
