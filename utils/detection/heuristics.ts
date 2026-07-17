import type { PageSignals } from "./page-signals";

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

type TitleSource = "og" | "twitter" | "heading" | "document-title";

// Confidence points are integer hundredths (summed exactly, then /100) so the
// totals never drift into float noise.
const CHAPTER_BASE_CONFIDENCE = 45;
// A title that explicitly names the chapter ("Capítulo N") is strong evidence
// on its own, whichever source carried it.
const TITLE_CHAPTER_BONUS = 10;
const TITLE_CONFIDENCE: Record<TitleSource, number> = {
  og: 35,
  twitter: 30,
  heading: 25,
  "document-title": 20,
};

const CHAPTER_URL_PATTERNS: RegExp[] = [
  /\/cap(?:itulo)?[/-](\d+(?:[.,]\d+)?)/i,
  /\/chapter[/-](\d+(?:[.,]\d+)?)/i,
  /\/ch[/-](\d+(?:[.,]\d+)?)/i,
  /\/c\/(\d+(?:[.,]\d+)?)/i,
];

// Reader-style path prefixes used by SPA sites (manhwaweb: /leer/, /leer_18/)
// whose URLs carry internal ids instead of chapter numbers.
const READER_PATH_PATTERN =
  /^\/(?:leer|lector|read|reader|ver|viewer)(?:_\w+)?\//i;

// No real chapter needs more integer digits than this; longer URL numbers are
// internal ids (olympus: /capitulo/130729/, ikigai: /capitulo/118774…393/).
const MAX_URL_CHAPTER_DIGITS = 4;

// Longest alternatives first so "capítulo" is not half-matched as "cap".
const CHAPTER_WORDS = "(?:cap[íi]tulo|chapter|cap\\.?|ch\\.?)";

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

  const mangaName = cleanMangaName(title.value, chapterNumber);
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
  if (signals.firstHeading) {
    candidates.push({ value: signals.firstHeading, source: "heading" });
  }
  const documentTitle = signals.documentTitle.trim();
  if (documentTitle) {
    candidates.push({ value: documentTitle, source: "document-title" });
  }
  // A source naming the chapter beats a higher-priority one that does not:
  // SPA readers often carry the chapter only in document.title while a site
  // logo occupies the h1.
  return (
    candidates.find(
      (candidate) => extractChapterFromTitle(candidate.value) !== null,
    ) ??
    candidates[0] ??
    null
  );
}

// The manga name must be stable across chapters (the API dedupes by its
// normalized slug), so the chapter fragment and site suffix are stripped.
export function cleanMangaName(
  rawTitle: string,
  chapterNumber: string,
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
  return name.replace(/\s+/g, " ").trim();
}
