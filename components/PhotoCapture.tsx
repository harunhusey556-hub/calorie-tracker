"use client";

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { resizeImageFile } from "@/lib/resizeImage";
import type { MealItem } from "@/lib/db";

export type PhotoParseResult = {
  items: MealItem[];
  total_calories: number;
  source: "groq-vision" | "fallback";
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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function reset() {
    setPreviewUrl(null);
    if (cameraInputRef.current) cameraInputRef.current.value = "";
    if (libraryInputRef.current) libraryInputRef.current.value = "";
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setLoading(true);
    onLoadingChange?.(true);
    try {
      const { blob, dataUrl } = await resizeImageFile(file);
      setPreviewUrl(dataUrl);

      const formData = new FormData();
      formData.append("photo", blob, "meal.jpg");
      const res = await fetch("/api/parse-photo", { method: "POST", body: formData });
      if (!res.ok) throw new Error(`parse-photo failed: ${res.status}`);
      const data: PhotoParseResult = await res.json();
      onResult(data);
    } catch {
      reset();
      onError();
    } finally {
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
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/65 backdrop-blur-sm">
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              <span className="text-sm font-medium text-white">Identifying…</span>
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
