export const SAFE_AREA_RESYNC_EVENT = "caspo:safe-area-resync";
export const STATUS_BAR_REASSERT_EVENT = "caspo:status-bar-reassert";
export const DEFAULT_NATIVE_CHROME_RESYNC_DELAYS = [0, 120, 420, 900, 1600, 2600];

export function dispatchNativeChromeResync() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(STATUS_BAR_REASSERT_EVENT));
  window.dispatchEvent(new Event(SAFE_AREA_RESYNC_EVENT));
}

export function scheduleNativeChromeResync(
  delays: number[] = DEFAULT_NATIVE_CHROME_RESYNC_DELAYS
) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const timeoutIds = delays.map((delay) => window.setTimeout(dispatchNativeChromeResync, delay));

  return () => {
    timeoutIds.forEach((timeoutId) => {
      window.clearTimeout(timeoutId);
    });
  };
}
