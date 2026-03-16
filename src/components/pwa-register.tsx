"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    const isNativeShell =
      typeof window !== "undefined" &&
      typeof (window as typeof window & { Capacitor?: unknown }).Capacitor !== "undefined";
    if (isNativeShell) return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // ignore registration failures
    });
  }, []);

  return null;
}
