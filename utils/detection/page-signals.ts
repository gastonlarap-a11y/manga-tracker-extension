import { DEFAULT_DETECTION_CONFIG } from "./config";
import { normalizeTokens, tokensRoughlyMatch } from "./text";

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
  /**
   * The series link came from the theme's or the site's selector, not from
   * searching the page: the series page's own name, trusted for the name.
   */
  seriesLinkHinted: boolean;
  /**
   * The series link's own slug. Confirms where a title's real name starts on
   * a site whose chapter URL carries no slug at all (heavenmanga:
   * /manga/leer/293702).
   */
  seriesLinkSlug: string | null;
  /** The text of the heading the site's theme or rule points at. */
  themeHeading: string | null;
  /** The site's theme recognised this page as its reader. */
  themeReader: boolean;
}

/**
 * What a site's theme or curated rule says about where things are on the
 * page. Hints, not answers: the heuristic still decides, with better evidence
 * than it could find alone.
 */
export interface PageHints {
  /** The theme's reader marker is on this page. */
  reader: boolean;
  /** An element whose text names the series and the chapter. */
  headingSelector: string | null;
  /** Anchors back to the series page; the last one off this page is taken. */
  seriesLinkSelector: string | null;
  /**
   * Path segments that name a site section, never a series; the detection
   * config's, with whatever the backend added. A nav link "Manga" → /manga/
   * sits on every chapter page, and is a prefix of every chapter path.
   */
  sectionSegments?: ReadonlySet<string>;
}

export const NO_HINTS: PageHints = {
  reader: false,
  headingSelector: null,
  seriesLinkSelector: null,
};

export function collectPageSignals(
  doc: Document,
  url: string,
  hints: PageHints = NO_HINTS,
): PageSignals {
  const link = findSeriesLink(doc, url, hints);
  return {
    url,
    documentTitle: doc.title,
    ogTitle: metaContent(doc, 'meta[property="og:title"]'),
    twitterTitle: metaContent(doc, 'meta[name="twitter:title"]'),
    firstHeading: firstHeadingText(doc),
    siteName: metaContent(doc, 'meta[property="og:site_name"]'),
    seriesLinkTitle: link?.text ?? null,
    seriesLinkHinted: link?.hinted ?? false,
    seriesLinkSlug: link
      ? (link.path.split("/").filter(Boolean).at(-1) ?? null)
      : null,
    themeHeading:
      hints.headingSelector === null
        ? null
        : selectorText(doc, hints.headingSelector),
    themeReader: hints.reader,
  };
}

/**
 * Absolute URL of the series page this chapter belongs to, or null when the
 * page exposes no such link.
 *
 * Sent alongside the reading so the backend can key the series by its path
 * instead of by its title: a site that reformats its <title> (adds the
 * scanlation group, drops the chapter) used to create a SECOND manga for a
 * series already being tracked. The path does not move.
 */
export function seriesUrlFrom(
  doc: Document,
  url: string,
  hints: PageHints = NO_HINTS,
): string | null {
  const link = findSeriesLink(doc, url, hints);
  if (!link) {
    return null;
  }
  try {
    return new URL(link.path, url).href;
  } catch {
    return null;
  }
}

/**
 * The anchor the theme or the site's rule names, else the parent link, else a
 * sibling link the page title vouches for.
 */
function findSeriesLink(
  doc: Document,
  url: string,
  hints: PageHints,
): { path: string; text: string; hinted: boolean } | null {
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    return null;
  }
  if (hints.seriesLinkSelector !== null) {
    const hinted = hintedSeriesLink(doc, current, hints.seriesLinkSelector);
    if (hinted !== null) {
      return { ...hinted, hinted: true };
    }
  }
  const sections =
    hints.sectionSegments ?? DEFAULT_DETECTION_CONFIG.sectionSegments;
  const found =
    parentSeriesLink(doc, current, sections) ??
    siblingSeriesLink(doc, current, sections);
  return found && { ...found, hinted: false };
}

/** Whether a path's last segment names a series rather than a site section. */
function isSeriesSlug(
  slug: string | undefined,
  sections: ReadonlySet<string>,
): slug is string {
  return slug !== undefined && !sections.has(slug.toLowerCase());
}

/**
 * The last anchor the selector matches that leads off this page: breadcrumbs
 * end Home › Series › this chapter, and whether the chapter itself is a link
 * varies by site. Trusted without the slug check — the selector is a
 * deliberate statement about the site, and MangaThemesia's series link sits
 * nowhere near the chapter's path.
 */
function hintedSeriesLink(
  doc: Document,
  current: URL,
  selector: string,
): { path: string; text: string } | null {
  let anchors: Element[];
  try {
    anchors = [...doc.querySelectorAll(selector)];
  } catch {
    // An invalid selector in the catalogue: as if there were no hint.
    return null;
  }
  const currentPath = withTrailingSlash(current.pathname);
  for (const anchor of anchors.reverse()) {
    const target = sameOriginTarget(anchor, current);
    if (target === null) {
      continue;
    }
    const path = withTrailingSlash(target.pathname);
    const text = textOf(anchor);
    if (path !== "/" && path !== currentPath && text) {
      return { path, text };
    }
  }
  return null;
}

// Chapter URLs usually nest under the series page (/series/<slug>/<chapter>),
// and some anchor on the page (breadcrumb, reader header) points back at that
// parent path carrying the series name — a signal that survives sites whose
// <title>/og tags only hold branding (mhscans). The anchor text must
// round-trip against the anchor's own slug so navigation labels ("Ver todos
// los capítulos") are never mistaken for a title.
function parentSeriesLink(
  doc: Document,
  current: URL,
  sections: ReadonlySet<string>,
): { path: string; text: string } | null {
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
    if (!isSeriesSlug(slug, sections) || !tokensRoughlyMatch(text, slug)) {
      continue;
    }
    if (!best || path.length > best.path.length) {
      best = { path, text };
    }
  }
  return best;
}

/**
 * A link to the series that is not a parent of the chapter, for sites whose
 * chapter URL leaves the series out (heavenmanga reads at /manga/leer/293702
 * and links back to /manga/soy-un-dios-maligno).
 *
 * A chapter page links to plenty of other series too — a sidebar of popular
 * ones, a "you may also like" row — so a sibling needs more than a matching
 * slug: it shares the chapter's first path segment, and the page's own title
 * names it, followed by where a name ends (a chapter word, a separator, the
 * end). That last part is what keeps "Solo Leveling" in a sidebar from
 * claiming a page titled "Solo Leveling Ragnarok Capítulo 5". When several
 * qualify, the longest name wins.
 */
function siblingSeriesLink(
  doc: Document,
  current: URL,
  sections: ReadonlySet<string>,
): { path: string; text: string } | null {
  const section = current.pathname.split("/").filter(Boolean)[0];
  if (section === undefined) {
    return null;
  }
  const title = normalizeTokens(doc.title).join(" ");
  let best: { path: string; text: string; tokens: number } | null = null;
  for (const anchor of doc.querySelectorAll("a[href]")) {
    const target = sameOriginTarget(anchor, current);
    if (target === null) {
      continue;
    }
    const segments = target.pathname.split("/").filter(Boolean);
    const slug = segments.at(-1);
    if (
      segments.length < 2 ||
      segments[0] !== section ||
      !isSeriesSlug(slug, sections)
    ) {
      continue;
    }
    const text = textOf(anchor);
    if (!text || !tokensRoughlyMatch(text, slug)) {
      continue;
    }
    const slugTokens = normalizeTokens(slug);
    if (!titleNames(title, slugTokens)) {
      continue;
    }
    if (!best || slugTokens.length > best.tokens) {
      best = {
        path: withTrailingSlash(target.pathname),
        text,
        tokens: slugTokens.length,
      };
    }
  }
  return best && { path: best.path, text: best.text };
}

// Where a series name stops inside a title, once accents and punctuation are
// gone (normalizeTokens): a chapter word, a language label, or nothing more.
const NAME_END = /^(?:$|cap|ch|chapter|ep|episodio|espanol|online)/;

/** Whether the normalized title carries these tokens as a whole name. */
function titleNames(title: string, tokens: readonly string[]): boolean {
  if (tokens.length === 0) {
    return false;
  }
  const phrase = tokens.join(" ");
  let from = 0;
  for (;;) {
    const at = title.indexOf(phrase, from);
    if (at === -1) {
      return false;
    }
    const startsWord = at === 0 || title[at - 1] === " ";
    const rest = title.slice(at + phrase.length);
    if (startsWord && (rest === "" || rest.startsWith(" "))) {
      if (NAME_END.test(rest.trimStart())) {
        return true;
      }
    }
    from = at + 1;
  }
}

function sameOriginTarget(anchor: Element, current: URL): URL | null {
  const href = anchor.getAttribute("href");
  if (!href) {
    return null;
  }
  try {
    const target = new URL(href, current);
    return target.origin === current.origin ? target : null;
  } catch {
    return null;
  }
}

function textOf(element: Element): string {
  return element.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function selectorText(doc: Document, selector: string): string | null {
  let element: Element | null;
  try {
    element = doc.querySelector(selector);
  } catch {
    // An invalid selector in the catalogue: as if there were no hint.
    return null;
  }
  const text = element === null ? "" : textOf(element);
  return text ? text : null;
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
