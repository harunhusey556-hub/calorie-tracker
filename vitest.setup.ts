// Polyfills IndexedDB in the Node test environment so lib/db.ts (Dexie) can
// run against a real (in-memory) IDB implementation instead of mocks.
import "fake-indexeddb/auto";

// jest-dom matchers (toBeInTheDocument, etc). Safe to import even for the
// node-environment test files (db/route/fallbackParse) — it only extends
// `expect`, it doesn't touch the DOM.
import "@testing-library/jest-dom/vitest";

// Vitest has no jest-style global afterEach auto-cleanup for RTL; without
// this, component trees from one test leak into the next and queries like
// getByRole start matching duplicates across tests.
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
afterEach(() => {
  if (typeof document !== "undefined") cleanup();
});

// jsdom (used by component tests via `// @vitest-environment jsdom`) doesn't
// implement matchMedia; framer-motion's useReducedMotion() calls it on mount.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
