import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules/**", "e2e/**", ".next/**"],
    setupFiles: ["./vitest.setup.ts"],
    // Repo owner is in Helsinki; day-boundary tests rely on this locale/TZ.
    env: { TZ: "Europe/Helsinki" },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
