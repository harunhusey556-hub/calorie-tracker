// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SettingsScreen from "./SettingsScreen";

vi.mock("@/lib/db", () => ({
  getDailyGoal: vi.fn().mockResolvedValue(2000),
  setDailyGoal: vi.fn().mockResolvedValue(undefined),
}));

import { getDailyGoal, setDailyGoal } from "@/lib/db";

async function renderReady() {
  render(<SettingsScreen onSaved={() => {}} />);
  await screen.findByDisplayValue("2000");
}

function setDraft(value: string) {
  const input = screen.getByLabelText(/daily goal/i, { selector: "input" }) as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  return input;
}

describe("SettingsScreen — BUG-10 goal validation, bounds, comma/space parsing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDailyGoal).mockResolvedValue(2000);
    vi.mocked(setDailyGoal).mockResolvedValue(undefined);
  });

  it.each(["", "0", "-5", "abc"])(
    "shows an inline error and does not save for invalid input %j",
    async (bad) => {
      await renderReady();
      setDraft(bad);
      fireEvent.click(screen.getByRole("button", { name: /save goal/i }));

      expect(await screen.findByRole("alert")).toBeInTheDocument();
      expect(setDailyGoal).not.toHaveBeenCalled();
    }
  );

  it("clamps an over-the-max value instead of accepting it unbounded", async () => {
    await renderReady();
    setDraft("99999999");
    fireEvent.click(screen.getByRole("button", { name: /save goal/i }));

    await waitFor(() => expect(setDailyGoal).toHaveBeenCalledWith(10000));
  });

  it("clamps a below-the-min positive value up to the floor", async () => {
    await renderReady();
    setDraft("10");
    fireEvent.click(screen.getByRole("button", { name: /save goal/i }));

    await waitFor(() => expect(setDailyGoal).toHaveBeenCalledWith(500));
  });

  it('normalizes a comma-decimal input ("1,5") before parsing', async () => {
    await renderReady();
    setDraft("1,5");
    fireEvent.click(screen.getByRole("button", { name: /save goal/i }));

    // 1.5 rounds to 1, which is below MIN_GOAL -> clamps to 500 (not the old
    // buggy parseInt("1,5") === 1 silently saved as-is).
    await waitFor(() => expect(setDailyGoal).toHaveBeenCalledWith(500));
  });

  it('normalizes a space-thousands input ("2 000") before parsing', async () => {
    await renderReady();
    setDraft("2 000");
    fireEvent.click(screen.getByRole("button", { name: /save goal/i }));

    await waitFor(() => expect(setDailyGoal).toHaveBeenCalledWith(2000));
  });

  it("saves a valid in-range value with no error", async () => {
    await renderReady();
    setDraft("1800");
    fireEvent.click(screen.getByRole("button", { name: /save goal/i }));

    await waitFor(() => expect(setDailyGoal).toHaveBeenCalledWith(1800));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
