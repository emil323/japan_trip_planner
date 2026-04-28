// Convert a remote image URL to a compact JPEG data URL by routing it
// through our /img-proxy route (same-origin → no CORS taint), drawing it
// onto an offscreen canvas and exporting as base64. The resulting data URL
// is small enough to persist directly in localStorage as part of TripState,
// making image references survive even if the upstream URL goes away.

const MAX_WIDTH = 560;
const MAX_HEIGHT = 420;
const JPEG_QUALITY = 0.82;

export function isDataUrl(s: string | undefined): boolean {
  return !!s && s.startsWith("data:");
}

export async function urlToDataUrl(remoteUrl: string): Promise<string | null> {
  if (!remoteUrl) return null;
  if (isDataUrl(remoteUrl)) return remoteUrl;
  if (typeof window === "undefined") return null;

  try {
    const proxied = `/img-proxy?url=${encodeURIComponent(remoteUrl)}`;
    const res = await fetch(proxied);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) return null;

    const bitmap = await loadBitmap(blob);
    const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_WIDTH, MAX_HEIGHT);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, width, height);
    if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();

    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  } catch {
    return null;
  }
}

async function loadBitmap(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob);
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function fitWithin(srcW: number, srcH: number, maxW: number, maxH: number) {
  if (srcW <= maxW && srcH <= maxH) return { width: srcW, height: srcH };
  const ratio = Math.min(maxW / srcW, maxH / srcH);
  return { width: Math.round(srcW * ratio), height: Math.round(srcH * ratio) };
}
