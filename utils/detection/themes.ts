/**
 * Site themes: one layout shared by many unrelated sites.
 *
 * Most Spanish-language manga sites are not written from scratch. Of 105
 * measured from Keiyoushi's extension catalogue, 30 run the Madara WordPress
 * theme and 14 MangaThemesia, and each theme emits the same markup on every
 * site that uses it. Knowing a theme is reading a site correctly the first
 * time someone opens it, with no calibration and no rule of its own.
 *
 * The themes themselves come from the backend (`GET /api/extension-config`),
 * so a new one, or a theme that changed its markup, costs a desktop release
 * rather than a Web Store review.
 */
import type { SiteThemeDto } from "../api/types";

/** The first theme whose reader marker is on the page, or null. */
export function themeFor(
  doc: Document,
  themes: readonly SiteThemeDto[],
): SiteThemeDto | null {
  for (const theme of themes) {
    if (matches(doc, theme.readerMarker)) {
      return theme;
    }
  }
  return null;
}

function matches(doc: Document, selector: string): boolean {
  if (typeof selector !== "string" || selector.length === 0) {
    return false;
  }
  try {
    return doc.querySelector(selector) !== null;
  } catch {
    // A selector the browser cannot parse is a bug in the catalogue: the
    // theme simply never applies.
    return false;
  }
}

/**
 * The absolute URL of the next chapter, when the theme or the site's rule
 * says where its link is. Same origin only: the popup opens it, and a link
 * elsewhere is not the next chapter of anything read here.
 */
export function nextChapterUrl(
  doc: Document,
  url: string,
  selectors: readonly (string | null | undefined)[],
): string | null {
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    return null;
  }
  for (const selector of selectors) {
    if (!selector) {
      continue;
    }
    let anchor: Element | null;
    try {
      anchor = doc.querySelector(selector);
    } catch {
      continue;
    }
    const href = anchor?.getAttribute("href");
    if (!href) {
      continue;
    }
    try {
      const target = new URL(href, current);
      if (
        target.origin === current.origin &&
        target.pathname !== current.pathname
      ) {
        return target.href;
      }
    } catch {
      // A malformed href: try the next selector.
    }
  }
  return null;
}
