/**
 * Client-side downscale of a picked/captured image file to a max dimension,
 * returning a JPEG blob (for upload) and a data URL (for preview).
 *
 * Keeps photo uploads fast on mobile connections and matches the
 * `/api/parse-photo` contract (client resizes to ~1024px before upload).
 */
export async function resizeImageFile(
  file: File,
  maxDim = 1024,
  quality = 0.85
): Promise<{ blob: Blob; dataUrl: string }> {
  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;

  if (width > maxDim || height > maxDim) {
    const scale = maxDim / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("image resize failed"))),
      "image/jpeg",
      quality
    );
  });
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  return { blob, dataUrl };
}
