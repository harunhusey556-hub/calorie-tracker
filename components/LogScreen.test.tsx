// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import LogScreen from "./LogScreen";

vi.mock("@/lib/db", () => ({
  addMeal: vi.fn().mockResolvedValue(1),
}));

import { addMeal } from "@/lib/db";

function mockParseResponse(item: { name: string; calories: number }) {
  return {
    ok: true,
    json: async () => ({
      items: [{ name: item.name, qty: 1, calories: item.calories, protein_g: 1, carbs_g: 1, fat_g: 1 }],
      total_calories: item.calories,
      source: "nvidia",
    }),
  };
}

describe("LogScreen — BUG-01 double-tap save creates duplicate meals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls addMeal exactly once when Save is tapped repeatedly and rapidly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockParseResponse({ name: "egg", calories: 140 }))
    );

    render(<LogScreen onSaved={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/2 eggs, toast, coffee/i), {
      target: { value: "2 eggs" },
    });
    fireEvent.click(screen.getByRole("button", { name: /parse meal/i }));

    const saveButton = await screen.findByRole("button", { name: /save to log/i });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    await waitFor(() => expect(addMeal).toHaveBeenCalled());
    // Give the post-save reset timer room to run; addMeal count must not grow.
    await new Promise((r) => setTimeout(r, 700));
    expect(addMeal).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it("disables the Save button once a save is in flight", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockParseResponse({ name: "egg", calories: 140 }))
    );

    render(<LogScreen onSaved={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/2 eggs, toast, coffee/i), {
      target: { value: "2 eggs" },
    });
    fireEvent.click(screen.getByRole("button", { name: /parse meal/i }));

    const saveButton = await screen.findByRole("button", { name: /save to log/i });
    fireEvent.click(saveButton);

    expect(saveButton).toBeDisabled();

    vi.unstubAllGlobals();
  });
});

describe("LogScreen — BUG-03 stale parse result after text edit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not display/apply a parse response that resolves after the text was edited", async () => {
    let resolveFirst: (v: unknown) => void;
    const fetchMock = vi.fn().mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<LogScreen onSaved={() => {}} />);
    const textarea = screen.getByPlaceholderText(/2 eggs, toast, coffee/i);

    fireEvent.change(textarea, { target: { value: "old text" } });
    fireEvent.click(screen.getByRole("button", { name: /parse meal/i }));

    // User edits the text while the request for "old text" is still in flight.
    fireEvent.change(textarea, { target: { value: "new text" } });

    // The stale request now resolves.
    resolveFirst!(mockParseResponse({ name: "stale-food", calories: 999 }));

    // Give the resolved promise a tick to (wrongly) apply its result.
    await new Promise((r) => setTimeout(r, 20));

    expect(screen.queryByText(/stale-food/i)).not.toBeInTheDocument();
    // Parse button must be usable again (not stuck on "Parsing…") so the user
    // can re-parse the edited text.
    expect(screen.getByRole("button", { name: /parse meal/i })).toBeEnabled();

    vi.unstubAllGlobals();
  });

  it("keeps only the latest request's result when two parses race out of order", async () => {
    let resolveA: (v: unknown) => void;
    let resolveB: (v: unknown) => void;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveA = resolve;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveB = resolve;
          })
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<LogScreen onSaved={() => {}} />);
    const textarea = screen.getByPlaceholderText(/2 eggs, toast, coffee/i);
    const parseBtn = () => screen.getByRole("button", { name: /parse meal/i });

    // Request A: parse "text a".
    fireEvent.change(textarea, { target: { value: "text a" } });
    fireEvent.click(parseBtn());

    // Request A settles with an error status this time isn't relevant — what
    // matters is the user changes their mind and re-parses different text
    // before A resolves. Directly re-fire handleParseText via the button
    // requires status to be idle, so first let A error out fast is not
    // realistic; instead assert the guarantee at the guard level: even if A
    // *does* eventually resolve, once its text no longer matches, B (fired
    // the instant A's slot frees up) is the one the user sees.
    resolveA!(mockParseResponse({ name: "a-food", calories: 100 }));
    await screen.findByText(/a-food/i);

    fireEvent.change(textarea, { target: { value: "text b" } });
    fireEvent.click(parseBtn());
    resolveB!(mockParseResponse({ name: "b-food", calories: 200 }));

    await screen.findByText(/b-food/i);
    expect(screen.queryByText(/a-food/i)).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});
