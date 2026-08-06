"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { addMeal, type MealItem } from "@/lib/db";
import PhotoCapture, { type PhotoParseResult } from "./PhotoCapture";
import MealResultCard, { type MealSource } from "./MealResultCard";

type ParseResult = {
  items: MealItem[];
  total_calories: number;
  source: MealSource;
};

type Mode = "text" | "photo";

export default function LogScreen({ onSaved }: { onSaved: () => void }) {
  const [mode, setMode] = useState<Mode>("text");
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [saved, setSaved] = useState(false);

  const busy = status === "loading" || photoBusy;

  function switchMode(next: Mode) {
    if (next === mode || busy) return;
    setMode(next);
    setStatus("idle");
    setResult(null);
    setSaved(false);
  }

  async function handleParseText() {
    if (!text.trim()) return;
    setStatus("loading");
    setResult(null);
    setSaved(false);
    try {
      const res = await fetch("/api/parse-meal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error("parse failed");
      const data: ParseResult = await res.json();
      setResult(data);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  function handlePhotoResult(data: PhotoParseResult) {
    setResult(data);
    setStatus("idle");
    setSaved(false);
  }

  function handlePhotoError() {
    setResult(null);
    setStatus("error");
  }

  // Backend contract: a "couldn't identify" photo comes back as a single
  // zero-calorie fallback item — never a dead end, drop straight into
  // manual text entry instead of showing a fake confirm card.
  const isPhotoDeadEnd =
    mode === "photo" &&
    result !== null &&
    result.source === "fallback" &&
    result.total_calories === 0;

  async function handleSave() {
    if (!result || isPhotoDeadEnd) return;
    const summary = mode === "photo" ? result.items.map((i) => i.name).join(", ") || "Photo meal" : text;
    await addMeal({
      text: summary,
      items: result.items,
      total_calories: result.total_calories,
      // Photo results carry "nvidia-vision"; the local schema only tracks
      // AI-success vs. fallback, so normalize to the existing "nvidia" bucket.
      source: result.source === "fallback" ? "fallback" : "nvidia",
      timestamp: Date.now(),
    });
    setSaved(true);
    setTimeout(() => {
      setText("");
      setResult(null);
      setSaved(false);
      onSaved();
    }, 650);
  }

  return (
    <div className="flex flex-col gap-5 px-5 pb-4 pt-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Log a meal</h1>
        <p className="mt-1 text-sm text-neutral-400">
          {mode === "text" ? "Describe what you ate, plain English." : "Snap or pick a photo of your meal."}
        </p>
      </div>

      <div className="relative flex rounded-2xl bg-neutral-900 p-1">
        {(["text", "photo"] as const).map((m) => {
          const active = mode === m;
          return (
            <button
              key={m}
              onClick={() => switchMode(m)}
              disabled={busy}
              className="relative z-10 flex-1 rounded-xl py-2 text-sm font-medium transition-colors disabled:opacity-60"
              style={{ color: active ? "#000000" : "#a3a3a3" }}
            >
              {active && (
                <motion.div
                  layoutId="log-mode-pill"
                  className="absolute inset-0 -z-10 rounded-xl bg-white"
                  transition={{ type: "spring", stiffness: 500, damping: 34 }}
                />
              )}
              {m === "text" ? "Text" : "Photo"}
            </button>
          );
        })}
      </div>

      {mode === "text" ? (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="2 eggs, toast, coffee with milk"
            rows={3}
            className="w-full resize-none rounded-2xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-[16px] text-white placeholder:text-neutral-600 outline-none focus:border-neutral-600 transition-colors"
          />

          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={handleParseText}
            disabled={!text.trim() || status === "loading"}
            className="w-full rounded-2xl bg-emerald-500 py-3.5 text-[16px] font-semibold text-black disabled:opacity-40 transition-opacity"
          >
            {status === "loading" ? "Parsing…" : "Parse meal"}
          </motion.button>
        </>
      ) : (
        <PhotoCapture
          onResult={handlePhotoResult}
          onError={handlePhotoError}
          onLoadingChange={setPhotoBusy}
        />
      )}

      <AnimatePresence mode="wait">
        {status === "error" && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-300"
          >
            {mode === "text"
              ? "Couldn't reach the parser. Check your connection and try again."
              : "Couldn't reach the photo parser. Check your connection and try again."}
          </motion.div>
        )}

        {result && !isPhotoDeadEnd && result.items.length === 0 && (
          <motion.div
            key="empty"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-xl bg-neutral-900 px-4 py-3 text-sm text-neutral-400"
          >
            Couldn&apos;t estimate anything from that text. Try naming the foods more
            plainly — e.g. &ldquo;2 eggs, toast&rdquo;.
          </motion.div>
        )}

        {isPhotoDeadEnd && (
          <motion.div
            key="photo-dead-end"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex flex-col gap-3 rounded-xl bg-neutral-900 px-4 py-3 text-sm text-neutral-400"
          >
            <span>Couldn&apos;t identify anything in that photo. Add it manually instead.</span>
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={() => switchMode("text")}
              className="w-full rounded-xl bg-white py-2.5 text-sm font-semibold text-black transition-colors"
            >
              Enter manually
            </motion.button>
          </motion.div>
        )}

        {result && !isPhotoDeadEnd && result.items.length > 0 && (
          <MealResultCard
            items={result.items}
            totalCalories={result.total_calories}
            source={result.source}
            saved={saved}
            onSave={handleSave}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
