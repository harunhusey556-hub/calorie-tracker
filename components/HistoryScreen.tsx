"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useTransform, animate } from "framer-motion";
import { getAllMeals, deleteMeal, type Meal } from "@/lib/db";

function dayLabel(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yest)) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function SwipeableMeal({ meal, onDelete }: { meal: Meal; onDelete: (id: number) => void }) {
  const x = useMotionValue(0);
  const deleteOpacity = useTransform(x, [-80, -20, 0], [1, 0.4, 0]);
  const [removing, setRemoving] = useState(false);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: removing ? 0 : 1, y: 0, height: removing ? 0 : "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 30 }}
      className="relative overflow-hidden rounded-xl"
    >
      <motion.div
        style={{ opacity: deleteOpacity }}
        className="absolute inset-0 flex items-center justify-end bg-red-500 px-5"
      >
        <span className="text-sm font-semibold text-white">Delete</span>
      </motion.div>
      <motion.div
        drag="x"
        dragConstraints={{ left: -120, right: 0 }}
        dragElastic={0.15}
        style={{ x }}
        onDragEnd={(_, info) => {
          if (info.offset.x < -70 && meal.id !== undefined) {
            setRemoving(true);
            const id = meal.id;
            setTimeout(() => onDelete(id), 180);
          } else {
            animate(x, 0, { type: "spring", stiffness: 400, damping: 30 });
          }
        }}
        className="relative flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3"
      >
        <div className="min-w-0">
          <p className="truncate text-sm text-white">{meal.text}</p>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-neutral-500">
            <span>
              {new Date(meal.timestamp).toLocaleTimeString(undefined, {
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
            {meal.source === "fallback" && (
              <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                estimate
              </span>
            )}
          </div>
        </div>
        <span className="ml-3 shrink-0 text-sm font-medium tabular-nums text-neutral-300">
          {meal.total_calories} kcal
        </span>
      </motion.div>
    </motion.div>
  );
}

export default function HistoryScreen({ refreshKey }: { refreshKey: number }) {
  const [meals, setMeals] = useState<Meal[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setError(false);
    getAllMeals()
      .then((m) => {
        if (!cancelled) {
          setMeals(m);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  async function handleDelete(id: number) {
    setMeals((prev) => prev.filter((m) => m.id !== id));
    await deleteMeal(id);
  }

  const groups: { label: string; meals: Meal[] }[] = [];
  for (const meal of meals) {
    const label = dayLabel(meal.timestamp);
    const group = groups.find((g) => g.label === label);
    if (group) group.meals.push(meal);
    else groups.push({ label, meals: [meal] });
  }

  return (
    <div className="flex flex-col gap-5 px-5 pb-4 pt-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">History</h1>
        <p className="mt-1 text-sm text-neutral-400">Swipe a meal left to delete.</p>
      </div>

      {error && (
        <p className="rounded-xl bg-red-500/10 px-4 py-3 text-center text-sm text-red-300">
          Couldn&apos;t load your history. Try reopening the app.
        </p>
      )}

      {!error && loaded && groups.length === 0 && (
        <p className="rounded-xl border border-dashed border-neutral-800 px-4 py-8 text-center text-sm text-neutral-500">
          No meals logged yet.
        </p>
      )}

      {!error && !loaded && (
        <div className="flex flex-col gap-5">
          {[0, 1].map((g) => (
            <div key={g} className="flex flex-col gap-2">
              <div className="mb-1 h-3 w-16 animate-pulse rounded bg-neutral-900" />
              {[0, 1].map((i) => (
                <div
                  key={i}
                  className="h-[60px] animate-pulse rounded-xl border border-neutral-800 bg-neutral-900"
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {!error && (
        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                {group.label}
              </p>
              <div className="flex flex-col gap-2">
                <AnimatePresence initial={false}>
                  {group.meals.map((meal) => (
                    <SwipeableMeal key={meal.id} meal={meal} onDelete={handleDelete} />
                  ))}
                </AnimatePresence>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
