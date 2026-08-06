import { NextRequest, NextResponse } from "next/server";
import { fallbackParseMeal, ParseResult } from "@/lib/fallbackParse";

export const runtime = "nodejs";

const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const NVIDIA_MODEL = "meta/llama-3.3-70b-instruct";

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
    const qty = isFiniteNumber(entry.qty) ? entry.qty : 1;
    const calories = isFiniteNumber(entry.calories) ? Math.round(entry.calories) : 0;
    const protein_g = isFiniteNumber(entry.protein_g) ? entry.protein_g : 0;
    const carbs_g = isFiniteNumber(entry.carbs_g) ? entry.carbs_g : 0;
    const fat_g = isFiniteNumber(entry.fat_g) ? entry.fat_g : 0;
    return { name: entry.name.trim(), qty, calories, protein_g, carbs_g, fat_g };
  });

  if (items.length === 0) throw new Error("no items parsed");

  const total_calories = isFiniteNumber(obj.total_calories)
    ? Math.round(obj.total_calories)
    : items.reduce((sum, i) => sum + i.calories, 0);

  return { items, total_calories, source: "nvidia" };
}

async function parseWithNvidia(text: string, apiKey: string): Promise<ParseResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const res = await fetch(NVIDIA_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: NVIDIA_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text },
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

export async function POST(req: NextRequest) {
  let body: { text?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "'text' is required" }, { status: 400 });
  }

  const apiKey = process.env.NVIDIA_API_KEY;

  if (apiKey) {
    try {
      const result = await parseWithNvidia(text, apiKey);
      return NextResponse.json(result);
    } catch (err) {
      // Fall through to static fallback below — API failure must never 500
      // the request per the contract.
      console.error("[parse-meal] NVIDIA call failed, using fallback:", err);
    }
  }

  const fallback = fallbackParseMeal(text);
  return NextResponse.json(fallback);
}
