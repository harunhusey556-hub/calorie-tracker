// Polyfills IndexedDB in the Node test environment so lib/db.ts (Dexie) can
// run against a real (in-memory) IDB implementation instead of mocks.
import "fake-indexeddb/auto";
