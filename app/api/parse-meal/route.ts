import { NextRequest, NextResponse } from "next/server";
import { fallbackParseMeal, normalizeDecimalCommas, ParseResult } from "@/lib/fallbackParse";

export const runtime = "nodejs";

const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

// MODEL SWITCH (Doctor, 2026-08-06, live benchmark: model-benchmark-20260806.md).
// Old primary meta/llama-3.3-70b-instruct measured 30-40s timeouts — effectively
// dead, every request fell back to the static table. New chain: fast nemotron
// primary (2.6s, thinking disabled) -> old model demoted to fallback -> static
// table. Model names are env-overridable since the NVIDIA catalog has EOL'd
// entries mid-week before (llama-4-maverick, qwen3-next-80b, both HTTP 410).
// Read lazily (not module-level consts) so an env change takes effect on the
// next request without a cold restart, and so tests can override per-case.
function primaryTextModel(): string {
  return process.env.NVIDIA_MODEL_TEXT || "nvidia/nemotron-3-nano-30b-a3b";
}
function fallbackTextModel(): string {
  return process.env.NVIDIA_MODEL_TEXT_FALLBACK || "meta/llama-3.3-70b-instruct";
}
// Per-stage budget, not total — primary+fallback can take up to ~24s worst case.
const STAGE_TIMEOUT_MS = 12_000;

const SYSTEM_PROMPT = `You are a nutrition parser. Given a free-text description of a meal, break it into
distinct food items and estimate calories/macros per item using typical serving sizes.
Respond with ONLY valid JSON (no markdown, no commentary) matching exactly this shape:
{"items":[{"name":"string","qty":number,"calories":number,"protein_g":number,"carbs_g":number,"fat_g":number}],"total_calories":number}
"qty" is the count of that item (default 1). "total_calories" is the sum of all items' calories, rounded to an integer.
All numeric fields are numbers, not strings. Keep item names short and singular (e.g. "egg" not "eggs").`;

interface NvidiaItem {
  name?: unknown;
  qty?: unknown;
  calories?: unknown;
  protein_g?: unknown;
  carbs_g?: unknown;
  fat_g?: unknown;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

// BUG-05: model JSON was trusted unclamped — a hallucinated negative or
// absurd value (calories: -500, protein_g: 1e9) passed straight through to
// storage and poisoned the day total / ring. Clamp to a generously sane
// per-item range; a real single food item never legitimately needs more.
function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
const MAX_ITEM_QTY = 100;
const MAX_ITEM_CALORIES = 5000;
const MAX_ITEM_GRAMS = 500;

// NVIDIA NIM doesn't reliably honor response_format: json_object for this
// model (it's slow and occasionally emits malformed JSON under that mode),
// so we ask for plain JSON in the prompt and strip any markdown fence /
// stray prose the model still wraps around it.
function extractJsonObject(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const body = fenced ? fenced[1] : content;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return body.trim();
  return body.slice(start, end + 1);
}

// Validate + coerce the model's JSON into our strict shape. Throws on anything
// that doesn't look like real parsed data so the caller falls back safely.
function coerceNvidiaResult(raw: unknown): ParseResult {
  if (!raw || typeof raw !== "object") throw new Error("not an object");
  const obj = raw as { items?: unknown; total_calories?: unknown };
  if (!Array.isArray(obj.items)) throw new Error("items missing");

  const items = obj.items.map((entry: NvidiaItem) => {
    if (typeof entry.name !== "string" || !entry.name.trim()) {
      throw new Error("item missing name");
    }
    const qty = clamp(isFiniteNumber(entry.qty) ? entry.qty : 1, 0, MAX_ITEM_QTY);
    const calories = clamp(isFiniteNumber(entry.calories) ? Math.round(entry.calories) : 0, 0, MAX_ITEM_CALORIES);
    const protein_g = clamp(isFiniteNumber(entry.protein_g) ? entry.protein_g : 0, 0, MAX_ITEM_GRAMS);
    const carbs_g = clamp(isFiniteNumber(entry.carbs_g) ? entry.carbs_g : 0, 0, MAX_ITEM_GRAMS);
    const fat_g = clamp(isFiniteNumber(entry.fat_g) ? entry.fat_g : 0, 0, MAX_ITEM_GRAMS);
    return { name: entry.name.trim(), qty, calories, protein_g, carbs_g, fat_g };
  });

  if (items.length === 0) throw new Error("no items parsed");

  // BUG-05: never trust the model's own total_calories field — a single
  // arithmetic slip produces a stored total that doesn't match the listed
  // items (and was an easy way for an unclamped hallucination to sneak a
  // huge number past the per-item clamps above). Always recompute from the
  // now-clamped items, matching parse-photo's existing behavior.
  const total_calories = items.reduce((sum, i) => sum + i.calories, 0);

  return { items, total_calories, source: "nvidia" };
}

async function callNvidiaText(
  model: string,
  text: string,
  apiKey: string,
  extraBody?: Record<string, unknown>
): Promise<ParseResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STAGE_TIMEOUT_MS);

  try {
    const res = await fetch(NVIDIA_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
        temperature: 0.2,
        ...extraBody,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`nvidia http ${res.status}`);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("no content in nvidia response");

    const parsedJson = JSON.parse(extractJsonObject(content));
    return coerceNvidiaResult(parsedJson);
  } finally {
    clearTimeout(timeout);
  }
}

// Primary -> fallback model chain (~12s budget each). Caller falls through to
// the static food table if both stages fail — never a 500, per contract.
async function parseWithNvidiaChain(text: string, apiKey: string): Promise<ParseResult> {
  const primary = primaryTextModel();
  try {
    return await callNvidiaText(primary, text, apiKey, {
      chat_template_kwargs: { thinking: false },
    });
  } catch (err) {
    console.error(`[parse-meal] primary model ${primary} failed, trying fallback:`, err);
  }
  return callNvidiaText(fallbackTextModel(), text, apiKey);
}

export async function POST(req: NextRequest) {
  let body: { text?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const rawText = typeof body.text === "string" ? body.text.trim() : "";
  if (!rawText) {
    return NextResponse.json({ error: "'text' is required" }, { status: 400 });
  }

  // BUG-02: FI comma decimals ("1,5 banana") must be normalized before the
  // text reaches EITHER path. Benchmark showed no model reliably reads
  // "1,5" as one-and-a-half regardless of thinking mode — normalization
  // must be deterministic and server-side, not delegated to the model.
  const text = normalizeDecimalCommas(rawText);

  const apiKey = process.env.NVIDIA_API_KEY;

  if (apiKey) {
    try {
      const result = await parseWithNvidiaChain(text, apiKey);
      return NextResponse.json(result);
    } catch (err) {
      // Fall through to static fallback below — API failure must never 500
      // the request per the contract.
      console.error("[parse-meal] NVIDIA chain failed, using fallback:", err);
    }
  }

  const fallback = fallbackParseMeal(text);
  return NextResponse.json(fallback);
}
