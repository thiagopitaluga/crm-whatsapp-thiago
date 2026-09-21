"use client";

import { useEffect } from "react";

/**
 * Registers a deliberately conservative service worker. It caches only the
 * static application shell; authenticated pages, API calls, messages and
 * media always stay network-only.
 */
export function PwaRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    void navigator.serviceWorker
      .register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      })
      .catch((error: unknown) => {
        // A PWA enhancement must never make the CRM unusable when a browser
        // blocks service workers (private mode, corporate policy, etc.).
        console.warn("OrganiZAP PWA could not be enabled.", error);
      });
  }, []);

  return null;
}
