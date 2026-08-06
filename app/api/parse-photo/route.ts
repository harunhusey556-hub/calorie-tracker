import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

// MODEL SWITCH (Doctor, 2026-08-06, live benchmark: model-benchmark-20260806.md).
// Old model meta/llama-3.2-90b-vision-instruct measured a 30s timeout —
// vision feature always fell back. New chain: fast nemotron vision primary
// (0.73s) -> old model demoted to fallback -> manual-entry CTA. Read lazily
// (not module-level consts) so env changes take effect without a cold
// restart and tests can override per-case.
function primaryVisionModel(): string {
  return process.env.NVIDIA_MODEL_VISION || "nvidia/nemotron-nano-12b-v2-vl";
}
function fallbackVisionModel(): string {
  return process.env.NVIDIA_MODEL_VISION_FALLBACK || "meta/llama-3.2-90b-vision-instruct";
}
// Per-stage budget, not total — primary+fallback can take up to ~24s worst
// case. Overridable so tests can exercise the timeout path in milliseconds
// instead of juggling fake timers around Next's multipart body parsing.
function stageTimeoutMs(): number {
  const override = Number(process.env.NVIDIA_STAGE_TIMEOUT_MS);
  return Number.isFinite(override) && override > 0 ? override : 12_000;
}

const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8MB — client resizes to ~1024px per contract, this is a safety cap
const ACCEPTED_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

const SYSTEM_PROMPT = `You are a nutrition parser looking at a photo of food on a plate. For each item,
judge its actual weight in grams from visual cues (plate ~26-28cm, utensil size, portion
coverage/height) — do NOT default to a generic textbook 100g/single-serving number; scale up for
portions bigger than a normal serving. Compute calories/macros for the weight you actually see.
Respond with ONLY valid JSON (no markdown, no commentary) matching exactly this shape:
{"items":[{"name":"string","qty":number,"calories":number,"protein_g":number,"carbs_g":number,"fat_g":number}],"total_calories":number}
"qty" is the count of discrete units (e.g. 3 eggs, 4 fries) — default to 1 for anything continuous
(rice, a chicken breast, a scoop of potatoes) and bake the estimated weight into calories instead
of inflating qty. "total_calories" is the sum of all items' calories, rounded to an integer.
All numeric fields are numbers, not strings. Keep item names short and singular (e.g. "egg" not "eggs").
If you cannot identify any food in the image, respond with {"items":[],"total_calories":0}.`;

export interface PhotoParsedItem {
  name: string;
  qty: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface PhotoParseResult {
  items: PhotoParsedItem[];
  total_calories: number;
  source: "nvidia-vision" | "fallback";
}

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

// BUG-05: model JSON was trusted unclamped — same gap as parse-meal. Clamp
// to a generously sane per-item range.
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

// Generic "couldn't identify" item per contract — never a dead end, UI drops
// straight into manual text entry.
function fallbackPhotoResult(): PhotoParseResult {
  return {
    items: [
      {
        name: "unidentified food (add manually)",
        qty: 1,
        calories: 0,
        protein_g: 0,
        carbs_g: 0,
        fat_g: 0,
      },
    ],
    total_calories: 0,
    source: "fallback",
  };
}

// Validate + coerce the model's JSON into our strict shape. Throws on anything
// that doesn't look like real parsed data so the caller falls back safely.
function coerceNvidiaResult(raw: unknown): { items: PhotoParsedItem[]; total_calories: number } {
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

  // BUG-05: total_calories always recomputed from (clamped) items — never
  // trust the model's own total field. finalizeNvidiaResult below also
  // recomputes, kept here too so this function's contract is self-consistent.
  const total_calories = items.reduce((sum, i) => sum + i.calories, 0);

  return { items, total_calories };
}

async function callNvidiaVision(
  model: string,
  dataUrl: string,
  apiKey: string,
  notes: string
): Promise<{ items: PhotoParsedItem[]; total_calories: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), stageTimeoutMs());

  const promptText = notes
    ? `${SYSTEM_PROMPT}\n\nThe user gave this exact context — trust it over your own guess where it conflicts with what you see (correcting an ingredient, naming a packaged product, etc). If they state a weight (e.g. "200g chicken breast"), that weight is ALREADY EXACT — don't apply any "scale up, don't lowball" bias on top of it, just use standard nutrition density for that food and multiply by the stated grams (e.g. cooked chicken breast ≈150-165 kcal/100g, cooked pasta ≈130-160 kcal/100g, rice ≈130 kcal/100g cooked, sauces vary but rarely exceed 150-250 kcal/100g unless it's pure oil/cream). Set "qty" to 1 for that item since the weight is already baked into the numbers: "${notes}"`
    : SYSTEM_PROMPT;

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
          {
            role: "user",
            content: [
              { type: "text", text: promptText },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        temperature: 0.2,
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

// Primary -> fallback vision model chain (~12s budget each, MODEL SWITCH
// directive). Superseded the old same-model-retry: the old model
// (llama-3.2-90b-vision) is far slower (30s+) so retrying it never helped;
// now every failure (timeout or error) moves to a genuinely different,
// faster model instead of hammering the same one twice. Caller falls
// through to the manual-entry CTA if both stages fail — never a dead end.
async function parsePhotoWithNvidia(dataUrl: string, apiKey: string, notes: string): Promise<PhotoParseResult> {
  const primary = primaryVisionModel();
  try {
    const result = await callNvidiaVision(primary, dataUrl, apiKey, notes);
    return finalizeNvidiaResult(result);
  } catch (err) {
    console.error(`[parse-photo] primary model ${primary} failed, trying fallback:`, err);
  }

  const result = await callNvidiaVision(fallbackVisionModel(), dataUrl, apiKey, notes);
  return finalizeNvidiaResult(result);
}

function finalizeNvidiaResult(result: { items: PhotoParsedItem[]; total_calories: number }): PhotoParseResult {
  if (result.items.length === 0) {
    // Model ran fine but saw no food — same "couldn't identify" UX as a hard failure.
    return fallbackPhotoResult();
  }
  // Trust the model's own calorie/macro estimate directly — it already saw
  // the actual portion in the photo (and any gram amounts in user notes).
  // A prior version re-priced matches against the static FOOD_TABLE, which
  // only stores one fixed default serving per food (e.g. "chicken breast"
  // = 165 kcal/100g) and silently overwrote a real 200g/400g estimate with
  // that single fixed value, undercounting badly for any portion that
  // wasn't exactly the table's default size.
  const items = result.items;
  const total_calories = items.reduce((sum, i) => sum + i.calories, 0);
  return { items, total_calories, source: "nvidia-vision" };
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid multipart/form-data body" }, { status: 400 });
  }

  const photo = form.get("photo");
  if (!(photo instanceof File)) {
    return NextResponse.json({ error: "'photo' file field is required" }, { status: 400 });
  }
  if (photo.size === 0) {
    return NextResponse.json({ error: "'photo' file is empty" }, { status: 400 });
  }
  if (photo.size > MAX_PHOTO_BYTES) {
    return NextResponse.json({ error: "'photo' exceeds max size (8MB)" }, { status: 400 });
  }
  const mimeType = photo.type || "image/jpeg";
  if (!ACCEPTED_MIME.has(mimeType)) {
    return NextResponse.json({ error: `unsupported image type '${mimeType}'` }, { status: 400 });
  }

  // Optional free-text hint from the user — e.g. correcting an ingredient
  // the model tends to misread ("that's mustard, not cheese") or adding
  // portion info the photo alone can't convey.
  const notesRaw = form.get("notes");
  const notes = typeof notesRaw === "string" ? notesRaw.trim().slice(0, 300) : "";

  const apiKey = process.env.NVIDIA_API_KEY;

  if (apiKey) {
    try {
      const buffer = Buffer.from(await photo.arrayBuffer());
      const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
      const result = await parsePhotoWithNvidia(dataUrl, apiKey, notes);
      return NextResponse.json(result);
    } catch (err) {
      // Vision call failure (both attempts) must never 500 the request — fall
      // through to the generic fallback below per contract.
      console.error("[parse-photo] NVIDIA vision call failed, using fallback:", err);
    }
  }

  return NextResponse.json(fallbackPhotoResult());
}
