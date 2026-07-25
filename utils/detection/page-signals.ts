import { tokensRoughlyMatch } from "./text";

// Thin DOM reader: everything downstream (heuristics, confidence) works on
// this plain structure so it stays pure and unit-testable.
export interface PageSignals {
  url: string;
  documentTitle: string;
  ogTitle: string | null;
  twitterTitle: string | null;
  firstHeading: string | null;
  siteName: string | null;
  seriesLinkTitle: string | null;
}

export function collectPageSignals(doc: Document, url: string): PageSignals {
  return {
    url,
    documentTitle: doc.title,
    ogTitle: metaContent(doc, 'meta[property="og:title"]'),
    twitterTitle: metaContent(doc, 'meta[name="twitter:title"]'),
    firstHeading: firstHeadingText(doc),
    siteName: metaContent(doc, 'meta[property="og:site_name"]'),
    seriesLinkTitle: seriesLinkTitle(doc, url),
  };
}

// Chapter URLs usually nest under the series page (/series/<slug>/<chapter>),
// and some anchor on the page (breadcrumb, reader header) points back at that
// parent path carrying the series name — a signal that survives sites whose
// <title>/og tags only hold branding (mhscans). The anchor text must
// round-trip against the anchor's own slug so navigation labels ("Ver todos
// los capítulos") are never mistaken for a title.
function seriesLinkTitle(doc: Document, url: string): string | null {
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    return null;
  }
  const currentPath = withTrailingSlash(current.pathname);
  let best: { path: string; text: string } | null = null;
  for (const anchor of doc.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href");
    if (!href) {
      continue;
    }
    let target: URL;
    try {
      target = new URL(href, current);
    } catch {
      continue;
    }
    if (target.origin !== current.origin) {
      continue;
    }
    const path = withTrailingSlash(target.pathname);
    if (path === "/" || path === currentPath || !currentPath.startsWith(path)) {
      continue;
    }
    const text = anchor.textContent?.replace(/\s+/g, " ").trim();
    if (!text) {
      continue;
    }
    const slug = path.split("/").filter(Boolean).at(-1);
    if (!slug || !tokensRoughlyMatch(text, slug)) {
      continue;
    }
    if (!best || path.length > best.path.length) {
      best = { path, text };
    }
  }
  return best?.text ?? null;
}

function withTrailingSlash(path: string): string {
  return path.endsWith("/") ? path : `${path}/`;
}

// Sites that put their branding in og:image (olympus: /olympus-logo-180.webp)
// would flood the library with logos — better to send nothing and let the
// user set a manual cover in the dashboard.
const GENERIC_IMAGE_PATTERN = /logo|banner|favicon|icon|default|placeholder/i;

// Resolves an image reference to an absolute http(s) URL, rejecting site
// branding. Shared by the cover hunt (utils/detection/cover-hunt.ts).
export function resolveImageUrl(src: string, baseUrl: string): string | null {
  try {
    const url = new URL(src, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    if (GENERIC_IMAGE_PATTERN.test(url.pathname)) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

// Cover candidate from meta tags (og:image, twitter:image as fallback).
// baseUrl matters for documents built with DOMParser, whose baseURI points
// at the extension, not at the fetched page.
export function coverFromDocument(
  doc: Document,
  baseUrl: string = doc.baseURI,
): string | null {
  const raw =
    metaContent(doc, 'meta[property="og:image"]') ??
    metaContent(doc, 'meta[name="twitter:image"]');
  if (!raw) {
    return null;
  }
  return resolveImageUrl(raw, baseUrl);
}

function metaContent(doc: Document, selector: string): string | null {
  const content = doc.querySelector(selector)?.getAttribute("content")?.trim();
  return content ? content : null;
}

function firstHeadingText(doc: Document): string | null {
  for (const heading of doc.querySelectorAll("h1")) {
    const text = heading.textContent?.trim();
    if (text) {
      return text;
    }
  }
  return null;
}
