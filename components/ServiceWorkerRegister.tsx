"use client";

import { useEffect } from "react";

/**
 * Registers the offline app-shell service worker (BUG-07). A tiny client
 * component because registration needs a browser lifecycle effect, which
 * `app/layout.tsx` (a server component exporting `metadata`) can't run
 * directly — this is the "registration only" piece called out in scope.
 * Renders nothing; no-ops silently if unsupported or registration fails.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // Dev server chunks are unhashed/HMR-driven; caching them causes stale
    // reloads. Only register against a real production build.
    if (process.env.NODE_ENV !== "production") return;

    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline support degrades gracefully — a failed registration just
      // means the app behaves like it did before this fix.
    });
  }, []);

  return null;
}
