import type { LibraryEntryDto } from "../api/types";
import { coverFromDocument, resolveImageUrl } from "./page-signals";

// Three-level, best-effort hunt for the manga's real cover. It only runs when
// the backend reports that the manga has no cover yet, so the cost is one-off
// per manga. Every level was calibrated against real sites:
// - olympus: chapter og:image is the site logo; the chapter PANELS carry the
//   manga name in their alt but are huge strips (min-height 4000px); the
//   /series/... anchors visible on a chapter page belong to RECOMMENDED
//   mangas, not the current one — hence the name-overlap scoring.
// - manhwaweb / ikigai: no og tags on chapter pages at all.

const SERIES_PATH_PATTERN =
  /\/(?:series?|manga|manhwa|manhua|comics?|obra|proyecto|title)s?\//i;

const MIN_COVER_WIDTH = 80;
const MAX_COVER_WIDTH = 600;
const MIN_COVER_RATIO = 1.1;
const MAX_COVER_RATIO = 2.0;

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function significantWords(name: string): string[] {
  return normalize(name)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4);
}

// A candidate names the manga when it contains at least half of the name's
// significant words ("De duende a Dios Goblin" → duende/dios/goblin).
export function nameMatches(name: string, text: string): boolean {
  const words = significantWords(name);
  if (words.length === 0) {
    return false;
  }
  const haystack = normalize(text);
  const hits = words.filter((word) => haystack.includes(word)).length;
  return hits * 2 >= words.length;
}

// Best same-origin link to the manga's own series page: series-ish path AND
// name overlap (which rules out the "recommended" section).
export function findSeriesLink(
  doc: Document,
  mangaName: string,
  pageUrl: string,
): string | null {
  let base: URL;
  try {
    base = new URL(pageUrl);
  } catch {
    return null;
  }

  const words = significantWords(mangaName);
  let best: { href: string; hits: number } | null = null;
  for (const anchor of doc.querySelectorAll("a[href]")) {
    const rawHref = anchor.getAttribute("href");
    if (!rawHref) {
      continue;
    }
    let url: URL;
    try {
      url = new URL(rawHref, base);
    } catch {
      continue;
    }
    if (url.origin !== base.origin) {
      continue;
    }
    if (!SERIES_PATH_PATTERN.test(url.pathname)) {
      continue;
    }
    const haystack = normalize(`${url.pathname} ${anchor.textContent ?? ""}`);
    const hits = words.filter((word) => haystack.includes(word)).length;
    if (hits * 2 < words.length) {
      continue;
    }
    if (!best || hits > best.hits) {
      best = { href: url.href, hits };
    }
  }
  return best?.href ?? null;
}

// Cover inside a fetched series page: og:image first; otherwise the image
// whose alt names the manga (series pages show the cover, never panels).
export function coverFromSeriesDocument(
  doc: Document,
  mangaName: string,
  seriesUrl: string,
): string | null {
  const fromMeta = coverFromDocument(doc, seriesUrl);
  if (fromMeta) {
    return fromMeta;
  }
  for (const img of doc.querySelectorAll("img[alt]")) {
    const alt = img.getAttribute("alt") ?? "";
    if (!nameMatches(mangaName, alt)) {
      continue;
    }
    const resolved = resolveImageUrl(img.getAttribute("src") ?? "", seriesUrl);
    if (resolved) {
      return resolved;
    }
  }
  return null;
}

// Last resort on the chapter page itself: an image that names the manga AND
// has cover-like dimensions. The size window excludes chapter panels (wide
// and/or kilometers tall) while keeping header thumbnails.
export function pickCoverFromImages(
  doc: Document,
  mangaName: string,
): string | null {
  let best: { href: string; area: number } | null = null;
  for (const img of doc.querySelectorAll("img")) {
    if (!(img instanceof HTMLImageElement)) {
      continue;
    }
    if (!nameMatches(mangaName, img.getAttribute("alt") ?? "")) {
      continue;
    }
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    if (width < MIN_COVER_WIDTH || width > MAX_COVER_WIDTH) {
      continue;
    }
    const ratio = height / Math.max(width, 1);
    if (ratio < MIN_COVER_RATIO || ratio > MAX_COVER_RATIO) {
      continue;
    }
    const resolved = resolveImageUrl(
      img.getAttribute("src") ?? "",
      doc.baseURI,
    );
    if (!resolved) {
      continue;
    }
    const area = width * height;
    if (!best || area > best.area) {
      best = { href: resolved, area };
    }
  }
  return best?.href ?? null;
}

async function coverFromSeriesPage(
  seriesUrl: string,
  mangaName: string,
  fetchFn: typeof fetch,
): Promise<string | null> {
  try {
    const response = await fetchFn(seriesUrl);
    if (!response.ok) {
      return null;
    }
    const html = await response.text();
    const parsed = new DOMParser().parseFromString(html, "text/html");
    return coverFromSeriesDocument(parsed, mangaName, seriesUrl);
  } catch {
    return null;
  }
}

export function isSeriesPath(pathname: string): boolean {
  return SERIES_PATH_PATTERN.test(pathname);
}

// Level 4 (SPA sites like manhwaweb, whose fetched series page is an empty
// shell): when the USER visits the rendered series page of a tracked site,
// pick which library manga without a cover it belongs to.
export function matchLibraryEntry(
  entries: LibraryEntryDto[],
  pageText: string,
): LibraryEntryDto | null {
  let best: { entry: LibraryEntryDto; hits: number } | null = null;
  const haystack = normalize(pageText);
  for (const entry of entries) {
    if (entry.coverUrl !== null) {
      continue;
    }
    const words = significantWords(entry.canonicalName);
    if (words.length === 0) {
      continue;
    }
    const hits = words.filter((word) => haystack.includes(word)).length;
    if (hits * 2 < words.length) {
      continue;
    }
    if (!best || hits > best.hits) {
      best = { entry, hits };
    }
  }
  return best?.entry ?? null;
}

// Cover on a RENDERED series page: og:image → image matching the name by
// alt/src → the largest portrait image (a series page has no chapter panels,
// so its hero cover is the biggest portrait img by far). Unlike the chapter
// page filter there is NO upper width cap: fichas serve covers at full
// resolution (manhwaweb: 1472×2364) and portrait ratio already rules out
// banners and panel strips.
export function pickSeriesPageCover(
  doc: Document,
  mangaName: string,
): string | null {
  const fromMeta = coverFromDocument(doc);
  if (fromMeta) {
    return fromMeta;
  }

  let named: string | null = null;
  let largest: { href: string; area: number } | null = null;
  for (const img of doc.querySelectorAll("img")) {
    if (!(img instanceof HTMLImageElement)) {
      continue;
    }
    // While the bytes are still downloading (or the img is lazy) natural
    // dimensions are 0 — the rendered box is already cover-shaped, and the
    // URL is usable without waiting for pixels.
    const rect = img.getBoundingClientRect();
    const width = img.naturalWidth || rect.width;
    const height = img.naturalHeight || rect.height;
    if (width < 120) {
      continue;
    }
    const ratio = height / Math.max(width, 1);
    if (ratio < 1.15 || ratio > 2.2) {
      continue;
    }
    const src = img.currentSrc || img.getAttribute("src") || "";
    const resolved = resolveImageUrl(src, doc.baseURI);
    if (!resolved) {
      continue;
    }
    const alt = img.getAttribute("alt") ?? "";
    if (named === null && nameMatches(mangaName, `${alt} ${decodeUrl(src)}`)) {
      named = resolved;
    }
    const area = width * height;
    if (!largest || area > largest.area) {
      largest = { href: resolved, area };
    }
  }
  return named ?? largest?.href ?? null;
}

// Accented slugs arrive percent-encoded in src ("m%C3%A1gico"), which would
// hide their words from the name match.
function decodeUrl(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// fetchFn is injectable so tests never touch the network.
export async function huntCover(
  doc: Document,
  mangaName: string,
  pageUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  const fromPage = coverFromDocument(doc, pageUrl);
  if (fromPage) {
    return fromPage;
  }

  const seriesHref = findSeriesLink(doc, mangaName, pageUrl);
  if (seriesHref) {
    const fromSeries = await coverFromSeriesPage(
      seriesHref,
      mangaName,
      fetchFn,
    );
    if (fromSeries) {
      return fromSeries;
    }
  }

  return pickCoverFromImages(doc, mangaName);
}
