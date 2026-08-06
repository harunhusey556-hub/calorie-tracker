import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

// R2 hardening (2026-08-06): MODEL SWITCH directive (primary/fallback/manual
// chain, ~12s per-stage timeout, env override) + BUG-05 (unclamped model
// output). RED-before-fix per QUALITY-PLAYBOOK — every test here fails
// against the pre-R2 route.ts (single model llama-3.2-90b-vision-instruct,
// same-model retry, 90s timeout, no clamp).

function jpegBlob(bytes = 1024): Blob {
  return new Blob([new Uint8Array(bytes)], { type: "image/jpeg" });
}

function formReq(form: FormData): NextRequest {
  return new NextRequest("http://localhost/api/parse-photo", {
    method: "POST",
    body: form,
  });
}

function photoForm(): FormData {
  const form = new FormData();
  form.set("photo", jpegBlob(), "food.jpg");
  return form;
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
  delete process.env.NVIDIA_MODEL_VISION;
  delete process.env.NVIDIA_MODEL_VISION_FALLBACK;
  delete process.env.NVIDIA_STAGE_TIMEOUT_MS;
});

afterEach(() => {
  delete process.env.NVIDIA_API_KEY;
  delete process.env.NVIDIA_MODEL_VISION;
  delete process.env.NVIDIA_MODEL_VISION_FALLBACK;
  delete process.env.NVIDIA_STAGE_TIMEOUT_MS;
  vi.unstubAllGlobals();
});

describe("POST /api/parse-photo — model switch chain", () => {
  it("uses nemotron-nano-12b-v2-vl as the primary vision model", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      nvidiaOk(JSON.stringify({ items: [{ name: "egg", qty: 2, calories: 140, protein_g: 12, carbs_g: 1, fat_g: 10 }], total_calories: 280 }))
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(formReq(photoForm()));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.source).toBe("nvidia-vision");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string).model).toBe("nvidia/nemotron-nano-12b-v2-vl");
  });

  it("respects NVIDIA_MODEL_VISION env override for the primary model", async () => {
    process.env.NVIDIA_MODEL_VISION = "nvidia/some-other-vision-model";
    const fetchMock = vi.fn().mockResolvedValue(
      nvidiaOk(JSON.stringify({ items: [{ name: "egg", qty: 1, calories: 70, protein_g: 6, carbs_g: 0, fat_g: 5 }], total_calories: 70 }))
    );
    vi.stubGlobal("fetch", fetchMock);

    await POST(formReq(photoForm()));
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string).model).toBe("nvidia/some-other-vision-model");
  });

  it("falls back to meta/llama-3.2-90b-vision-instruct when the primary model errors (non-timeout)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce(
        nvidiaOk(JSON.stringify({ items: [{ name: "toast", qty: 1, calories: 75, protein_g: 2, carbs_g: 13, fat_g: 1 }], total_calories: 75 }))
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(formReq(photoForm()));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.source).toBe("nvidia-vision");
    expect(data.items[0].name).toBe("toast");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const primaryBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const fallbackBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(primaryBody.model).toBe("nvidia/nemotron-nano-12b-v2-vl");
    expect(fallbackBody.model).toBe("meta/llama-3.2-90b-vision-instruct");
  });

  it("times out the primary stage, tries the fallback model, times out too, then returns the manual-entry CTA", async () => {
    // NVIDIA_STAGE_TIMEOUT_MS shrinks the real ~12s per-stage budget to a
    // few ms so this exercises the actual AbortSignal.timeout wiring with
    // real timers, instead of fake-timer bookkeeping around Next's
    // multipart body parsing (which relies on real setImmediate ticks).
    process.env.NVIDIA_STAGE_TIMEOUT_MS = "20";
    const fetchMock = vi.fn().mockImplementation(abortableNeverResolves());
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(formReq(photoForm()));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.source).toBe("fallback");
    expect(data.items[0].name).toMatch(/add manually/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("no longer retries the SAME model twice — a primary failure moves straight to the distinct fallback model", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce(nvidiaOk(JSON.stringify({ items: [], total_calories: 0 })));
    vi.stubGlobal("fetch", fetchMock);

    await POST(formReq(photoForm()));
    const models = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body as string).model);
    expect(new Set(models).size).toBe(2); // two distinct models, not the same model twice
  });
});

describe("POST /api/parse-photo — BUG-05 clamp on model output", () => {
  it("clamps negative calories/protein/qty from the model to zero and recomputes total from items", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      nvidiaOk(
        JSON.stringify({
          items: [{ name: "mystery item", qty: -3, calories: -500, protein_g: -10, carbs_g: -1, fat_g: -1 }],
          total_calories: 999999,
        })
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(formReq(photoForm()));
    const data = await res.json();

    expect(data.items[0].qty).toBeGreaterThanOrEqual(0);
    expect(data.items[0].calories).toBeGreaterThanOrEqual(0);
    expect(data.items[0].protein_g).toBeGreaterThanOrEqual(0);
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

    const res = await POST(formReq(photoForm()));
    const data = await res.json();

    expect(data.items[0].calories).toBeLessThan(1e9);
    expect(data.items[0].qty).toBeLessThan(1e9);
    expect(data.items[0].protein_g).toBeLessThan(1e9);
  });
});
