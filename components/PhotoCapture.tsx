"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { resizeImageFile } from "@/lib/resizeImage";
import type { MealItem } from "@/lib/db";

export type PhotoParseResult = {
  items: MealItem[];
  total_calories: number;
  source: "nvidia-vision" | "fallback";
};

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
      <path
        d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.19a1.5 1.5 0 0 0 1.28-.72l.66-1.06A1.5 1.5 0 0 1 10.91 4.5h2.18a1.5 1.5 0 0 1 1.28.72l.66 1.06A1.5 1.5 0 0 0 16.31 7h2.19A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-9Z"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <circle cx="12" cy="12.5" r="3.4" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function GalleryIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="8.5" cy="9.5" r="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 16.5 8.5 12l3 3 3.5-4L20 16.5" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Capture (camera) or pick (gallery) a meal photo, resize it client-side,
 * upload to /api/parse-photo, and hand the result up to the parent — which
 * renders it through the same MealResultCard used by text parsing.
 */
export default function PhotoCapture({
  onResult,
  onError,
  onLoadingChange,
}: {
  onResult: (result: PhotoParseResult) => void;
  onError: () => void;
  onLoadingChange?: (loading: boolean) => void;
}) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState("");
  const [slowWait, setSlowWait] = useState(false);
  // BUG-09: decode failures (e.g. HEIC — the default iPhone photo format,
  // which createImageBitmap can't handle in most browsers even though
  // accept="image/*" lets the file through the picker) happen client-side,
  // before any network request. Routing them through the same "check your
  // connection" copy the network-error path uses is misleading, so they get
  // their own local message instead of going through onError().
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => () => abortControllerRef.current?.abort(), []);

  // The vision model chain (primary -> fallback, ~12s/stage) can take up to
  // ~24s worst case — swap the spinner copy after a while so a long wait
  // doesn't read as frozen.
  useEffect(() => {
    if (!loading) {
      setSlowWait(false);
      return;
    }
    const t = setTimeout(() => setSlowWait(true), 12_000);
    return () => clearTimeout(t);
  }, [loading]);

  function reset() {
    setPreviewUrl(null);
    if (cameraInputRef.current) cameraInputRef.current.value = "";
    if (libraryInputRef.current) libraryInputRef.current.value = "";
  }

  function handleCancel() {
    abortControllerRef.current?.abort();
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setLocalError(null);
    setLoading(true);
    onLoadingChange?.(true);

    // Decode/resize happens entirely client-side (canvas + createImageBitmap)
    // before anything touches the network — keep its failure path separate
    // from the fetch below so a bad file (e.g. unsupported HEIC) doesn't get
    // mislabeled as a connection problem.
    let blob: Blob;
    let dataUrl: string;
    try {
      ({ blob, dataUrl } = await resizeImageFile(file));
    } catch {
      setLoading(false);
      onLoadingChange?.(false);
      reset();
      setLocalError(
        "Couldn't open that photo — it may be an unsupported format (e.g. HEIC). Try a different photo, or take a new one."
      );
      return;
    }
    setPreviewUrl(dataUrl);

    const controller = new AbortController();
    abortControllerRef.current = controller;
    try {
      const formData = new FormData();
      formData.append("photo", blob, "meal.jpg");
      if (notes.trim()) formData.append("notes", notes.trim());
      const res = await fetch("/api/parse-photo", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`parse-photo failed: ${res.status}`);
      const data: PhotoParseResult = await res.json();
      onResult(data);
    } catch (err) {
      reset();
      // A user-initiated cancel isn't an error — just go back to the
      // picker silently instead of showing a connection-error message.
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        onError();
      }
    } finally {
      abortControllerRef.current = null;
      setLoading(false);
      onLoadingChange?.(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <input
        ref={libraryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      {previewUrl ? (
        <div className="relative overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="Meal photo" className="aspect-[4/3] w-full object-cover" />
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/65 backdrop-blur-sm px-6 text-center">
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              <span className="text-sm font-medium text-white">
                {slowWait ? "Still working — can take up to a minute…" : "Identifying…"}
              </span>
              <button
                onClick={handleCancel}
                className="mt-1 rounded-full border border-white/25 px-4 py-1.5 text-xs font-medium text-white transition-colors active:bg-white/10"
              >
                Cancel
              </button>
            </div>
          )}
          {!loading && (
            <button
              onClick={reset}
              className="absolute right-2 top-2 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm transition-colors active:bg-black/80"
            >
              Retake
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {localError && (
            <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {localError}
            </p>
          )}
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, 300))}
            placeholder="Add details AI might miss (optional) — e.g. &quot;that's mustard, not cheese&quot;"
            className="w-full rounded-2xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-[15px] text-white placeholder:text-neutral-500 focus:border-neutral-600 focus:outline-none"
          />
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={() => cameraInputRef.current?.click()}
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-3.5 text-[16px] font-semibold text-black disabled:opacity-40 transition-opacity"
          >
            <CameraIcon />
            Take a photo
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={() => libraryInputRef.current?.click()}
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-neutral-800 bg-neutral-900 py-3.5 text-[16px] font-semibold text-white disabled:opacity-40 transition-colors"
          >
            <GalleryIcon />
            Choose from library
          </motion.button>
        </div>
      )}
    </div>
  );
}
