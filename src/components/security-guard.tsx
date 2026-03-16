"use client";

import { useEffect } from "react";

const BLOCKED_HOSTS = new Set(["sevendata.fun", "secdomcheck.online"]);

function isBlockedUrl(input: string) {
  try {
    const url = new URL(input, window.location.href);
    return BLOCKED_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

export function SecurityGuard() {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (isBlockedUrl(url)) {
        // Return an empty success response to avoid breaking app flows.
        return Promise.resolve(new Response("", { status: 204 }));
      }
      return originalFetch(input, init);
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null
    ) {
      const rawUrl = typeof url === "string" ? url : url.toString();
      if (isBlockedUrl(rawUrl)) {
        // Redirect blocked XHRs to a harmless same-origin URL.
        return originalOpen.call(this, method, "/__blocked", async ?? true, username, password);
      }
      return originalOpen.call(this, method, url, async ?? true, username, password);
    };

    return () => {
      window.fetch = originalFetch;
      XMLHttpRequest.prototype.open = originalOpen;
    };
  }, []);

  return null;
}
