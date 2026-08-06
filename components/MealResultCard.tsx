"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { MealItem } from "@/lib/db";

export type MealSource = "nvidia" | "nvidia-vision" | "fallback";

/**
 * Confirm-and-save card, shared by text parsing and photo parsing — one
 * result shape in, one save action out, regardless of how the items were
 * identified.
 */
export default function MealResultCard({
  items,
  totalCalories,
  source,
  saved,
  onSave,
}: {
  items: MealItem[];
  totalCalories: number;
  source: MealSource;
  saved: boolean;
  onSave: () => void;
}) {
  return (
    <motion.div
      key="result"
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ type: "spring", stiffness: 300, damping: 28 }}
      className="flex flex-col gap-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-4"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-neutral-300">Parsed items</span>
        {source === "fallback" && (
          <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-medium text-amber-400">
            estimate
          </span>
        )}
      </div>

      <ul className="flex flex-col divide-y divide-neutral-800">
        {items.map((item, i) => (
          <li key={i} className="flex items-center justify-between py-2">
            <span className="text-sm text-white">
              {item.qty > 1 ? `${item.qty}× ` : ""}
              {item.name}
            </span>
            <span className="text-right text-sm tabular-nums text-neutral-400">
              {item.calories} kcal
              <span className="ml-2 text-neutral-500">{item.protein_g}g protein</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-between border-t border-neutral-800 pt-3">
        <span className="text-sm font-medium text-neutral-300">Total</span>
        <span className="text-right">
          <span className="text-lg font-semibold tabular-nums text-white">{totalCalories} kcal</span>
          <span className="block text-xs tabular-nums text-neutral-500">
            {items.reduce((sum, item) => sum + item.protein_g, 0).toFixed(1)}g protein
          </span>
        </span>
      </div>

      <motion.button
        whileTap={{ scale: 0.96 }}
        onClick={onSave}
        className="mt-1 w-full rounded-2xl bg-white py-3 text-[16px] font-semibold text-black transition-colors"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={saved ? "saved" : "save"}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="inline-block"
          >
            {saved ? "Saved ✓" : "Save to log"}
          </motion.span>
        </AnimatePresence>
      </motion.button>
    </motion.div>
  );
}
