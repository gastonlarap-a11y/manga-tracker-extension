// Cover byte capture: some cover CDNs sit behind Cloudflare bot detection
// (zai.manhwa-latino.com, imagenes.mangasnosekai.com) and 403 every
// non-browser client — including the backend's referer-spoofing proxy. The
// background service worker, running inside the real browser with the site's
// cookies, is the only client that can read those bytes. Best-effort by
// design: any failure returns null and the stored coverUrl keeps today's
// proxy behavior.

export const MAX_COVER_IMAGE_BYTES = 5 * 1024 * 1024;

export interface FetchedCoverImage {
  bytes: ArrayBuffer;
  contentType: string;
}

// Only the call shape matters (mirrors the API client's trust boundary).
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export async function fetchCoverImageBytes(
  url: string,
  fetchFn: FetchLike = fetch,
  credentials: RequestCredentials = "include",
): Promise<FetchedCoverImage | null> {
  let response: Response;
  try {
    // From the service worker, credentials include sends the site's cookies.
    // From a content script (same-site page context, which is what actually
    // beats Cloudflare) the caller passes "omit": a credentialed CORS request
    // would be rejected by CDNs answering with a wildcard ACAO.
    response = await fetchFn(url, { credentials });
  } catch {
    return null;
  }
  if (!response.ok) {
    return null;
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    return null;
  }
  let bytes: ArrayBuffer;
  try {
    bytes = await response.arrayBuffer();
  } catch {
    return null;
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_COVER_IMAGE_BYTES) {
    return null;
  }
  return { bytes, contentType };
}

// runtime.sendMessage JSON-serializes payloads, so bytes travel between the
// content script and the background as base64.
export function encodeBytesToBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode(...view.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function decodeBase64ToBytes(base64: string): ArrayBuffer | null {
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    return null;
  }
  const buffer = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    view[i] = binary.charCodeAt(i);
  }
  return buffer;
}
