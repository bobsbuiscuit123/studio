"use client";

import { useEffect } from "react";

/**
 * Client-side error reporter that routes browser errors to the console
 * (and thus to the dev terminal) instead of showing UI overlays.
 */
export function ErrorReporter() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      console.error("[ClientError]", event.message, event.error);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      console.error("[UnhandledRejection]", event.reason);
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
