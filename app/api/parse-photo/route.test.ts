import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

// Contract tests for POST /api/parse-photo per PLAN.md "API Contract v2".
// No NVIDIA_API_KEY is set in the test process (never read/asserted here),
// so every call below exercises the no-key fallback path.

function jpegBlob(bytes = 1024): Blob {
  return new Blob([new Uint8Array(bytes)], { type: "image/jpeg" });
}

function formReq(form: FormData): NextRequest {
  return new NextRequest("http://localhost/api/parse-photo", {
    method: "POST",
    body: form,
  });
}

beforeEach(() => {
  delete process.env.NVIDIA_API_KEY;
});

describe("POST /api/parse-photo — contract", () => {
  it("400s on non-multipart body", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/parse-photo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
    );
    expect(res.status).toBe(400);
  });

  it("400s when 'photo' field is missing", async () => {
    const form = new FormData();
    form.set("notes", "no photo attached");
    const res = await POST(formReq(form));
    expect(res.status).toBe(400);
  });

  it("400s when photo file is empty", async () => {
    const form = new FormData();
    form.set("photo", new Blob([], { type: "image/jpeg" }), "empty.jpg");
    const res = await POST(formReq(form));
    expect(res.status).toBe(400);
  });

  it("400s when photo exceeds 8MB", async () => {
    const form = new FormData();
    form.set("photo", jpegBlob(9 * 1024 * 1024), "huge.jpg");
    const res = await POST(formReq(form));
    expect(res.status).toBe(400);
  });

  it("400s on unsupported MIME type", async () => {
    const form = new FormData();
    form.set("photo", new Blob([new Uint8Array(100)], { type: "image/gif" }), "food.gif");
    const res = await POST(formReq(form));
    expect(res.status).toBe(400);
  });

  it("no-key fallback path: 200 with contract shape, generic 'add manually' item, never a dead end", async () => {
    const form = new FormData();
    form.set("photo", jpegBlob(), "food.jpg");
    const res = await POST(formReq(form));
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.source).toBe("fallback");
    expect(Array.isArray(data.items)).toBe(true);
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.items[0].name).toMatch(/add manually/i);
    expect(typeof data.total_calories).toBe("number");
  });

  it("notes field is optional and capped, does not break the fallback path", async () => {
    const form = new FormData();
    form.set("photo", jpegBlob(), "food.jpg");
    form.set("notes", "x".repeat(1000));
    const res = await POST(formReq(form));
    expect(res.status).toBe(200);
  });
});
