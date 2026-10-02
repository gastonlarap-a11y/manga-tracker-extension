import { DEFAULT_DETECTION_CONFIG, type DetectionConfig } from "./config";
import type { PageSignals } from "./page-signals";
import { normalizeTokens } from "./text";

// Auto-send threshold: below it a detection is shown in the popup and never
// recorded. The compiled default; the backend may replace it, globally or for
// one site (utils/detection/config.ts).
export const CONFIDENCE_THRESHOLD =
  DEFAULT_DETECTION_CONFIG.confidenceThreshold;

export type Detection =
  | {
      detected: true;
      mangaName: string;
      chapterLabel: string;
      confidence: number;
    }
  | {
      detected: false;
      reason:
        | "no-chapter-in-url"
        | "no-title"
        | "no-chapter-in-title"
        // The site's rule names this page as one that looks like a chapter
        // and is not (a "latest chapters" listing, a preview).
        | "ignored-path";
    };

type TitleSource =
  | "theme-heading"
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
  // The element the site's theme always puts the series and chapter in
  // (Madara's #chapter-heading): as deliberate as og, and present on sites
  // whose og:title is the site's own name.
  "theme-heading": 35,
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

// The URL patterns, reader segments, chapter words, section names and leading
// prefixes this heuristic reads with live in ./config.ts, where the backend can
// add to them. Every function below takes that config, defaulting to the
// compiled one.

export function detectFromHeuristics(
  signals: PageSignals,
  config: DetectionConfig = DEFAULT_DETECTION_CONFIG,
): Detection {
  // A catalog/home page has neither a chapter marker in its URL nor a
  // reader-style path, so it never produces an event — unless the site's
  // theme says this is its reader (MangaThemesia's `/<slug>-capitulo-12/`
  // carries the chapter mid-segment, where no URL pattern looks).
  const urlChapter = extractChapterFromUrl(signals.url, config);
  if (
    urlChapter === null &&
    !isReaderPath(signals.url, config) &&
    !signals.themeReader
  ) {
    return { detected: false, reason: "no-chapter-in-url" };
  }

  const candidates = titleCandidates(signals, config);
  // A source naming the chapter beats a higher-priority one that does not:
  // SPA readers often carry the chapter only in document.title while a site
  // logo occupies the h1.
  const title =
    candidates.find(
      (candidate) => extractChapterFromTitle(candidate.value, config) !== null,
    ) ?? candidates[0];
  if (title === undefined) {
    return { detected: false, reason: "no-title" };
  }

  // The URL gates "is this a chapter page", but its number can be an internal
  // id (e.g. olympus: /capitulo/<id>/ with the real chapter in the title), so
  // the human-facing title wins when it names a chapter. Implausibly long URL
  // numbers are ids, never chapters — like reader paths, they need the title
  // to vouch for the chapter.
  const titleChapter = extractChapterFromTitle(title.value, config);
  const trustedUrlChapter =
    urlChapter !== null && isPlausibleChapter(urlChapter, config)
      ? urlChapter
      : null;
  const chapterNumber = titleChapter ?? trustedUrlChapter;
  if (chapterNumber === null) {
    return { detected: false, reason: "no-chapter-in-title" };
  }

  const name = nameFor(signals, title, candidates, chapterNumber, config);
  if (name === null) {
    return { detected: false, reason: "no-title" };
  }

  const points =
    CHAPTER_BASE_CONFIDENCE +
    TITLE_CONFIDENCE[name.source] +
    (titleChapter !== null ? TITLE_CHAPTER_BONUS : 0);

  return {
    detected: true,
    mangaName: name.value,
    chapterLabel: `Cap. ${chapterNumber}`,
    confidence: points / 100,
  };
}

type TitleCandidate = { value: string; source: TitleSource };

/**
 * Where the manga's name comes from, which is not always where the chapter
 * did.
 *
 * - A series link the theme or the site's rule pointed at is the series
 *   page's own name for itself, and wins: a chapter heading may abbreviate it
 *   (uchuujinmangas: "Villanos Correctamente Capítulo 55" for "Cómo Criar
 *   Villanos Correctamente").
 * - Otherwise, the source that named the chapter, cleaned.
 * - When cleaning leaves nothing — the source was the chapter alone, as
 *   Madara's #chapter-heading often is ("Capitulo 48") — the next source that
 *   still has a name in it, the validated series link first.
 *
 * The URL's own slug, or the series link's when the URL carries none
 * (heavenmanga: /manga/leer/293702), confirms where the real name starts once
 * a leading "Leer" is taken off.
 */
function nameFor(
  signals: PageSignals,
  title: TitleCandidate,
  candidates: readonly TitleCandidate[],
  chapterNumber: string,
  config: DetectionConfig,
): TitleCandidate | null {
  // Among the candidates only when it is not the site's own branding, and
  // never when it names a chapter — a selector that lands on the chapter's
  // own breadcrumb would otherwise name the manga "Capítulo 12".
  const hinted = signals.seriesLinkHinted
    ? candidates.find((candidate) => candidate.source === "series-link")
    : undefined;
  if (hinted && extractChapterFromTitle(hinted.value, config) === null) {
    return hinted;
  }
  const slug = extractSeriesSlug(signals.url, config) ?? signals.seriesLinkSlug;
  const ordered = [
    title,
    ...candidates.filter((candidate) => candidate.source === "series-link"),
    ...candidates.filter(
      (candidate) => candidate !== title && candidate.source !== "series-link",
    ),
  ];
  for (const candidate of ordered) {
    const value = cleanMangaName(candidate.value, chapterNumber, slug, config);
    if (value.length > 0) {
      return { value, source: candidate.source };
    }
  }
  return null;
}

export function extractChapterFromUrl(
  url: string,
  config: DetectionConfig = DEFAULT_DETECTION_CONFIG,
): string | null {
  const pathname = pathnameOf(url);
  if (pathname === null) {
    return null;
  }
  for (const pattern of config.chapterUrlPatterns) {
    const match = pattern.exec(pathname);
    if (match?.[1]) {
      return match[1].replace(",", ".");
    }
  }
  return null;
}

export function isReaderPath(
  url: string,
  config: DetectionConfig = DEFAULT_DETECTION_CONFIG,
): boolean {
  const pathname = pathnameOf(url);
  return (
    pathname !== null &&
    config.readerPathPatterns.some((pattern) => pattern.test(pathname))
  );
}

// No real chapter needs more integer digits than the config allows; longer URL
// numbers are internal ids (olympus: /capitulo/130729/, ikigai:
// /capitulo/118774…393/).
function isPlausibleChapter(chapter: string, config: DetectionConfig): boolean {
  const integerPart = chapter.split(".")[0] ?? chapter;
  return integerPart.length <= config.maxUrlChapterDigits;
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
  config: DetectionConfig,
): { origin: string; prefix: string; slug: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  for (const pattern of config.chapterUrlPatterns) {
    const match = pattern.exec(parsed.pathname);
    if (match?.[1]) {
      const prefix = parsed.pathname.slice(0, match.index);
      const slug = prefix.split("/").filter(Boolean).at(-1);
      if (
        slug === undefined ||
        config.sectionSegments.has(slug.toLowerCase()) ||
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
export function extractSeriesSlug(
  url: string,
  config: DetectionConfig = DEFAULT_DETECTION_CONFIG,
): string | null {
  return seriesPathPrefix(url, config)?.slug ?? null;
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
export function seriesUrlFromChapterPath(
  url: string,
  config: DetectionConfig = DEFAULT_DETECTION_CONFIG,
): string | null {
  const series = seriesPathPrefix(url, config);
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

export function extractChapterFromTitle(
  title: string,
  config: DetectionConfig = DEFAULT_DETECTION_CONFIG,
): string | null {
  const match = new RegExp(
    `\\b${config.chapterWords}\\s*(\\d+(?:[.,]\\d+)?)`,
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

/** Every title the page offers, best first, the site's own branding left out. */
function titleCandidates(
  signals: PageSignals,
  config: DetectionConfig,
): TitleCandidate[] {
  const candidates: TitleCandidate[] = [];
  if (signals.themeHeading) {
    candidates.push({ value: signals.themeHeading, source: "theme-heading" });
  }
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
  const slug = extractSeriesSlug(signals.url, config);
  if (slug) {
    candidates.push({ value: humanizeSlug(slug), source: "url-slug" });
  }
  const identity = siteIdentityTokens(signals);
  return candidates.filter(
    (candidate) => !isSiteBranding(candidate.value, identity),
  );
}

// Sites wrap the title in an imperative call to action or a section label
// (lectorxd: "Leer <Name> Capítulo 56"; manhwa-latino: "MANGA <Name>"). A
// prefix word (config.leadingPrefixTokens) is only stripped when the series
// slug confirms the word after it is where the real name starts — genuine
// titles beginning with a prefix-shaped word ("Read or Die" slug
// "read-or-die", "Manga wo Yomeru…" slug "manga-wo-yomeru…") survive
// untouched. Two passes cover the stacked case ("Leer Manga X").
const LEADING_PREFIX_MAX_PASSES = 2;

function stripLeadingSlugConfirmedPrefix(
  name: string,
  seriesSlug: string | null,
  config: DetectionConfig,
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
      !config.leadingPrefixTokens.has(prefixToken) ||
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
  config: DetectionConfig = DEFAULT_DETECTION_CONFIG,
): string {
  let name = rawTitle.split("|")[0] ?? rawTitle;

  const escapedNumber = chapterNumber.replace(".", "[.,]");
  const chapterFragment = `\\b${config.chapterWords}\\s*${escapedNumber}`;

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
    config,
  );
  return name.trim();
}
