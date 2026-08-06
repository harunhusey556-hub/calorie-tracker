import { test, expect } from "@playwright/test";

// BUG-07: an installed app must still render its shell (Today/History/
// Settings — all client-side tabs on "/") when the network is down, instead
// of the browser's dinosaur/offline error page. The service worker (public/
// sw.js) only registers against a production build, which is what
// `npm run test:e2e`'s webServer (`npm run start`) already serves.
test.describe("offline app shell (BUG-07)", () => {
  test("reloading offline after one online visit still renders the app shell", async ({
    page,
    context,
  }) => {
    // First visit online: lets the SW install and its fetch handlers cache
    // the document + JS/CSS. Documented tradeoff in sw.js — this covers
    // "load once online, then works offline" (how PWA installs actually
    // happen), not offline-before-any-successful-load.
    await page.goto("/");
    await expect(page).toHaveTitle(/Calories/i);
    await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();

    // `ServiceWorkerRegistration.active` is truthy for BOTH the "activating"
    // and "activated" states — the flake (~1/8 runs, QA PATCH_QA round 2)
    // was this resolving mid-"activating", i.e. while the activate handler's
    // clients.claim() (public/sw.js) was still in flight. The reload() right
    // after then raced clients.claim() finishing, so the new navigation
    // sometimes wasn't assigned a controller within the 10s budget. Pinning
    // this wait to the terminal "activated" state means clients.claim() has
    // already resolved before we reload, making the controller handoff
    // deterministic.
    await page.waitForFunction(
      async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        return reg?.active?.state === "activated";
      },
      undefined,
      { timeout: 10_000 }
    );

    // The tab that installed the SW isn't itself under its control yet (spec
    // behavior even with clients.claim() in activate) — one more online
    // navigation puts this page under SW control before we cut the network.
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 10_000,
    });

    await context.setOffline(true);
    try {
      const pageErrors: string[] = [];
      page.on("pageerror", (err) => pageErrors.push(err.message));

      await page.reload();

      // Real app shell, not chrome-error://.../not-connected-to-internet.
      await expect(page).toHaveTitle(/Calories/i);
      await expect(page.getByRole("heading", { name: "Today" })).toBeVisible({ timeout: 10_000 });
      expect(pageErrors).toEqual([]);
    } finally {
      await context.setOffline(false);
    }
  });
});
