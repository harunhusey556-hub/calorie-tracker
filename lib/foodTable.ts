// Static fallback calorie/macro table — used when GROQ_API_KEY is missing or the
// Groq call fails. Values are per typical single serving (not per 100g) so the
// fallback matcher can return numbers directly without unit conversion.
// Sources: USDA FoodData Central averages, rounded for simplicity.

export interface FoodEntry {
  name: string;
  aliases: string[];
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  unit: string; // human label for the default serving, e.g. "1 medium", "1 cup"
}

export const FOOD_TABLE: FoodEntry[] = [
  { name: "egg", aliases: ["eggs", "boiled egg", "fried egg"], calories: 70, protein_g: 6, carbs_g: 0.5, fat_g: 5, unit: "1 large" },
  { name: "toast", aliases: ["bread", "slice of bread", "white toast"], calories: 75, protein_g: 2, carbs_g: 13, fat_g: 1, unit: "1 slice" },
  { name: "coffee with milk", aliases: ["coffee", "latte", "milk coffee"], calories: 40, protein_g: 2, carbs_g: 4, fat_g: 2, unit: "1 cup" },
  { name: "black coffee", aliases: ["espresso", "americano"], calories: 2, protein_g: 0, carbs_g: 0, fat_g: 0, unit: "1 cup" },
  { name: "banana", aliases: ["bananas"], calories: 105, protein_g: 1.3, carbs_g: 27, fat_g: 0.4, unit: "1 medium" },
  { name: "apple", aliases: ["apples"], calories: 95, protein_g: 0.5, carbs_g: 25, fat_g: 0.3, unit: "1 medium" },
  { name: "orange", aliases: ["oranges"], calories: 62, protein_g: 1.2, carbs_g: 15, fat_g: 0.2, unit: "1 medium" },
  { name: "rice", aliases: ["white rice", "cooked rice", "steamed rice"], calories: 205, protein_g: 4.3, carbs_g: 45, fat_g: 0.4, unit: "1 cup cooked" },
  { name: "brown rice", aliases: ["cooked brown rice"], calories: 216, protein_g: 5, carbs_g: 45, fat_g: 1.8, unit: "1 cup cooked" },
  { name: "chicken breast", aliases: ["grilled chicken", "chicken", "chicken breast fillet"], calories: 165, protein_g: 31, carbs_g: 0, fat_g: 3.6, unit: "100g" },
  { name: "chicken thigh", aliases: ["chicken thighs"], calories: 209, protein_g: 26, carbs_g: 0, fat_g: 11, unit: "100g" },
  { name: "salmon", aliases: ["grilled salmon", "baked salmon"], calories: 208, protein_g: 20, carbs_g: 0, fat_g: 13, unit: "100g" },
  { name: "tuna", aliases: ["canned tuna", "tuna can"], calories: 132, protein_g: 29, carbs_g: 0, fat_g: 1, unit: "100g" },
  { name: "beef", aliases: ["ground beef", "steak", "beef steak"], calories: 250, protein_g: 26, carbs_g: 0, fat_g: 15, unit: "100g" },
  { name: "pork", aliases: ["pork chop"], calories: 242, protein_g: 27, carbs_g: 0, fat_g: 14, unit: "100g" },
  { name: "bacon", aliases: ["bacon strip", "bacon strips"], calories: 43, protein_g: 3, carbs_g: 0.1, fat_g: 3.3, unit: "1 strip" },
  { name: "sausage", aliases: ["sausages"], calories: 150, protein_g: 6, carbs_g: 2, fat_g: 13, unit: "1 link" },
  { name: "pasta", aliases: ["spaghetti", "cooked pasta"], calories: 220, protein_g: 8, carbs_g: 43, fat_g: 1.3, unit: "1 cup cooked" },
  { name: "bread roll", aliases: ["bun", "dinner roll"], calories: 120, protein_g: 4, carbs_g: 22, fat_g: 2, unit: "1 roll" },
  { name: "bagel", aliases: ["bagels"], calories: 250, protein_g: 10, carbs_g: 48, fat_g: 1.5, unit: "1 medium" },
  { name: "oatmeal", aliases: ["porridge", "oats", "cooked oats"], calories: 158, protein_g: 6, carbs_g: 27, fat_g: 3.2, unit: "1 cup cooked" },
  { name: "cereal", aliases: ["breakfast cereal", "cornflakes"], calories: 110, protein_g: 2, carbs_g: 24, fat_g: 0.5, unit: "1 cup" },
  { name: "milk", aliases: ["glass of milk", "whole milk"], calories: 150, protein_g: 8, carbs_g: 12, fat_g: 8, unit: "1 cup" },
  { name: "yogurt", aliases: ["yoghurt", "greek yogurt"], calories: 100, protein_g: 10, carbs_g: 6, fat_g: 3.5, unit: "170g cup" },
  { name: "cheese", aliases: ["cheddar", "cheese slice"], calories: 113, protein_g: 7, carbs_g: 1, fat_g: 9, unit: "1 slice" },
  { name: "butter", aliases: ["butter pat"], calories: 102, protein_g: 0.1, carbs_g: 0, fat_g: 11.5, unit: "1 tbsp" },
  { name: "olive oil", aliases: ["cooking oil", "oil"], calories: 119, protein_g: 0, carbs_g: 0, fat_g: 13.5, unit: "1 tbsp" },
  { name: "avocado", aliases: ["avocados"], calories: 240, protein_g: 3, carbs_g: 13, fat_g: 22, unit: "1 medium" },
  { name: "almonds", aliases: ["almond"], calories: 164, protein_g: 6, carbs_g: 6, fat_g: 14, unit: "28g (~23 nuts)" },
  { name: "peanut butter", aliases: ["pb"], calories: 94, protein_g: 4, carbs_g: 3, fat_g: 8, unit: "1 tbsp" },
  { name: "salad", aliases: ["green salad", "side salad"], calories: 20, protein_g: 1, carbs_g: 4, fat_g: 0.2, unit: "1 cup" },
  { name: "broccoli", aliases: ["steamed broccoli"], calories: 55, protein_g: 4, carbs_g: 11, fat_g: 0.6, unit: "1 cup cooked" },
  { name: "carrot", aliases: ["carrots"], calories: 25, protein_g: 0.6, carbs_g: 6, fat_g: 0.1, unit: "1 medium" },
  { name: "potato", aliases: ["baked potato", "boiled potato"], calories: 161, protein_g: 4.3, carbs_g: 37, fat_g: 0.2, unit: "1 medium" },
  { name: "french fries", aliases: ["fries", "chips"], calories: 365, protein_g: 4, carbs_g: 48, fat_g: 17, unit: "medium serving" },
  { name: "pizza", aliases: ["pizza slice", "slice of pizza"], calories: 285, protein_g: 12, carbs_g: 36, fat_g: 10, unit: "1 slice" },
  { name: "burger", aliases: ["hamburger", "cheeseburger"], calories: 354, protein_g: 20, carbs_g: 30, fat_g: 17, unit: "1 sandwich" },
  { name: "hot dog", aliases: ["hotdog"], calories: 290, protein_g: 10, carbs_g: 22, fat_g: 18, unit: "1 with bun" },
  { name: "sandwich", aliases: ["sub", "deli sandwich"], calories: 300, protein_g: 15, carbs_g: 35, fat_g: 10, unit: "1 sandwich" },
  { name: "soup", aliases: ["chicken soup", "vegetable soup"], calories: 120, protein_g: 6, carbs_g: 15, fat_g: 4, unit: "1 cup" },
  { name: "beans", aliases: ["black beans", "kidney beans"], calories: 227, protein_g: 15, carbs_g: 40, fat_g: 0.9, unit: "1 cup cooked" },
  { name: "lentils", aliases: ["lentil soup", "cooked lentils"], calories: 230, protein_g: 18, carbs_g: 40, fat_g: 0.8, unit: "1 cup cooked" },
  { name: "tofu", aliases: ["tofu block"], calories: 94, protein_g: 10, carbs_g: 2.3, fat_g: 5.3, unit: "100g" },
  { name: "chocolate", aliases: ["chocolate bar"], calories: 150, protein_g: 2, carbs_g: 17, fat_g: 8.5, unit: "1 small bar (~30g)" },
  { name: "cookie", aliases: ["cookies", "biscuit"], calories: 78, protein_g: 1, carbs_g: 10, fat_g: 3.7, unit: "1 cookie" },
  { name: "cake", aliases: ["slice of cake"], calories: 235, protein_g: 3, carbs_g: 35, fat_g: 10, unit: "1 slice" },
  { name: "ice cream", aliases: ["icecream"], calories: 137, protein_g: 2.3, carbs_g: 16, fat_g: 7.3, unit: "1/2 cup" },
  { name: "orange juice", aliases: ["oj", "juice"], calories: 110, protein_g: 2, carbs_g: 26, fat_g: 0.5, unit: "1 cup" },
  { name: "soda", aliases: ["cola", "soft drink", "coke"], calories: 140, protein_g: 0, carbs_g: 39, fat_g: 0, unit: "1 can (330ml)" },
  { name: "beer", aliases: ["can of beer"], calories: 153, protein_g: 1.6, carbs_g: 13, fat_g: 0, unit: "1 can (355ml)" },
  { name: "wine", aliases: ["glass of wine", "red wine"], calories: 125, protein_g: 0.1, carbs_g: 4, fat_g: 0, unit: "1 glass (150ml)" },
];

/**
 * Very small best-effort matcher: lowercases + strips punctuation, then looks
 * for a table entry whose name/alias is contained in (or contains) the query
 * token. Not a tokenizer/NLP pass — the Groq path handles real parsing; this
 * is only the safety net when AI parsing is unavailable.
 */
export function findFoodMatch(query: string): FoodEntry | null {
  const q = query.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  if (!q) return null;

  for (const entry of FOOD_TABLE) {
    if (q === entry.name || q.includes(entry.name) || entry.name.includes(q)) {
      return entry;
    }
    for (const alias of entry.aliases) {
      if (q === alias || q.includes(alias) || alias.includes(q)) {
        return entry;
      }
    }
  }
  return null;
}
