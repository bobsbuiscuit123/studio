export type AppTheme = 'light' | 'dark';

export const APP_THEME_STORAGE_KEY = 'caspo-app-theme';
export const APP_THEME_CHANGE_EVENT = 'caspo-app-theme-change';

const APP_THEME_META_COLORS: Record<AppTheme, string> = {
  light: '#ffffff',
  dark: '#1b1f1c',
};

export const resolveAppTheme = (value: unknown): AppTheme =>
  value === 'dark' ? 'dark' : 'light';

export const getThemeMetaColor = (theme: AppTheme) => APP_THEME_META_COLORS[theme];

export const readStoredAppTheme = (): AppTheme => {
  if (typeof window === 'undefined') {
    return 'light';
  }

  try {
    return resolveAppTheme(window.localStorage.getItem(APP_THEME_STORAGE_KEY));
  } catch {
    return 'light';
  }
};

export const getAppliedAppTheme = (): AppTheme => {
  if (typeof document === 'undefined') {
    return 'light';
  }

  if (document.documentElement.classList.contains('dark')) {
    return 'dark';
  }

  return readStoredAppTheme();
};

const updateThemeMetaColor = (theme: AppTheme) => {
  if (typeof document === 'undefined') {
    return;
  }

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta instanceof HTMLMetaElement) {
    meta.content = getThemeMetaColor(theme);
  }
};

export const applyAppTheme = (
  value: AppTheme,
  { persist = false, notify = false }: { persist?: boolean; notify?: boolean } = {}
) => {
  const theme = resolveAppTheme(value);

  if (persist && typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(APP_THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage write failures and still apply the theme in memory.
    }
  }

  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    updateThemeMetaColor(theme);
  }

  if (notify && typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(APP_THEME_CHANGE_EVENT, {
        detail: { theme },
      })
    );
  }

  return theme;
};

export const setAppTheme = (value: AppTheme) =>
  applyAppTheme(value, { persist: true, notify: true });

export const themeInitScript = `(() => {
  try {
    var storageKey = '${APP_THEME_STORAGE_KEY}';
    var theme = localStorage.getItem(storageKey) === 'dark' ? 'dark' : 'light';
    var root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', theme === 'dark' ? '${APP_THEME_META_COLORS.dark}' : '${APP_THEME_META_COLORS.light}');
    }
  } catch (error) {
    // Ignore theme initialization failures and fall back to light mode.
  }
})();`;
