import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

// Contract tests for POST /api/parse-meal per PLAN.md "API Contract".
// No NVIDIA_API_KEY is set in the test process (never read/asserted here),
// so every call below exercises the no-key fallback path — the exact path
// the contract requires to "still be fully functional without a key".

function req(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/parse-meal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function rawReq(rawBody: string): NextRequest {
  return new NextRequest("http://localhost/api/parse-meal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: rawBody,
  });
}

beforeEach(() => {
  delete process.env.NVIDIA_API_KEY;
});

describe("POST /api/parse-meal — contract", () => {
  it("400s on invalid JSON body", async () => {
    const res = await POST(rawReq("{not json"));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeTruthy();
  });

  it("400s when 'text' is missing", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  it("400s when 'text' is empty/whitespace-only", async () => {
    const res = await POST(req({ text: "   " }));
    expect(res.status).toBe(400);
  });

  it("never returns 500, even on garbage input types", async () => {
    const res = await POST(req({ text: 12345 }));
    expect(res.status).toBe(400); // rejected by type check, not a crash
  });

  it("no-key fallback path: 200 with contract shape, source 'fallback'", async () => {
    const res = await POST(req({ text: "2 eggs and toast" }));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.source).toBe("fallback");
    expect(Array.isArray(data.items)).toBe(true);
    expect(typeof data.total_calories).toBe("number");
    for (const item of data.items) {
      expect(typeof item.name).toBe("string");
      expect(typeof item.qty).toBe("number");
      expect(typeof item.calories).toBe("number");
      expect(typeof item.protein_g).toBe("number");
      expect(typeof item.carbs_g).toBe("number");
      expect(typeof item.fat_g).toBe("number");
    }
  });

  it("no-key fallback path never 500s even for completely unrecognized text", async () => {
    const res = await POST(req({ text: "asdkfjaslkdjf qwerty nonsense" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.items).toEqual([]);
    expect(data.total_calories).toBe(0);
    expect(data.source).toBe("fallback");
  });
});
