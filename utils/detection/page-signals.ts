// Thin DOM reader: everything downstream (heuristics, confidence) works on
// this plain structure so it stays pure and unit-testable.
export interface PageSignals {
  url: string;
  documentTitle: string;
  ogTitle: string | null;
  twitterTitle: string | null;
  firstHeading: string | null;
}

export function collectPageSignals(doc: Document, url: string): PageSignals {
  return {
    url,
    documentTitle: doc.title,
    ogTitle: metaContent(doc, 'meta[property="og:title"]'),
    twitterTitle: metaContent(doc, 'meta[name="twitter:title"]'),
    firstHeading: firstHeadingText(doc),
  };
}

// Cover candidate for the library (og:image, twitter:image as fallback),
// resolved to an absolute http(s) URL. Independent from PageSignals: the
// detection pipeline does not need it, only the reported event does.
export function coverFromDocument(doc: Document): string | null {
  const raw =
    metaContent(doc, 'meta[property="og:image"]') ??
    metaContent(doc, 'meta[name="twitter:image"]');
  if (!raw) {
    return null;
  }
  try {
    const url = new URL(raw, doc.baseURI);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
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
