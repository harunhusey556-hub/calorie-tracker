// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import ServiceWorkerRegister from "./ServiceWorkerRegister";

describe("ServiceWorkerRegister — BUG-07 offline app shell registration", () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    // @ts-expect-error test override of a readonly-typed global
    delete navigator.serviceWorker;
  });

  afterEach(() => {
    // @ts-expect-error restoring NODE_ENV after forcing it per test
    process.env.NODE_ENV = originalEnv;
    vi.restoreAllMocks();
  });

  it("registers /sw.js in production when serviceWorker is supported", async () => {
    // @ts-expect-error test override of NODE_ENV
    process.env.NODE_ENV = "production";
    const register = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "serviceWorker", {
      value: { register },
      configurable: true,
    });

    render(<ServiceWorkerRegister />);
    await Promise.resolve();

    expect(register).toHaveBeenCalledWith("/sw.js");
  });

  it("does not register in development (avoids caching unhashed dev/HMR chunks)", async () => {
    // @ts-expect-error test override of NODE_ENV
    process.env.NODE_ENV = "development";
    const register = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "serviceWorker", {
      value: { register },
      configurable: true,
    });

    render(<ServiceWorkerRegister />);
    await Promise.resolve();

    expect(register).not.toHaveBeenCalled();
  });

  it("does not throw when serviceWorker is unsupported", () => {
    // @ts-expect-error test override of NODE_ENV
    process.env.NODE_ENV = "production";
    expect(() => render(<ServiceWorkerRegister />)).not.toThrow();
  });
});
