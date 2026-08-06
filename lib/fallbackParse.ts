import { findFoodMatch } from "./foodTable";

export interface ParsedItem {
  name: string;
  qty: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface ParseResult {
  items: ParsedItem[];
  total_calories: number;
  source: "nvidia" | "fallback";
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  a: 1, an: 1, couple: 2,
};

// FI locale uses comma as the decimal separator ("1,5" = one and a half),
// while the same comma is also our list separator ("eggs, toast"). Disambiguate
// by normalizing only a comma directly between two digits (no space) to a dot
// BEFORE splitting on commas — "1,5 banana" -> "1.5 banana" (kept as one
// segment), but "2 eggs, toast" is untouched (comma followed by a space/letter,
// not a digit) and still splits into two segments. BUG-02.
function normalizeDecimalCommas(text: string): string {
  return text.replace(/(\d),(\d)/g, "$1.$2");
}

// Split "2 eggs, toast and coffee with milk" into ["2 eggs", "toast", "coffee with milk"].
function splitSegments(text: string): string[] {
  return normalizeDecimalCommas(text)
    .split(/,| and |\+|\n/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Pull a leading quantity ("2 eggs" -> qty 2, rest "eggs"); defaults to 1.
function extractQty(segment: string): { qty: number; rest: string } {
  const trimmed = segment.trim();
  const numMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*x?\s*(.*)$/i);
  if (numMatch) {
    return { qty: parseFloat(numMatch[1]), rest: numMatch[2].trim() };
  }
  const wordMatch = trimmed.match(/^([a-z]+)\s+(.*)$/i);
  if (wordMatch && NUMBER_WORDS[wordMatch[1].toLowerCase()] !== undefined) {
    return { qty: NUMBER_WORDS[wordMatch[1].toLowerCase()], rest: wordMatch[2].trim() };
  }
  return { qty: 1, rest: trimmed };
}

/**
 * Best-effort local parse used when NVIDIA is unavailable (no key / API error /
 * rate limit). Splits the free-text meal description into segments, extracts
 * a quantity per segment, and matches each remaining phrase against the
 * static food table. Unmatched segments are dropped (not guessed) to avoid
 * returning fabricated calorie numbers.
 */
export function fallbackParseMeal(text: string): ParseResult {
  const segments = splitSegments(text);
  const items: ParsedItem[] = [];

  for (const segment of segments) {
    const { qty, rest } = extractQty(segment);
    const match = findFoodMatch(rest || segment);
    if (!match) continue;
    items.push({
      name: match.name,
      qty,
      calories: Math.round(match.calories * qty),
      protein_g: Math.round(match.protein_g * qty * 10) / 10,
      carbs_g: Math.round(match.carbs_g * qty * 10) / 10,
      fat_g: Math.round(match.fat_g * qty * 10) / 10,
    });
  }

  const total_calories = items.reduce((sum, i) => sum + i.calories, 0);
  return { items, total_calories, source: "fallback" };
}
