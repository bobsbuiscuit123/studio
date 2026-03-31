"use client";

import { Capacitor } from "@capacitor/core";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { SAFE_AREA_RESYNC_EVENT } from "@/lib/native-chrome";

function parsePixels(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getOrientationKey() {
  if (typeof window === "undefined") {
    return "portrait";
  }

  return window.innerWidth > window.innerHeight ? "landscape" : "portrait";
}

export function SafeAreaSync() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const root = document.documentElement;
    const probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = [
      "position: fixed",
      "top: 0",
      "left: 0",
      "width: 0",
      "height: 0",
      "padding-top: env(safe-area-inset-top, 0px)",
      "padding-right: env(safe-area-inset-right, 0px)",
      "padding-bottom: env(safe-area-inset-bottom, 0px)",
      "padding-left: env(safe-area-inset-left, 0px)",
      "visibility: hidden",
      "pointer-events: none",
      "z-index: -1",
    ].join(";");
    document.body.appendChild(probe);

    let animationFrameId: number | null = null;
    const timeoutIds = new Set<number>();
    const stableInsetsByOrientation = new Map<
      string,
      { top: number; right: number; bottom: number; left: number }
    >();

    const clearScheduledSyncs = () => {
      timeoutIds.forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      timeoutIds.clear();
    };

    const applyInsetVars = () => {
      const styles = window.getComputedStyle(probe);
      const measuredTopInset = parsePixels(styles.paddingTop);
      const measuredRightInset = parsePixels(styles.paddingRight);
      const measuredBottomInset = parsePixels(styles.paddingBottom);
      const measuredLeftInset = parsePixels(styles.paddingLeft);
      const orientationKey = getOrientationKey();
      const isCompactViewport = Math.min(window.innerWidth, window.innerHeight) <= 900;
      const isNativeCompactViewport = Capacitor.isNativePlatform() && isCompactViewport;
      const stableInsets = stableInsetsByOrientation.get(orientationKey) ?? {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      };

      if (measuredTopInset > 0 || measuredRightInset > 0 || measuredBottomInset > 0 || measuredLeftInset > 0) {
        stableInsetsByOrientation.set(orientationKey, {
          top: measuredTopInset > 0 ? measuredTopInset : stableInsets.top,
          right: measuredRightInset > 0 ? measuredRightInset : stableInsets.right,
          bottom: measuredBottomInset > 0 ? measuredBottomInset : stableInsets.bottom,
          left: measuredLeftInset > 0 ? measuredLeftInset : stableInsets.left,
        });
      }

      const resolvedTopInset =
        measuredTopInset <= 0 && stableInsets.top > 0 && isNativeCompactViewport
          ? stableInsets.top
          : measuredTopInset;

      root.style.setProperty("--safe-area-top-runtime", `${resolvedTopInset}px`);
      root.style.setProperty("--safe-area-right-runtime", `${measuredRightInset}px`);
      root.style.setProperty("--safe-area-bottom-runtime", `${measuredBottomInset}px`);
      root.style.setProperty("--safe-area-left-runtime", `${measuredLeftInset}px`);
    };

    const scheduleSync = () => {
      applyInsetVars();
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
      animationFrameId = window.requestAnimationFrame(applyInsetVars);
      clearScheduledSyncs();
      [120, 360, 900].forEach((delay) => {
        const timeoutId = window.setTimeout(applyInsetVars, delay);
        timeoutIds.add(timeoutId);
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        scheduleSync();
      }
    };

    const handleSafeAreaResync = () => {
      scheduleSync();
    };

    scheduleSync();

    window.addEventListener("resize", scheduleSync);
    window.addEventListener("orientationchange", scheduleSync);
    window.addEventListener("pageshow", scheduleSync);
    window.addEventListener(SAFE_AREA_RESYNC_EVENT, handleSafeAreaResync);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", scheduleSync);
    window.addEventListener("focusin", scheduleSync);
    window.addEventListener("focusout", scheduleSync);
    window.visualViewport?.addEventListener("resize", scheduleSync);
    window.visualViewport?.addEventListener("scroll", scheduleSync);

    return () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
      clearScheduledSyncs();
      window.removeEventListener("resize", scheduleSync);
      window.removeEventListener("orientationchange", scheduleSync);
      window.removeEventListener("pageshow", scheduleSync);
      window.removeEventListener(SAFE_AREA_RESYNC_EVENT, handleSafeAreaResync);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", scheduleSync);
      window.removeEventListener("focusin", scheduleSync);
      window.removeEventListener("focusout", scheduleSync);
      window.visualViewport?.removeEventListener("resize", scheduleSync);
      window.visualViewport?.removeEventListener("scroll", scheduleSync);
      probe.remove();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const dispatchResync = () => {
      window.dispatchEvent(new Event(SAFE_AREA_RESYNC_EVENT));
    };

    dispatchResync();
    const earlyResyncId = window.setTimeout(dispatchResync, 120);
    const lateResyncId = window.setTimeout(dispatchResync, 480);

    return () => {
      window.clearTimeout(earlyResyncId);
      window.clearTimeout(lateResyncId);
    };
  }, [pathname]);

  return null;
}
