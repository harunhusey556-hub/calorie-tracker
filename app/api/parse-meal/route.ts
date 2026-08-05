import { NextRequest, NextResponse } from "next/server";
import { fallbackParseMeal, ParseResult } from "@/lib/fallbackParse";

export const runtime = "nodejs";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

const SYSTEM_PROMPT = `You are a nutrition parser. Given a free-text description of a meal, break it into
distinct food items and estimate calories/macros per item using typical serving sizes.
Respond with ONLY valid JSON (no markdown, no commentary) matching exactly this shape:
{"items":[{"name":"string","qty":number,"calories":number,"protein_g":number,"carbs_g":number,"fat_g":number}],"total_calories":number}
"qty" is the count of that item (default 1). "total_calories" is the sum of all items' calories, rounded to an integer.
All numeric fields are numbers, not strings. Keep item names short and singular (e.g. "egg" not "eggs").`;

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

// Validate + coerce the model's JSON into our strict shape. Throws on anything
// that doesn't look like real parsed data so the caller falls back safely.
function coerceGroqResult(raw: unknown): ParseResult {
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

  if (items.length === 0) throw new Error("no items parsed");

  const total_calories = isFiniteNumber(obj.total_calories)
    ? Math.round(obj.total_calories)
    : items.reduce((sum, i) => sum + i.calories, 0);

  return { items, total_calories, source: "groq" };
}

async function parseWithGroq(text: string, apiKey: string): Promise<ParseResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text },
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

  const apiKey = process.env.GROQ_API_KEY;

  if (apiKey) {
    try {
      const result = await parseWithGroq(text, apiKey);
      return NextResponse.json(result);
    } catch (err) {
      // Fall through to static fallback below — API failure must never 500
      // the request per the contract.
      console.error("[parse-meal] Groq call failed, using fallback:", err);
    }
  }

  const fallback = fallbackParseMeal(text);
  return NextResponse.json(fallback);
}
