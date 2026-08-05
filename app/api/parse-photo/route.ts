import { NextRequest, NextResponse } from "next/server";
import { findFoodMatch } from "@/lib/foodTable";

export const runtime = "nodejs";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL_PRIMARY = "llama-3.2-90b-vision-preview";
const GROQ_MODEL_FALLBACK = "llama-3.2-11b-vision-preview";

const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8MB — client resizes to ~1024px per contract, this is a safety cap
const ACCEPTED_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

const SYSTEM_PROMPT = `You are a nutrition parser looking at a photo of food. Identify each distinct
food item visible and estimate a realistic portion + calories/macros for a typical serving of what you see.
Respond with ONLY valid JSON (no markdown, no commentary) matching exactly this shape:
{"items":[{"name":"string","qty":number,"calories":number,"protein_g":number,"carbs_g":number,"fat_g":number}],"total_calories":number}
"qty" is the count of that item (default 1). "total_calories" is the sum of all items' calories, rounded to an integer.
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
  source: "groq-vision" | "fallback";
}

interface GroqItem {
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
function coerceGroqResult(raw: unknown): { items: PhotoParsedItem[]; total_calories: number } {
  if (!raw || typeof raw !== "object") throw new Error("not an object");
  const obj = raw as { items?: unknown; total_calories?: unknown };
  if (!Array.isArray(obj.items)) throw new Error("items missing");

  const items = obj.items.map((entry: GroqItem) => {
    if (typeof entry.name !== "string" || !entry.name.trim()) {
      throw new Error("item missing name");
    }
    const qty = isFiniteNumber(entry.qty) ? entry.qty : 1;
    const calories = isFiniteNumber(entry.calories) ? Math.round(entry.calories) : 0;
    const protein_g = isFiniteNumber(entry.protein_g) ? entry.protein_g : 0;
    const carbs_g = isFiniteNumber(entry.carbs_g) ? entry.carbs_g : 0;
    const fat_g = isFiniteNumber(entry.fat_g) ? entry.fat_g : 0;
    return { name: entry.name.trim(), qty, calories, protein_g, carbs_g, fat_g };
  });

  const total_calories = isFiniteNumber(obj.total_calories)
    ? Math.round(obj.total_calories)
    : items.reduce((sum, i) => sum + i.calories, 0);

  return { items, total_calories };
}

// Re-price model-estimated items against the static food table where a match
// exists, same as the text-parse route trusts the local table over an AI
// guess whenever we have real data for that food.
function refineWithFoodTable(items: PhotoParsedItem[]): PhotoParsedItem[] {
  return items.map((item) => {
    const match = findFoodMatch(item.name);
    if (!match) return item;
    return {
      name: match.name,
      qty: item.qty,
      calories: Math.round(match.calories * item.qty),
      protein_g: Math.round(match.protein_g * item.qty * 10) / 10,
      carbs_g: Math.round(match.carbs_g * item.qty * 10) / 10,
      fat_g: Math.round(match.fat_g * item.qty * 10) / 10,
    };
  });
}

async function callGroqVision(
  model: string,
  dataUrl: string,
  apiKey: string
): Promise<{ items: PhotoParsedItem[]; total_calories: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(GROQ_URL, {
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
              { type: "text", text: SYSTEM_PROMPT },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        temperature: 0.2,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`groq http ${res.status}`);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("no content in groq response");

    const parsedJson = JSON.parse(content);
    return coerceGroqResult(parsedJson);
  } finally {
    clearTimeout(timeout);
  }
}

async function parsePhotoWithGroq(dataUrl: string, apiKey: string): Promise<PhotoParseResult> {
  try {
    const result = await callGroqVision(GROQ_MODEL_PRIMARY, dataUrl, apiKey);
    return finalizeGroqResult(result);
  } catch (err) {
    console.error(`[parse-photo] ${GROQ_MODEL_PRIMARY} failed, trying fallback model:`, err);
  }

  const result = await callGroqVision(GROQ_MODEL_FALLBACK, dataUrl, apiKey);
  return finalizeGroqResult(result);
}

function finalizeGroqResult(result: { items: PhotoParsedItem[]; total_calories: number }): PhotoParseResult {
  if (result.items.length === 0) {
    // Model ran fine but saw no food — same "couldn't identify" UX as a hard failure.
    return fallbackPhotoResult();
  }
  const items = refineWithFoodTable(result.items);
  const total_calories = items.reduce((sum, i) => sum + i.calories, 0);
  return { items, total_calories, source: "groq-vision" };
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

  const apiKey = process.env.GROQ_API_KEY;

  if (apiKey) {
    try {
      const buffer = Buffer.from(await photo.arrayBuffer());
      const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
      const result = await parsePhotoWithGroq(dataUrl, apiKey);
      return NextResponse.json(result);
    } catch (err) {
      // Vision call failure (both models) must never 500 the request — fall
      // through to the generic fallback below per contract.
      console.error("[parse-photo] Groq vision call failed, using fallback:", err);
    }
  }

  return NextResponse.json(fallbackPhotoResult());
}
