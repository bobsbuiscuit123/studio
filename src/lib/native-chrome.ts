export const SAFE_AREA_RESYNC_EVENT = "caspo:safe-area-resync";
export const STATUS_BAR_REASSERT_EVENT = "caspo:status-bar-reassert";

export function dispatchNativeChromeResync() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(STATUS_BAR_REASSERT_EVENT));
  window.dispatchEvent(new Event(SAFE_AREA_RESYNC_EVENT));
}

export function scheduleNativeChromeResync(delays: number[] = [0, 120, 420, 900]) {
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
