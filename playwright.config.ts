import { defineConfig, devices } from "@playwright/test";

// Mobile-first per PLAN.md acceptance (375px viewport, phone UX). No
// GROQ/NVIDIA key in CI — tests must pass against the fallback path only.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // Only 2 spec files; forcing 1 worker avoids a cross-file SW-registration
  // race (both files hit the same origin) at zero real throughput cost.
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run start -- -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
