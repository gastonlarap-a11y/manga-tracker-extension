import type { PageSignals } from "./page-signals";
import { normalizeTokens } from "./text";

// Auto-send threshold (project plan, phase 6): below this the page is ignored
// until the calibration overlay (phase 7) exists.
export const CONFIDENCE_THRESHOLD = 0.7;

export type Detection =
  | {
      detected: true;
      mangaName: string;
      chapterLabel: string;
      confidence: number;
    }
  | {
      detected: false;
      reason: "no-chapter-in-url" | "no-title" | "no-chapter-in-title";
    };

type TitleSource =
  | "og"
  | "twitter"
  | "series-link"
  | "heading"
  | "document-title"
  | "url-slug";

// Confidence points are integer hundredths (summed exactly, then /100) so the
// totals never drift into float noise.
const CHAPTER_BASE_CONFIDENCE = 45;
// A title that explicitly names the chapter ("Capítulo N") is strong evidence
// on its own, whichever source carried it.
const TITLE_CHAPTER_BONUS = 10;
const TITLE_CONFIDENCE: Record<TitleSource, number> = {
  og: 35,
  twitter: 30,
  // Anchor text validated against the series slug in its own href — as
  // trustworthy as og, and immune to broken <title>/og tags (mhscans).
  "series-link": 35,
  heading: 25,
  "document-title": 20,
  // Humanized slug: right series, but lowercase and accent-less — enough to
  // reach the threshold exactly, no more.
  "url-slug": 25,
};

const CHAPTER_URL_PATTERNS: RegExp[] = [
  /\/cap(?:itulo)?[/-](\d+(?:[.,]\d+)?)/i,
  /\/chapter[/-](\d+(?:[.,]\d+)?)/i,
  /\/ch[/-](\d+(?:[.,]\d+)?)/i,
  /\/c\/(\d+(?:[.,]\d+)?)/i,
  // Reader-verb segment carrying the chapter number directly (lectorxd:
  // /manhua/<slug>/leer/56). Last so cap/chapter/ch/c keep first claim on
  // any ambiguous path.
  /\/(?:leer|lector|ver|read|reader|viewer)(?:_\w+)?[/-](\d+(?:[.,]\d+)?)(?:\/|$)/i,
];

// Reader-style path segment, at any depth: root-level SPAs (manhwaweb:
// /leer/, /leer_18/) and series-nested readers (lectorxd: /manhua/<slug>/leer/)
// whose URLs may carry internal ids instead of chapter numbers.
//
// A segment that literally says "chapter" belongs here too, even though
// CHAPTER_URL_PATTERNS already claims it when a number follows: on mangadex the
// id is a uuid (/chapter/e3d4e69e-…), so the number never comes, and the page
// was gated out for having no chapter in its url — while its og:title said
// "… - Ch. 107 -" all along. Naming the segment is the evidence; the number is
// only one way of confirming it.
const READER_PATH_PATTERN =
  /\/(?:leer|lector|read|reader|ver|viewer|cap[íi]tulo|chapter|cap|ch)(?:_\w+)?\//i;

// No real chapter needs more integer digits than this; longer URL numbers are
// internal ids (olympus: /capitulo/130729/, ikigai: /capitulo/118774…393/).
const MAX_URL_CHAPTER_DIGITS = 4;

// Longest alternatives first so "capítulo" is not half-matched as "cap".
const CHAPTER_WORDS = "(?:cap[íi]tulo|chapter|cap\\.?|ch\\.?)";

// Path segments that name a site section, never a series
// (/series/<slug>/capitulo-89/ → "series" is not the manga).
const SECTION_SEGMENTS = new Set([
  "series",
  "serie",
  "manga",
  "mangas",
  "manhwa",
  "manhwas",
  "manhua",
  "comic",
  "comics",
  "leer",
  "lector",
  "read",
  "reader",
  "ver",
  "viewer",
]);

export function detectFromHeuristics(signals: PageSignals): Detection {
  // A catalog/home page has neither a chapter marker in its URL nor a
  // reader-style path, so it never produces an event.
  const urlChapter = extractChapterFromUrl(signals.url);
  if (urlChapter === null && !isReaderPath(signals.url)) {
    return { detected: false, reason: "no-chapter-in-url" };
  }

  const title = pickTitle(signals);
  if (title === null) {
    return { detected: false, reason: "no-title" };
  }

  // The URL gates "is this a chapter page", but its number can be an internal
  // id (e.g. olympus: /capitulo/<id>/ with the real chapter in the title), so
  // the human-facing title wins when it names a chapter. Implausibly long URL
  // numbers are ids, never chapters — like reader paths, they need the title
  // to vouch for the chapter.
  const titleChapter = extractChapterFromTitle(title.value);
  const trustedUrlChapter =
    urlChapter !== null && isPlausibleChapter(urlChapter) ? urlChapter : null;
  const chapterNumber = titleChapter ?? trustedUrlChapter;
  if (chapterNumber === null) {
    return { detected: false, reason: "no-chapter-in-title" };
  }

  const mangaName = cleanMangaName(
    title.value,
    chapterNumber,
    extractSeriesSlug(signals.url),
  );
  if (mangaName.length === 0) {
    return { detected: false, reason: "no-title" };
  }

  const points =
    CHAPTER_BASE_CONFIDENCE +
    TITLE_CONFIDENCE[title.source] +
    (titleChapter !== null ? TITLE_CHAPTER_BONUS : 0);

  return {
    detected: true,
    mangaName,
    chapterLabel: `Cap. ${chapterNumber}`,
    confidence: points / 100,
  };
}

export function extractChapterFromUrl(url: string): string | null {
  const pathname = pathnameOf(url);
  if (pathname === null) {
    return null;
  }
  for (const pattern of CHAPTER_URL_PATTERNS) {
    const match = pattern.exec(pathname);
    if (match?.[1]) {
      return match[1].replace(",", ".");
    }
  }
  return null;
}

export function isReaderPath(url: string): boolean {
  const pathname = pathnameOf(url);
  return pathname !== null && READER_PATH_PATTERN.test(pathname);
}

function isPlausibleChapter(chapter: string): boolean {
  const integerPart = chapter.split(".")[0] ?? chapter;
  return integerPart.length <= MAX_URL_CHAPTER_DIGITS;
}

// Where the series ends and the chapter begins: the path up to and including
// the segment right before the chapter marker (/series/<slug>/capitulo-89/ →
// slug "<slug>", prefix "/series/<slug>"). Section names and numeric ids are
// not a series.
//
// The two callers below both need this split — one for the name, one for the
// URL — and they must never disagree about it, so it is computed once here.
function seriesPathPrefix(
  url: string,
): { origin: string; prefix: string; slug: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  for (const pattern of CHAPTER_URL_PATTERNS) {
    const match = pattern.exec(parsed.pathname);
    if (match?.[1]) {
      const prefix = parsed.pathname.slice(0, match.index);
      const slug = prefix.split("/").filter(Boolean).at(-1);
      if (
        slug === undefined ||
        SECTION_SEGMENTS.has(slug.toLowerCase()) ||
        !/[a-z]/i.test(slug)
      ) {
        return null;
      }
      return { origin: parsed.origin, prefix, slug };
    }
  }
  return null;
}

// The path segment right before the chapter marker is usually the series slug
// (/series/<slug>/capitulo-89/). Section names and numeric ids are not
// usable as a title.
export function extractSeriesSlug(url: string): string | null {
  return seriesPathPrefix(url)?.slug ?? null;
}

/**
 * The series page this chapter URL hangs off, when the path says where it is
 * (https://lectorxd.com/manhua/<slug>/leer/56 → https://lectorxd.com/manhua/<slug>/).
 *
 * The fallback for `seriesUrlFrom`, which needs an anchor back to the series and
 * so finds nothing on most sites — measured, 1045 of 1047 stored events carried
 * no series key at all. Without one the only identity a series has is its title,
 * so a single bad title does not produce one junk card: it merges whatever else
 * arrives under the same wrong name.
 *
 * Null whenever the path does not say: a reader at the site root
 * (/leer/<slug>_<id>-55) or a chapter id before the series (/capitulo/<id>/<slug>)
 * would otherwise mint a key that two different series share, which is worse
 * than having none.
 */
export function seriesUrlFromChapterPath(url: string): string | null {
  const series = seriesPathPrefix(url);
  if (series === null) {
    return null;
  }
  return `${series.origin}${series.prefix}/`;
}

function humanizeSlug(slug: string): string {
  const words = slug.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  if (words.length === 0) {
    return words;
  }
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function pathnameOf(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

export function extractChapterFromTitle(title: string): string | null {
  const match = new RegExp(
    `\\b${CHAPTER_WORDS}\\s*(\\d+(?:[.,]\\d+)?)`,
    "i",
  ).exec(title);
  const captured = match?.[1];
  return captured ? captured.replace(",", ".") : null;
}

// og:site_name plus the hostname labels identify the site; a title whose
// every token belongs to that identity is branding, not a manga name
// (mhscans: <title> = og:title = "MHScans - MHScans (Oficial)").
function siteIdentityTokens(signals: PageSignals): Set<string> {
  const tokens = new Set<string>();
  if (signals.siteName) {
    for (const token of normalizeTokens(signals.siteName)) {
      tokens.add(token);
    }
  }
  const hostname = hostnameOf(signals.url);
  if (hostname) {
    const labels = hostname.replace(/^www\./, "").split(".");
    labels.pop(); // the TLD never appears inside a manga name
    for (const label of labels) {
      for (const token of normalizeTokens(label)) {
        tokens.add(token);
      }
    }
  }
  return tokens;
}

function isSiteBranding(value: string, identity: Set<string>): boolean {
  if (identity.size === 0) {
    return false;
  }
  const tokens = normalizeTokens(value);
  return tokens.length > 0 && tokens.every((token) => identity.has(token));
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function pickTitle(
  signals: PageSignals,
): { value: string; source: TitleSource } | null {
  const candidates: { value: string; source: TitleSource }[] = [];
  if (signals.ogTitle) {
    candidates.push({ value: signals.ogTitle, source: "og" });
  }
  if (signals.twitterTitle) {
    candidates.push({ value: signals.twitterTitle, source: "twitter" });
  }
  if (signals.seriesLinkTitle) {
    candidates.push({ value: signals.seriesLinkTitle, source: "series-link" });
  }
  if (signals.firstHeading) {
    candidates.push({ value: signals.firstHeading, source: "heading" });
  }
  const documentTitle = signals.documentTitle.trim();
  if (documentTitle) {
    candidates.push({ value: documentTitle, source: "document-title" });
  }
  const slug = extractSeriesSlug(signals.url);
  if (slug) {
    candidates.push({ value: humanizeSlug(slug), source: "url-slug" });
  }
  const identity = siteIdentityTokens(signals);
  const usable = candidates.filter(
    (candidate) => !isSiteBranding(candidate.value, identity),
  );
  // A source naming the chapter beats a higher-priority one that does not:
  // SPA readers often carry the chapter only in document.title while a site
  // logo occupies the h1.
  return (
    usable.find(
      (candidate) => extractChapterFromTitle(candidate.value) !== null,
    ) ??
    usable[0] ??
    null
  );
}

// Sites wrap the title in an imperative call to action or a section label
// (lectorxd: "Leer <Name> Capítulo 56"; manhwa-latino: "MANGA <Name>"). A
// prefix word is only stripped when the URL's own series slug confirms the
// word after it is where the real name starts — genuine titles beginning
// with a prefix-shaped word ("Read or Die" slug "read-or-die", "Manga wo
// Yomeru…" slug "manga-wo-yomeru…") survive untouched. Two passes cover the
// stacked case ("Leer Manga X").
const READER_VERB_TOKENS = new Set(["leer", "lee", "ver", "read", "reading"]);
const SECTION_WORD_TOKENS = new Set([
  "manga",
  "manhwa",
  "manhua",
  "comic",
  "comics",
  "serie",
  "series",
]);
const LEADING_PREFIX_TOKENS = new Set([
  ...READER_VERB_TOKENS,
  ...SECTION_WORD_TOKENS,
]);
const LEADING_PREFIX_MAX_PASSES = 2;

function stripLeadingSlugConfirmedPrefix(
  name: string,
  seriesSlug: string | null,
): string {
  if (seriesSlug === null) {
    return name;
  }
  const slugFirstToken = normalizeTokens(seriesSlug)[0];
  if (slugFirstToken === undefined) {
    return name;
  }
  let current = name;
  for (let pass = 0; pass < LEADING_PREFIX_MAX_PASSES; pass++) {
    const match = /^(\S+)\s+(\S.*)$/.exec(current);
    if (!match) {
      break;
    }
    const [, firstWord, rest] = match;
    const prefixToken = normalizeTokens(firstWord ?? "")[0];
    if (
      prefixToken === undefined ||
      !LEADING_PREFIX_TOKENS.has(prefixToken) ||
      rest === undefined
    ) {
      break;
    }
    if (normalizeTokens(rest)[0] === slugFirstToken) {
      // Confirmed: what follows the prefix is where the slug says the real
      // name starts.
      return rest;
    }
    // Provisional strip — the next leading word may be the one the slug
    // confirms ("Leer Manga X").
    current = rest;
  }
  return name;
}

// The manga name must be stable across chapters and across sites (the API
// dedupes by its normalized slug), so the chapter fragment, site suffix and
// slug-confirmed leading prefix (reader verb / section word) are stripped.
export function cleanMangaName(
  rawTitle: string,
  chapterNumber: string,
  seriesSlug: string | null,
): string {
  let name = rawTitle.split("|")[0] ?? rawTitle;

  const escapedNumber = chapterNumber.replace(".", "[.,]");
  const chapterFragment = `\\b${CHAPTER_WORDS}\\s*${escapedNumber}`;

  const prefixMatch = new RegExp(`^(.*\\S)\\s*${chapterFragment}`, "i").exec(
    name,
  );
  if (prefixMatch?.[1]) {
    // "Name Capítulo N <site junk>" — everything after the chapter fragment
    // is site noise; the manga name is what precedes it.
    name = prefixMatch[1];
  } else {
    // Leading "Capítulo N de X" / "Chapter N of X" also drops the connector.
    const leadingFragment = new RegExp(
      `^\\s*${chapterFragment}\\s*(?:de|del|of)?\\s*[-–—:·]?\\s*`,
      "i",
    );
    name = name.replace(leadingFragment, "");
  }

  // Leftover separators around the removed fragment ("One Piece - " etc.).
  name = name.replace(/\s*[-–—:·]\s*$/g, "").replace(/^\s*[-–—:·]\s*/g, "");
  name = stripLeadingSlugConfirmedPrefix(
    name.replace(/\s+/g, " ").trim(),
    seriesSlug,
  );
  return name.trim();
}
