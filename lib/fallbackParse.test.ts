import { describe, expect, it } from "vitest";
import { fallbackParseMeal } from "./fallbackParse";

describe("fallbackParseMeal — BUG-02 comma-decimal quantities (FI locale)", () => {
  it('parses "1,5 banana" as one item with qty 1.5, not two items', () => {
    const result = fallbackParseMeal("1,5 banana");

    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe("banana");
    expect(result.items[0].qty).toBe(1.5);
    expect(result.items[0].calories).toBe(Math.round(105 * 1.5)); // 158, not 5x105=525
  });

  it('parses "0,5 apple" as qty 0.5, not a dropped "0" segment + a bogus "5 apple"', () => {
    const result = fallbackParseMeal("0,5 apple");

    expect(result.items).toHaveLength(1);
    expect(result.items[0].qty).toBe(0.5);
    expect(result.items[0].calories).toBe(Math.round(95 * 0.5));
  });

  it('comma-decimal qty works inside a multi-item list ("1,5 banana and 2 eggs")', () => {
    const result = fallbackParseMeal("1,5 banana and 2 eggs");

    expect(result.items).toHaveLength(2);
    const banana = result.items.find((i) => i.name === "banana");
    const egg = result.items.find((i) => i.name === "egg");
    expect(banana?.qty).toBe(1.5);
    expect(egg?.qty).toBe(2);
  });

  it("does not break plain comma-separated item lists (list comma stays a separator)", () => {
    const result = fallbackParseMeal("2 eggs, toast and coffee with milk");

    expect(result.items).toHaveLength(3);
    expect(result.items.map((i) => i.name).sort()).toEqual(
      ["coffee with milk", "egg", "toast"].sort()
    );
  });

  it('dot-decimal qty still works ("1.5 banana")', () => {
    const result = fallbackParseMeal("1.5 banana");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].qty).toBe(1.5);
  });
});

describe("fallbackParseMeal — regression baseline (existing behavior, not part of BUG-02)", () => {
  it("defaults qty to 1 when no leading number", () => {
    const result = fallbackParseMeal("banana");
    expect(result.items[0].qty).toBe(1);
  });

  it("parses number words", () => {
    const result = fallbackParseMeal("two eggs");
    expect(result.items[0].qty).toBe(2);
  });

  it("drops unmatched/unknown foods instead of fabricating them", () => {
    const result = fallbackParseMeal("2 eggs and quinoa bowl");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe("egg");
  });

  it("returns empty items + zero total for fully unmatched text", () => {
    const result = fallbackParseMeal("xyzzy nonsense food");
    expect(result.items).toEqual([]);
    expect(result.total_calories).toBe(0);
  });

  it("sums total_calories from item calories", () => {
    const result = fallbackParseMeal("2 eggs and 1 banana");
    const expectedTotal = result.items.reduce((s, i) => s + i.calories, 0);
    expect(result.total_calories).toBe(expectedTotal);
  });

  it('tags source as "fallback"', () => {
    const result = fallbackParseMeal("banana");
    expect(result.source).toBe("fallback");
  });
});
