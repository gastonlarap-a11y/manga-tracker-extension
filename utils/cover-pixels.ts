import { browser } from "#imports";

// Pixel capture for covers whose CDN rejects every direct client — even the
// service worker's fetch with the site's cookies (Cloudflare bot detection
// validates the full browsing context, verified live on zai.manhwa-latino.com:
// 403 with and without credentials). The one thing that cannot be blocked is
// what the user's screen already shows, so the background screenshots the
// visible tab and crops the rendered cover element out of it.

export interface CoverRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CapturedImage {
  bytes: ArrayBuffer;
  contentType: string;
}

// A crop narrower than this is a broken rect, not a cover.
const MIN_CAPTURE_CSS_WIDTH = 60;
const OUTPUT_TYPE = "image/webp";
const OUTPUT_QUALITY = 0.92;

export async function captureCoverFromVisibleTab(
  windowId: number,
  rect: CoverRect,
  dpr: number,
): Promise<CapturedImage | null> {
  if (rect.width < MIN_CAPTURE_CSS_WIDTH || rect.height <= 0 || dpr <= 0) {
    return null;
  }
  let dataUrl: string;
  try {
    dataUrl = await browser.tabs.captureVisibleTab(windowId, {
      format: "png",
    });
  } catch {
    return null;
  }
  return cropDataUrl(dataUrl, rect, dpr);
}

// The rect arrives in CSS pixels relative to the viewport; the screenshot is
// in device pixels — scale by dpr and clamp to the bitmap.
export async function cropDataUrl(
  dataUrl: string,
  rect: CoverRect,
  dpr: number,
): Promise<CapturedImage | null> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    const x = clamp(Math.round(rect.x * dpr), 0, bitmap.width - 1);
    const y = clamp(Math.round(rect.y * dpr), 0, bitmap.height - 1);
    const width = clamp(Math.round(rect.width * dpr), 1, bitmap.width - x);
    const height = clamp(Math.round(rect.height * dpr), 1, bitmap.height - y);
    if (width < MIN_CAPTURE_CSS_WIDTH) {
      return null;
    }
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) {
      return null;
    }
    context.drawImage(bitmap, x, y, width, height, 0, 0, width, height);
    const cropped = await canvas.convertToBlob({
      type: OUTPUT_TYPE,
      quality: OUTPUT_QUALITY,
    });
    return { bytes: await cropped.arrayBuffer(), contentType: cropped.type };
  } catch {
    return null;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
