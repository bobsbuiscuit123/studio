"use client";

import { useEffect } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { scheduleModalLayerRepair } from "@/lib/modal-layer-repair";

export function ModalLayerRepair() {
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const listenerRemovers: Array<() => Promise<void>> = [];
    let disposed = false;
    let cancelPendingRepair = scheduleModalLayerRepair();

    const queueRepair = () => {
      cancelPendingRepair();
      cancelPendingRepair = scheduleModalLayerRepair();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        queueRepair();
      }
    };

    window.addEventListener("pageshow", queueRepair);
    window.addEventListener("focus", queueRepair);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    if (Capacitor.isNativePlatform()) {
      void App.addListener("appStateChange", ({ isActive }) => {
        if (isActive) {
          queueRepair();
        }
      }).then((handle) => {
        if (disposed) {
          void handle.remove();
          return;
        }

        listenerRemovers.push(() => handle.remove());
      });

      void App.addListener("resume", queueRepair).then((handle) => {
        if (disposed) {
          void handle.remove();
          return;
        }

        listenerRemovers.push(() => handle.remove());
      });
    }

    return () => {
      disposed = true;
      cancelPendingRepair();
      window.removeEventListener("pageshow", queueRepair);
      window.removeEventListener("focus", queueRepair);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      listenerRemovers.forEach((removeListener) => {
        void removeListener();
      });
    };
  }, []);

  return null;
}
