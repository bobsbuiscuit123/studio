"use client";

import { useCallback, useEffect, useState } from "react";

import {
  APP_THEME_CHANGE_EVENT,
  APP_THEME_STORAGE_KEY,
  applyAppTheme,
  getAppliedAppTheme,
  readStoredAppTheme,
  resolveAppTheme,
  setAppTheme,
  type AppTheme,
} from "@/lib/app-theme";

export function useAppTheme() {
  const [theme, setThemeState] = useState<AppTheme>(() =>
    typeof document === "undefined" ? "light" : getAppliedAppTheme()
  );

  useEffect(() => {
    const syncedTheme = applyAppTheme(readStoredAppTheme());
    setThemeState(syncedTheme);

    const handleThemeChange = () => {
      setThemeState(getAppliedAppTheme());
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== APP_THEME_STORAGE_KEY) {
        return;
      }

      const nextTheme = resolveAppTheme(event.newValue);
      applyAppTheme(nextTheme);
      setThemeState(nextTheme);
    };

    window.addEventListener(APP_THEME_CHANGE_EVENT, handleThemeChange as EventListener);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener(APP_THEME_CHANGE_EVENT, handleThemeChange as EventListener);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const updateTheme = useCallback((nextTheme: AppTheme) => {
    const appliedTheme = setAppTheme(nextTheme);
    setThemeState(appliedTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    updateTheme(theme === "dark" ? "light" : "dark");
  }, [theme, updateTheme]);

  return {
    theme,
    isDarkMode: theme === "dark",
    setTheme: updateTheme,
    toggleTheme,
  };
}
