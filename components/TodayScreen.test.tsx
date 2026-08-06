// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import TodayScreen from "./TodayScreen";

const state = { total: 0 };

vi.mock("@/lib/db", () => ({
  getMealsForDay: vi.fn(async () => []),
  getTotalCaloriesForDay: vi.fn(async () => state.total),
  getDailyGoal: vi.fn(async () => 2000),
  mealsProtein: vi.fn(() => 0),
}));

import { getTotalCaloriesForDay } from "@/lib/db";

describe("TodayScreen — BUG-04 stale after midnight / PWA resume", () => {
  beforeEach(() => {
    state.total = 0;
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-fetches when the tab/PWA becomes visible again (resume from background)", async () => {
    render(<TodayScreen refreshKey={0} />);
    await waitFor(() => expect(getTotalCaloriesForDay).toHaveBeenCalledTimes(1));

    // A meal was logged (e.g. in another tab) while the PWA was backgrounded.
    state.total = 300;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() => expect(getTotalCaloriesForDay).toHaveBeenCalledTimes(2));
    await screen.findByText("300");
  });

  it("re-fetches on window focus", async () => {
    render(<TodayScreen refreshKey={0} />);
    await waitFor(() => expect(getTotalCaloriesForDay).toHaveBeenCalledTimes(1));

    state.total = 500;
    window.dispatchEvent(new Event("focus"));

    await waitFor(() => expect(getTotalCaloriesForDay).toHaveBeenCalledTimes(2));
    await screen.findByText("500");
  });

  it("re-fetches when the local day rolls over while the app stays open", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-06T23:59:50+03:00"));

    render(<TodayScreen refreshKey={0} />);
    await vi.waitFor(() => expect(getTotalCaloriesForDay).toHaveBeenCalledTimes(1));

    state.total = 42;
    // Cross local midnight; the day-rollover backstop polls periodically.
    vi.setSystemTime(new Date("2026-08-07T00:01:00+03:00"));
    await vi.advanceTimersByTimeAsync(65_000);

    await vi.waitFor(() => expect(getTotalCaloriesForDay).toHaveBeenCalledTimes(2));
  });
});
