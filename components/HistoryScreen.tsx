"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useTransform, animate } from "framer-motion";
import { getAllMeals, deleteMeal, addMeal, mealsProtein, type Meal } from "@/lib/db";

function dayLabel(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yest)) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

function mealProtein(meal: Meal): number {
  return Math.round(meal.items.reduce((sum, item) => sum + item.protein_g, 0) * 10) / 10;
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
      <path
        d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m1 0-.7 12.1A2 2 0 0 1 15.3 21H8.7a2 2 0 0 1-2-1.9L6 7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SwipeableMeal({ meal, onDelete }: { meal: Meal; onDelete: (id: number) => void }) {
  const x = useMotionValue(0);
  const deleteOpacity = useTransform(x, [-80, -20, 0], [1, 0.4, 0]);
  const [removing, setRemoving] = useState(false);

  // Shared by the swipe gesture and the explicit delete button below — swipe
  // alone has no confirm step and isn't reachable without touch, so the
  // button gives keyboard/screen-reader users (and anyone who doesn't want
  // to trust an accidental swipe) an equivalent, testable path to the same
  // BUG-06 delete flow.
  function triggerDelete() {
    if (meal.id === undefined) return;
    setRemoving(true);
    const id = meal.id;
    setTimeout(() => onDelete(id), 180);
  }

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
            triggerDelete();
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
              {new Date(meal.timestamp).toLocaleTimeString("en-US", {
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
        <div className="ml-3 flex shrink-0 items-center gap-2">
          <span className="text-right text-sm font-medium tabular-nums text-neutral-300">
            {meal.total_calories} kcal
            <span className="block text-xs font-normal text-neutral-500">{mealProtein(meal)}g protein</span>
          </span>
          <button
            type="button"
            aria-label={`Delete ${meal.text}`}
            data-testid={meal.id !== undefined ? `delete-meal-${meal.id}` : undefined}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              triggerDelete();
            }}
            className="rounded-full p-1.5 text-neutral-600 transition-colors active:text-red-400"
          >
            <TrashIcon />
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

const UNDO_WINDOW_MS = 5000;
const DELETE_ERROR_MS = 4000;

function sortByTimestampDesc(list: Meal[]): Meal[] {
  return [...list].sort((a, b) => b.timestamp - a.timestamp);
}

export default function HistoryScreen({ refreshKey }: { refreshKey: number }) {
  const [meals, setMeals] = useState<Meal[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Deleted meal kept around for the undo window — deleteMeal() already
  // removed it from Dexie by the time this is set, so undo re-inserts via
  // addMeal() rather than reverting a not-yet-committed delete.
  const [pendingUndo, setPendingUndo] = useState<Meal | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deleteErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      if (deleteErrorTimerRef.current) clearTimeout(deleteErrorTimerRef.current);
    },
    []
  );

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
    const meal = meals.find((m) => m.id === id);
    setMeals((prev) => prev.filter((m) => m.id !== id));
    try {
      await deleteMeal(id);
      // A second delete before the first undo window closes shouldn't lose
      // the earlier undo silently — commit is already done for both, so
      // just swap which one the snackbar offers to restore.
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      if (meal) setPendingUndo(meal);
      undoTimerRef.current = setTimeout(() => setPendingUndo(null), UNDO_WINDOW_MS);
    } catch {
      // Delete failed server/DB-side — the optimistic removal above was
      // wrong, put the row back and tell the user instead of silently
      // losing it (BUG-06).
      if (meal) setMeals((prev) => sortByTimestampDesc([...prev, meal]));
      setDeleteError("Couldn't delete that meal. Try again.");
      if (deleteErrorTimerRef.current) clearTimeout(deleteErrorTimerRef.current);
      deleteErrorTimerRef.current = setTimeout(() => setDeleteError(null), DELETE_ERROR_MS);
    }
  }

  async function handleUndo() {
    if (!pendingUndo) return;
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    const { id, ...rest } = pendingUndo;
    void id; // drop the old id — addMeal assigns a fresh one on re-insert
    setPendingUndo(null);
    try {
      const newId = await addMeal(rest);
      setMeals((prev) => sortByTimestampDesc([...prev, { ...rest, id: newId }]));
    } catch {
      setDeleteError("Couldn't undo. Try deleting again if needed.");
      if (deleteErrorTimerRef.current) clearTimeout(deleteErrorTimerRef.current);
      deleteErrorTimerRef.current = setTimeout(() => setDeleteError(null), DELETE_ERROR_MS);
    }
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
              <div className="mb-2 flex items-baseline justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  {group.label}
                </p>
                <p className="text-xs tabular-nums text-neutral-600">
                  {group.meals.reduce((sum, m) => sum + m.total_calories, 0)} kcal ·{" "}
                  {mealsProtein(group.meals)}g protein
                </p>
              </div>
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

      <AnimatePresence>
        {deleteError && (
          <motion.p
            key="delete-error"
            role="alert"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="fixed inset-x-5 bottom-24 z-20 rounded-xl bg-red-500/90 px-4 py-3 text-center text-sm font-medium text-white shadow-lg"
          >
            {deleteError}
          </motion.p>
        )}
        {!deleteError && pendingUndo && (
          <motion.div
            key="undo-snackbar"
            role="status"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="fixed inset-x-5 bottom-24 z-20 flex items-center justify-between gap-3 rounded-xl bg-neutral-800 px-4 py-3 text-sm text-white shadow-lg"
          >
            <span className="truncate">Meal deleted</span>
            <button type="button" onClick={handleUndo} className="shrink-0 font-semibold text-emerald-400">
              Undo
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
