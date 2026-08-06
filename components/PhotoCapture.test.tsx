// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PhotoCapture from "./PhotoCapture";

vi.mock("@/lib/resizeImage", () => ({
  resizeImageFile: vi.fn(),
}));

import { resizeImageFile } from "@/lib/resizeImage";

function pickFile(input: HTMLElement, file: File) {
  fireEvent.change(input, { target: { files: [file] } });
}

const HEIC_FILE = new File(["heic-bytes"], "photo.heic", { type: "image/heic" });

describe("PhotoCapture — BUG-09 client cancel + decode-vs-network error copy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a decode-specific error (not the generic network onError) when createImageBitmap/resize fails", async () => {
    vi.mocked(resizeImageFile).mockRejectedValue(new DOMException("no HEIC decoder", "NotSupportedError"));
    const onError = vi.fn();
    const onResult = vi.fn();

    render(<PhotoCapture onResult={onResult} onError={onError} />);
    // The actual <input type=file> is hidden; grab it directly (index 1 =
    // the library picker, per DOM order in the component).
    const fileInputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]');
    pickFile(fileInputs[1], HEIC_FILE);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/unsupported format/i);
    expect(alert).not.toHaveTextContent(/connection/i);

    // Parent's generic "check your connection" error path must NOT fire for
    // a local decode failure.
    expect(onError).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
  });

  it("calls onError (generic network path) when the fetch to /api/parse-photo fails, decode having succeeded", async () => {
    vi.mocked(resizeImageFile).mockResolvedValue({
      blob: new Blob(["x"]),
      dataUrl: "data:image/jpeg;base64,x",
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const onError = vi.fn();
    const onResult = vi.fn();

    render(<PhotoCapture onResult={onResult} onError={onError} />);
    const fileInputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]');
    pickFile(fileInputs[1], new File(["jpg-bytes"], "photo.jpg", { type: "image/jpeg" }));

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("aborts the in-flight fetch and does not call onError when Cancel is clicked", async () => {
    vi.mocked(resizeImageFile).mockResolvedValue({
      blob: new Blob(["x"]),
      dataUrl: "data:image/jpeg;base64,x",
    });
    let capturedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal as AbortSignal;
      return new Promise((_resolve, reject) => {
        capturedSignal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError"))
        );
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const onError = vi.fn();
    const onResult = vi.fn();
    const onLoadingChange = vi.fn();

    render(<PhotoCapture onResult={onResult} onError={onError} onLoadingChange={onLoadingChange} />);
    const fileInputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]');
    pickFile(fileInputs[1], new File(["jpg-bytes"], "photo.jpg", { type: "image/jpeg" }));

    const cancelButton = await screen.findByRole("button", { name: /cancel/i });
    expect(capturedSignal?.aborted).toBe(false);
    fireEvent.click(cancelButton);

    await waitFor(() => expect(capturedSignal?.aborted).toBe(true));
    await waitFor(() => expect(onLoadingChange).toHaveBeenLastCalledWith(false));

    expect(onError).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
  });
});
