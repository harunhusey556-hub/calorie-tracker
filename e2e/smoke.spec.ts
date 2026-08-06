import { test, expect } from "@playwright/test";

// Minimal e2e smoke test wiring for `npm run test:e2e` (R0 infra scope).
// Deeper UI-flow e2e (log-text -> ring update, double-tap-save regression,
// swipe-delete, settings propagation — see audit-report.md section 5 item 3)
// belongs to whoever owns those components; this only proves the harness
// runs against a real build with no console errors, mobile viewport,
// no-key fallback path.
test.describe("smoke", () => {
  test("app shell loads on mobile viewport with no console errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    await page.goto("/");
    await expect(page).toHaveTitle(/Calories/i);

    expect(consoleErrors).toEqual([]);
  });
});
