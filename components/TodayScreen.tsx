"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  getMealsForDay,
  getTotalCaloriesForDay,
  getDailyGoal,
  mealsProtein,
  type Meal,
} from "@/lib/db";
import CalorieRing from "./CalorieRing";

// Local-midnight key so the day-rollover backstop only re-fetches when the
// day has actually changed, not on every poll tick.
function localDayKey(d: Date): number {
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  return start.getTime();
}

export default function TodayScreen({ refreshKey }: { refreshKey: number }) {
  const [total, setTotal] = useState(0);
  const [goal, setGoal] = useState(2000);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  // BUG-04: bumped by the resume/rollover listeners below to force the load
  // effect to re-run — `refreshKey` alone only fires on external nav events
  // (tab switch), never on midnight rollover or PWA background/foreground.
  const [staleTick, setStaleTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setError(false);
    async function load() {
      try {
        const [t, g, m] = await Promise.all([
          getTotalCaloriesForDay(),
          getDailyGoal(),
          getMealsForDay(),
        ]);
        if (cancelled) return;
        setTotal(t);
        setGoal(g);
        setMeals(m);
        setLoaded(true);
      } catch {
        if (!cancelled) {
          setError(true);
          setLoaded(true);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, staleTick]);

  // Re-fetch on PWA resume (visibilitychange), tab/window focus, and — as a
  // backstop for an app left open and foregrounded straight through local
  // midnight — a periodic check for day rollover. Without this, Today keeps
  // showing whatever `new Date()` resolved to on the last mount/tab-switch,
  // since db.ts's day-boundary functions are only ever called once per
  // `refreshKey` change (confirmed: db.ts itself is not stateful/cached).
  const dayKeyRef = useRef(localDayKey(new Date()));
  useEffect(() => {
    function refresh() {
      setStaleTick((n) => n + 1);
    }
    function onVisibilityChange() {
      if (document.visibilityState === "visible") refresh();
    }
    function checkDayRollover() {
      const now = localDayKey(new Date());
      if (now !== dayKeyRef.current) {
        dayKeyRef.current = now;
        refresh();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", refresh);
    const interval = setInterval(checkDayRollover, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", refresh);
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="flex flex-col items-center gap-6 px-5 pb-4 pt-8">
      <div className="w-full">
        <h1 className="text-2xl font-semibold text-white">Today</h1>
        <p className="mt-1 text-sm text-neutral-400">
          {/* Fixed locale — server and client can run under different default
              locales, and a locale-dependent string rendered on first paint
              causes a hydration mismatch. */}
          {new Date().toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </p>
      </div>

      {error ? (
        <p className="w-full rounded-xl bg-red-500/10 px-4 py-3 text-center text-sm text-red-300">
          Couldn&apos;t load today&apos;s data. Try reopening the app.
        </p>
      ) : !loaded ? (
        <div className="h-[220px] w-[220px] animate-pulse rounded-full bg-neutral-900" />
      ) : (
        <motion.div
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 22 }}
          className="flex flex-col items-center gap-3"
        >
          <CalorieRing consumed={total} goal={goal} />
          <p className="text-sm font-medium text-neutral-400">
            <span className="text-white">{mealsProtein(meals)}g</span> protein today
          </p>
        </motion.div>
      )}

      {!error && (
        <div className="w-full">
          <p className="mb-2 text-sm font-medium text-neutral-400">
            {loaded ? `${meals.length} meal${meals.length === 1 ? "" : "s"} logged today` : "Loading meals…"}
          </p>
          {!loaded ? (
            <div className="flex flex-col gap-2">
              {[0, 1].map((i) => (
                <div
                  key={i}
                  className="h-[52px] animate-pulse rounded-xl border border-neutral-800 bg-neutral-900"
                />
              ))}
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {meals.map((meal, i) => (
                <motion.li
                  key={meal.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04, type: "spring", stiffness: 300, damping: 26 }}
                  className="flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-white">{meal.text}</p>
                    <p className="text-xs text-neutral-500">
                      {new Date(meal.timestamp).toLocaleTimeString(undefined, {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <span className="ml-3 shrink-0 text-sm font-medium tabular-nums text-neutral-300">
                    {meal.total_calories} kcal
                  </span>
                </motion.li>
              ))}
              {meals.length === 0 && (
                <li className="rounded-xl border border-dashed border-neutral-800 px-4 py-6 text-center text-sm text-neutral-500">
                  Nothing logged yet today. Head to Log to add a meal.
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
