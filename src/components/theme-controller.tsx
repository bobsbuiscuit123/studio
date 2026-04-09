"use client";

import { useEffect } from "react";

import {
  APP_THEME_STORAGE_KEY,
  applyAppTheme,
  readStoredAppTheme,
  resolveAppTheme,
} from "@/lib/app-theme";

export function ThemeController() {
  useEffect(() => {
    applyAppTheme(readStoredAppTheme());

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== APP_THEME_STORAGE_KEY) {
        return;
      }

      applyAppTheme(resolveAppTheme(event.newValue), { notify: true });
    };

    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  return null;
}
