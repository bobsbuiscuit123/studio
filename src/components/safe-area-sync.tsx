"use client";

import { useEffect } from "react";

function parsePixels(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function SafeAreaSync() {
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
    let timeoutId: number | null = null;
    let lastStableTopInset = 0;

    const applyInsetVars = () => {
      const styles = window.getComputedStyle(probe);
      const measuredTopInset = parsePixels(styles.paddingTop);
      const measuredRightInset = parsePixels(styles.paddingRight);
      const measuredBottomInset = parsePixels(styles.paddingBottom);
      const measuredLeftInset = parsePixels(styles.paddingLeft);
      const isCompactViewport = Math.min(window.innerWidth, window.innerHeight) <= 900;

      if (measuredTopInset > 0) {
        lastStableTopInset = measuredTopInset;
      }

      const resolvedTopInset =
        measuredTopInset <= 0 && lastStableTopInset > 0 && isCompactViewport
          ? lastStableTopInset
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
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      timeoutId = window.setTimeout(applyInsetVars, 250);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        scheduleSync();
      }
    };

    scheduleSync();

    window.addEventListener("resize", scheduleSync);
    window.addEventListener("orientationchange", scheduleSync);
    window.addEventListener("pageshow", scheduleSync);
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
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      window.removeEventListener("resize", scheduleSync);
      window.removeEventListener("orientationchange", scheduleSync);
      window.removeEventListener("pageshow", scheduleSync);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", scheduleSync);
      window.removeEventListener("focusin", scheduleSync);
      window.removeEventListener("focusout", scheduleSync);
      window.visualViewport?.removeEventListener("resize", scheduleSync);
      window.visualViewport?.removeEventListener("scroll", scheduleSync);
      probe.remove();
    };
  }, []);

  return null;
}
