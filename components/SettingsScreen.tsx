"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { getDailyGoal, setDailyGoal } from "@/lib/db";
import { normalizeDecimalCommas } from "@/lib/fallbackParse";

const PRESETS = [1500, 1800, 2000, 2200, 2500];
const MIN_GOAL = 500;
const MAX_GOAL = 10000;

// "1,5" (comma decimal) and "2 000" (space thousands grouping) both used to
// mis-parse under plain parseInt (BUG-10) — normalize both before parsing.
// Reuses fallbackParse's comma->dot normalizer for the decimal case; the
// thousands-space case has no existing helper to reuse, so it's handled
// inline here.
function normalizeGoalInput(raw: string): string {
  return normalizeDecimalCommas(raw.trim()).replace(/(\d)\s+(?=\d)/g, "$1");
}

export default function SettingsScreen({ onSaved }: { onSaved: () => void }) {
  const [goal, setGoal] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDailyGoal().then((g) => {
      setGoal(g);
      setDraft(String(g));
    });
  }, []);

  function handleDraftChange(value: string) {
    setDraft(value);
    if (error) setError(null);
  }

  async function handleSave() {
    const normalized = normalizeGoalInput(draft);
    if (normalized === "") {
      setError("Enter your daily calorie goal.");
      return;
    }
    const value = Number(normalized);
    if (!Number.isFinite(value)) {
      setError("Enter a valid number.");
      return;
    }
    if (value <= 0) {
      setError("Goal must be greater than 0.");
      return;
    }

    const clamped = Math.min(MAX_GOAL, Math.max(MIN_GOAL, Math.round(value)));
    await setDailyGoal(clamped);
    setGoal(clamped);
    setDraft(String(clamped));
    setError(
      clamped !== Math.round(value)
        ? `Adjusted to ${clamped} kcal (allowed range ${MIN_GOAL}–${MAX_GOAL}).`
        : null
    );
    setSaved(true);
    onSaved();
    setTimeout(() => setSaved(false), 1400);
  }

  return (
    <div className="flex flex-col gap-6 px-5 pb-4 pt-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Settings</h1>
        <p className="mt-1 text-sm text-neutral-400">Set your daily calorie goal.</p>
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
        <label htmlFor="daily-goal-input" className="text-sm font-medium text-neutral-400">
          Daily goal (kcal)
        </label>
        <input
          id="daily-goal-input"
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={(e) => handleDraftChange(e.target.value)}
          className="mt-2 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-[16px] text-white outline-none focus:border-neutral-600 transition-colors"
        />

        {error && (
          <p role="alert" className="mt-2 text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <motion.button
              key={p}
              whileTap={{ scale: 0.94 }}
              onClick={() => handleDraftChange(String(p))}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                draft === String(p)
                  ? "bg-emerald-500 text-black"
                  : "bg-neutral-800 text-neutral-300"
              }`}
            >
              {p}
            </motion.button>
          ))}
        </div>

        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={handleSave}
          disabled={goal === null}
          className="mt-4 w-full rounded-2xl bg-white py-3 text-[16px] font-semibold text-black disabled:opacity-40 transition-opacity"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={saved ? "saved" : "save"}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="inline-block"
            >
              {saved ? "Saved ✓" : "Save goal"}
            </motion.span>
          </AnimatePresence>
        </motion.button>
      </div>

      <p className="text-xs text-neutral-600">
        All data stays on this device (IndexedDB). No account, no cloud sync.
      </p>
    </div>
  );
}
