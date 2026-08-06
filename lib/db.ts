import Dexie, { Table } from "dexie";

export interface MealItem {
  name: string;
  qty: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface Meal {
  id?: number; // auto-increment primary key
  text: string; // raw text the user typed
  items: MealItem[]; // parsed items from /api/parse-meal
  total_calories: number;
  source: "nvidia" | "fallback";
  timestamp: number; // Date.now() at log time
}

export interface Setting {
  key: string; // e.g. "dailyGoal"
  value: number;
}

const DAILY_GOAL_KEY = "dailyGoal";
const DEFAULT_DAILY_GOAL = 2000;

class CalorieTrackerDB extends Dexie {
  meals!: Table<Meal, number>;
  settings!: Table<Setting, string>;

  constructor() {
    super("calorieTrackerDB");
    this.version(1).stores({
      meals: "++id, timestamp",
      settings: "key",
    });
  }
}

// Single shared instance — dexie handles connection lifecycle internally.
export const db = new CalorieTrackerDB();

/** Log a parsed meal. Returns the new meal's id. */
export async function addMeal(meal: Omit<Meal, "id">): Promise<number> {
  return db.meals.add(meal);
}

/** Delete a meal by id (used by history swipe-to-delete). */
export async function deleteMeal(id: number): Promise<void> {
  await db.meals.delete(id);
}

/** All meals, newest first. */
export async function getAllMeals(): Promise<Meal[]> {
  return db.meals.orderBy("timestamp").reverse().toArray();
}

/** Meals whose timestamp falls within [startOfDay, endOfDay) for a given Date (defaults to today). */
export async function getMealsForDay(date: Date = new Date()): Promise<Meal[]> {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return db.meals
    .where("timestamp")
    .between(start.getTime(), end.getTime(), true, false)
    .reverse()
    .sortBy("timestamp");
}

/** Sum of calories for a given day (defaults to today). */
export async function getTotalCaloriesForDay(date: Date = new Date()): Promise<number> {
  const meals = await getMealsForDay(date);
  return meals.reduce((sum, m) => sum + m.total_calories, 0);
}

/** Sum of protein (g) for a given day (defaults to today). Derived from item-level protein_g since meals don't store a rolled-up total. */
export async function getTotalProteinForDay(date: Date = new Date()): Promise<number> {
  const meals = await getMealsForDay(date);
  return mealsProtein(meals);
}

/** Sum of protein (g) across a set of meals, rounded to 1 decimal. */
export function mealsProtein(meals: Meal[]): number {
  const total = meals.reduce(
    (sum, m) => sum + m.items.reduce((s, item) => s + item.protein_g, 0),
    0
  );
  return Math.round(total * 10) / 10;
}

/** Get the user's daily calorie goal (defaults to 2000 if never set). */
export async function getDailyGoal(): Promise<number> {
  const setting = await db.settings.get(DAILY_GOAL_KEY);
  return setting?.value ?? DEFAULT_DAILY_GOAL;
}

/** Set the user's daily calorie goal. */
export async function setDailyGoal(value: number): Promise<void> {
  await db.settings.put({ key: DAILY_GOAL_KEY, value });
}
