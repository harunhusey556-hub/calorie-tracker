import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

// R2 hardening (2026-08-06): MODEL SWITCH directive (primary/fallback/static
// chain, ~12s per-stage timeout, chat_template_kwargs thinking:false, env
// override) + BUG-05 (unclamped model output) + BUG-02 (comma-decimal must
// be normalized before the text reaches the model, not just the fallback
// parser). RED-before-fix per QUALITY-PLAYBOOK — every test here fails
// against the pre-R2 single-model route.ts (llama-3.3-70b-instruct only,
// no chain, no clamp, no pre-model normalization).

function req(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/parse-meal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function nvidiaOk(content: string) {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  };
}

function abortableNeverResolves() {
  return (_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("aborted", "AbortError"));
      });
    });
}

beforeEach(() => {
  process.env.NVIDIA_API_KEY = "test-key";
  delete process.env.NVIDIA_MODEL_TEXT;
  delete process.env.NVIDIA_MODEL_TEXT_FALLBACK;
});

afterEach(() => {
  delete process.env.NVIDIA_API_KEY;
  delete process.env.NVIDIA_MODEL_TEXT;
  delete process.env.NVIDIA_MODEL_TEXT_FALLBACK;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("POST /api/parse-meal — model switch chain", () => {
  it("uses nemotron-3-nano-30b-a3b as the primary model with chat_template_kwargs thinking:false", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      nvidiaOk(JSON.stringify({ items: [{ name: "egg", qty: 2, calories: 140, protein_g: 12, carbs_g: 1, fat_g: 10 }], total_calories: 280 }))
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(req({ text: "2 eggs" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.source).toBe("nvidia");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.model).toBe("nvidia/nemotron-3-nano-30b-a3b");
    expect(sentBody.chat_template_kwargs).toEqual({ thinking: false });
  });

  it("respects NVIDIA_MODEL_TEXT env override for the primary model", async () => {
    process.env.NVIDIA_MODEL_TEXT = "nvidia/some-other-text-model";
    const fetchMock = vi.fn().mockResolvedValue(
      nvidiaOk(JSON.stringify({ items: [{ name: "egg", qty: 1, calories: 70, protein_g: 6, carbs_g: 0, fat_g: 5 }], total_calories: 70 }))
    );
    vi.stubGlobal("fetch", fetchMock);

    await POST(req({ text: "an egg" }));
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string).model).toBe("nvidia/some-other-text-model");
  });

  it("falls back to meta/llama-3.3-70b-instruct when the primary model errors (non-timeout)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce(
        nvidiaOk(JSON.stringify({ items: [{ name: "toast", qty: 1, calories: 75, protein_g: 2, carbs_g: 13, fat_g: 1 }], total_calories: 75 }))
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(req({ text: "toast" }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.source).toBe("nvidia");
    expect(data.items[0].name).toBe("toast");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const primaryBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const fallbackBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(primaryBody.model).toBe("nvidia/nemotron-3-nano-30b-a3b");
    expect(fallbackBody.model).toBe("meta/llama-3.3-70b-instruct");
  });

  it("times out the primary stage at ~12s, tries the fallback model, times out at ~12s too, then returns the static table result", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(abortableNeverResolves());
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = POST(req({ text: "2 eggs and toast" }));
    await vi.advanceTimersByTimeAsync(12_000); // primary stage aborts
    await vi.advanceTimersByTimeAsync(12_000); // fallback stage aborts
    const res = await resultPromise;
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.source).toBe("fallback"); // static table, never a 500/hang
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not fire the fallback model's timer early — primary stage alone at 11.9s has not yet aborted", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(abortableNeverResolves());
    vi.stubGlobal("fetch", fetchMock);

    POST(req({ text: "2 eggs" }));
    await vi.advanceTimersByTimeAsync(11_900);
    expect(fetchMock).toHaveBeenCalledTimes(1); // still waiting on primary, fallback not started yet
  });
});

describe("POST /api/parse-meal — BUG-05 clamp on model output", () => {
  it("clamps negative calories/protein/qty from the model to zero and recomputes total from items", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      nvidiaOk(
        JSON.stringify({
          items: [
            { name: "mystery item", qty: -3, calories: -500, protein_g: -10, carbs_g: -1, fat_g: -1 },
          ],
          total_calories: 999999, // hallucinated total, must never be trusted as-is
        })
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(req({ text: "mystery item" }));
    const data = await res.json();

    expect(data.items[0].qty).toBeGreaterThanOrEqual(0);
    expect(data.items[0].calories).toBeGreaterThanOrEqual(0);
    expect(data.items[0].protein_g).toBeGreaterThanOrEqual(0);
    expect(data.items[0].carbs_g).toBeGreaterThanOrEqual(0);
    expect(data.items[0].fat_g).toBeGreaterThanOrEqual(0);
    // total_calories must be derived from the (clamped) items, not the model's own field
    expect(data.total_calories).toBe(data.items.reduce((s: number, i: { calories: number }) => s + i.calories, 0));
    expect(data.total_calories).not.toBe(999999);
  });

  it("clamps absurdly large per-item values to a sane ceiling", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      nvidiaOk(
        JSON.stringify({
          items: [{ name: "giant item", qty: 1e9, calories: 1e9, protein_g: 1e9, carbs_g: 1e9, fat_g: 1e9 }],
          total_calories: 1e9,
        })
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(req({ text: "giant item" }));
    const data = await res.json();

    expect(data.items[0].calories).toBeLessThan(1e9);
    expect(data.items[0].qty).toBeLessThan(1e9);
    expect(data.items[0].protein_g).toBeLessThan(1e9);
  });
});

describe("POST /api/parse-meal — BUG-02 comma-decimal normalization reaches the model, not just the fallback", () => {
  it("normalizes '1,5 banana' to '1.5 banana' in the text sent to the NVIDIA model", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      nvidiaOk(JSON.stringify({ items: [{ name: "banana", qty: 1.5, calories: 157, protein_g: 1.5, carbs_g: 40, fat_g: 0.5 }], total_calories: 157 }))
    );
    vi.stubGlobal("fetch", fetchMock);

    await POST(req({ text: "1,5 banana" }));

    const [, init] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(init.body as string);
    const userMessage = sentBody.messages.find((m: { role: string }) => m.role === "user");
    expect(userMessage.content).toContain("1.5 banana");
    expect(userMessage.content).not.toContain("1,5 banana");
  });

  it("does not mangle list-separator commas ('2 eggs, toast') while normalizing decimal commas", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      nvidiaOk(JSON.stringify({ items: [{ name: "egg", qty: 2, calories: 140, protein_g: 12, carbs_g: 1, fat_g: 10 }], total_calories: 140 }))
    );
    vi.stubGlobal("fetch", fetchMock);

    await POST(req({ text: "2 eggs, toast" }));

    const [, init] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(init.body as string);
    const userMessage = sentBody.messages.find((m: { role: string }) => m.role === "user");
    expect(userMessage.content).toContain("2 eggs, toast");
  });
});
