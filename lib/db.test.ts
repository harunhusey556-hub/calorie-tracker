import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import {
  db,
  addMeal,
  getMealsForDay,
  getTotalCaloriesForDay,
  type Meal,
} from "./db";

// Characterization tests for the day-boundary math used by getMealsForDay /
// getTotalCaloriesForDay (BUG-04 root-cause investigation — see HANDOFF.md).
// These pin down CURRENT behavior of lib/db.ts. They pass today: the boundary
// arithmetic itself ([localMidnight, localMidnight+24h)) is correct. BUG-04
// ("Today screen keeps showing yesterday after midnight") is NOT a db.ts bug
// — it's that TodayScreen.tsx never re-calls these functions after mount
// (no timer / visibilitychange / focus listener), so it keeps querying with
// a stale `new Date()` captured once at effect-run time. See HANDOFF.md for
// the frontend hand-off note.

function meal(overrides: Partial<Meal> & { timestamp: number }): Omit<Meal, "id"> {
  return {
    text: "test meal",
    items: [],
    total_calories: 100,
    source: "fallback",
    ...overrides,
  };
}

beforeEach(async () => {
  // Clear all rows between tests instead of swapping the IDBFactory: Dexie
  // caches its indexedDB reference at construction time, so reassigning
  // globalThis.indexedDB afterward doesn't take effect on the open connection.
  await db.meals.clear();
});

describe("day-boundary characterization (lib/db.ts, Europe/Helsinki)", () => {
  it("a meal at local 23:59:59.999 belongs to that day, not the next", async () => {
    const day = new Date(2026, 5, 15); // Mon Jun 15 2026, local
    const lastMoment = new Date(2026, 5, 15, 23, 59, 59, 999).getTime();
    await addMeal(meal({ timestamp: lastMoment, total_calories: 111 }));

    const sameDay = await getMealsForDay(day);
    expect(sameDay).toHaveLength(1);

    const nextDay = new Date(2026, 5, 16);
    const nextDayMeals = await getMealsForDay(nextDay);
    expect(nextDayMeals).toHaveLength(0);
  });

  it("a meal at local 00:00:00.000 belongs to that day (start inclusive)", async () => {
    const midnight = new Date(2026, 5, 16, 0, 0, 0, 0).getTime();
    await addMeal(meal({ timestamp: midnight, total_calories: 222 }));

    const thatDay = await getMealsForDay(new Date(2026, 5, 16));
    expect(thatDay).toHaveLength(1);

    const priorDay = await getMealsForDay(new Date(2026, 5, 15));
    expect(priorDay).toHaveLength(0);
  });

  it("getTotalCaloriesForDay only sums meals inside the given local day", async () => {
    await addMeal(meal({ timestamp: new Date(2026, 5, 15, 8, 0).getTime(), total_calories: 300 }));
    await addMeal(meal({ timestamp: new Date(2026, 5, 15, 23, 59).getTime(), total_calories: 400 }));
    await addMeal(meal({ timestamp: new Date(2026, 5, 16, 0, 0, 1).getTime(), total_calories: 999 })); // next day

    const total = await getTotalCaloriesForDay(new Date(2026, 5, 15));
    expect(total).toBe(700);
  });

  it("survives the Finnish DST spring-forward day (2026-03-29, clocks 03:00->04:00 EEST)", async () => {
    const dstDay = new Date(2026, 2, 29); // Mar 29 2026
    await addMeal(meal({ timestamp: new Date(2026, 2, 29, 1, 0).getTime(), total_calories: 50 }));
    await addMeal(meal({ timestamp: new Date(2026, 2, 29, 10, 0).getTime(), total_calories: 60 }));
    await addMeal(meal({ timestamp: new Date(2026, 2, 30, 1, 0).getTime(), total_calories: 999 }));

    const total = await getTotalCaloriesForDay(dstDay);
    expect(total).toBe(110);
  });

  it("survives the Finnish DST fall-back day (2026-10-25, clocks 04:00->03:00 EET, repeated hour)", async () => {
    const dstDay = new Date(2026, 9, 25); // Oct 25 2026
    await addMeal(meal({ timestamp: new Date(2026, 9, 25, 3, 30).getTime(), total_calories: 70 }));
    await addMeal(meal({ timestamp: new Date(2026, 9, 25, 20, 0).getTime(), total_calories: 80 }));
    await addMeal(meal({ timestamp: new Date(2026, 9, 26, 0, 30).getTime(), total_calories: 999 }));

    const total = await getTotalCaloriesForDay(dstDay);
    expect(total).toBe(150);
  });

  it("default-argument freshness: calling with no date each time uses Date.now() at call time (not cached)", async () => {
    // This documents WHY db.ts itself is not BUG-04's root cause: the
    // exported functions are correct if re-invoked. The bug is that
    // TodayScreen.tsx doesn't re-invoke them after midnight — it captures
    // one `new Date()` per mount/effect-run and never refreshes.
    const now = Date.now();
    await addMeal(meal({ timestamp: now, total_calories: 42 }));
    const meals = await getMealsForDay(); // no arg -> defaults to `new Date()` NOW
    expect(meals.some((m) => m.total_calories === 42)).toBe(true);
  });
});
