// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import HistoryScreen from "./HistoryScreen";

vi.mock("@/lib/db", () => ({
  getAllMeals: vi.fn(),
  deleteMeal: vi.fn(),
  addMeal: vi.fn(),
  mealsProtein: vi.fn(() => 0),
}));

import { getAllMeals, deleteMeal, addMeal, type Meal } from "@/lib/db";

function meal(id: number, over: Partial<Meal> = {}): Meal {
  return {
    id,
    text: `meal-${id}`,
    items: [{ name: "food", qty: 1, calories: 100, protein_g: 5, carbs_g: 1, fat_g: 1 }],
    total_calories: 100,
    source: "nvidia",
    timestamp: Date.now(),
    ...over,
  };
}

describe("HistoryScreen — BUG-06 delete failure recovery + undo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("restores the row and shows an error when deleteMeal fails (no data loss)", async () => {
    const m = meal(1);
    vi.mocked(getAllMeals).mockResolvedValue([m]);
    vi.mocked(deleteMeal).mockRejectedValue(new Error("db closed"));

    render(<HistoryScreen refreshKey={0} />);
    await screen.findByText("meal-1");

    fireEvent.click(screen.getByTestId("delete-meal-1"));

    // Optimistic removal happens immediately...
    // ...but once deleteMeal rejects, the row must come back.
    await waitFor(() => expect(screen.getByText("meal-1")).toBeInTheDocument());
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t delete/i);

    // No undo snackbar for a delete that never actually happened.
    expect(screen.queryByText(/meal deleted/i)).not.toBeInTheDocument();
  });

  it("shows an undo snackbar after a successful delete and restores the meal on Undo", async () => {
    const m = meal(2);
    vi.mocked(getAllMeals).mockResolvedValue([m]);
    vi.mocked(deleteMeal).mockResolvedValue(undefined);
    vi.mocked(addMeal).mockResolvedValue(99);

    render(<HistoryScreen refreshKey={0} />);
    await screen.findByText("meal-2");

    fireEvent.click(screen.getByTestId("delete-meal-2"));

    await waitFor(() => expect(screen.queryByText("meal-2")).not.toBeInTheDocument());
    expect(await screen.findByRole("status")).toHaveTextContent(/meal deleted/i);

    fireEvent.click(screen.getByRole("button", { name: /undo/i }));

    await waitFor(() => expect(addMeal).toHaveBeenCalledTimes(1));
    // Re-inserted without the stale id (a new one gets assigned by addMeal).
    expect(addMeal).toHaveBeenCalledWith(expect.not.objectContaining({ id: expect.anything() }));
    await screen.findByText("meal-2");
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });

  it(
    "auto-dismisses the undo snackbar after the undo window elapses",
    async () => {
      // Real timers throughout: framer-motion's exit animation runs on a
      // real requestAnimationFrame loop, which doesn't advance correctly
      // when Date/setTimeout are faked underneath it (verified: the exit
      // animation stalls mid-fade if fake timers are used here).
      const m = meal(3);
      vi.mocked(getAllMeals).mockResolvedValue([m]);
      vi.mocked(deleteMeal).mockResolvedValue(undefined);

      render(<HistoryScreen refreshKey={0} />);
      await screen.findByText("meal-3");

      fireEvent.click(screen.getByTestId("delete-meal-3"));
      await screen.findByRole("status");

      await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument(), {
        timeout: 6500,
      });
    },
    7000
  );
});
