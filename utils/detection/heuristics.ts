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
  | { detected: false; reason: "no-chapter-in-url" | "no-title" };

type TitleSource = "og" | "twitter" | "heading" | "document-title";

// A catalog/home page has no chapter marker in its URL, so it never produces
// an event — chapter presence is the gate, title quality sets the score.
const CHAPTER_BASE_CONFIDENCE = 0.45;
const TITLE_CONFIDENCE: Record<TitleSource, number> = {
  og: 0.35,
  twitter: 0.3,
  heading: 0.25,
  "document-title": 0.2,
};

const CHAPTER_URL_PATTERNS: RegExp[] = [
  /\/cap(?:itulo)?[/-](\d+(?:[.,]\d+)?)/i,
  /\/chapter[/-](\d+(?:[.,]\d+)?)/i,
  /\/ch[/-](\d+(?:[.,]\d+)?)/i,
  /\/c\/(\d+(?:[.,]\d+)?)/i,
];

// Longest alternatives first so "capítulo" is not half-matched as "cap".
const CHAPTER_WORDS = "(?:cap[íi]tulo|chapter|cap\\.?|ch\\.?)";

export function detectFromHeuristics(signals: PageSignals): Detection {
  const urlChapter = extractChapterFromUrl(signals.url);
  if (urlChapter === null) {
    return { detected: false, reason: "no-chapter-in-url" };
  }

  const title = pickTitle(signals);
  if (title === null) {
    return { detected: false, reason: "no-title" };
  }

  // The URL gates "is this a chapter page", but its number can be an internal
  // id (e.g. olympus: /capitulo/<id>/ with the real chapter in the title), so
  // the human-facing title wins when it names a chapter.
  const chapterNumber = extractChapterFromTitle(title.value) ?? urlChapter;

  const mangaName = cleanMangaName(title.value, chapterNumber);
  if (mangaName.length === 0) {
    return { detected: false, reason: "no-title" };
  }

  return {
    detected: true,
    mangaName,
    chapterLabel: `Cap. ${chapterNumber}`,
    confidence: CHAPTER_BASE_CONFIDENCE + TITLE_CONFIDENCE[title.source],
  };
}

export function extractChapterFromUrl(url: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
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
  if (signals.ogTitle) {
    return { value: signals.ogTitle, source: "og" };
  }
  if (signals.twitterTitle) {
    return { value: signals.twitterTitle, source: "twitter" };
  }
  if (signals.firstHeading) {
    return { value: signals.firstHeading, source: "heading" };
  }
  const documentTitle = signals.documentTitle.trim();
  if (documentTitle) {
    return { value: documentTitle, source: "document-title" };
  }
  return null;
}

// The manga name must be stable across chapters (the API dedupes by its
// normalized slug), so the chapter fragment and site suffix are stripped.
export function cleanMangaName(
  rawTitle: string,
  chapterNumber: string,
): string {
  let name = rawTitle.split("|")[0] ?? rawTitle;

  const escapedNumber = chapterNumber.replace(".", "[.,]");
  // Leading "Capítulo N de X" / "Chapter N of X" also drops the connector.
  const leadingFragment = new RegExp(
    `^\\s*${CHAPTER_WORDS}\\s*${escapedNumber}\\s*(?:de|del|of)?\\s*[-–—:·]?\\s*`,
    "i",
  );
  name = name.replace(leadingFragment, "");
  const chapterFragment = new RegExp(
    `${CHAPTER_WORDS}\\s*${escapedNumber}`,
    "gi",
  );
  name = name.replace(chapterFragment, "");

  // Leftover separators around the removed fragment ("One Piece - " etc.).
  name = name.replace(/\s*[-–—:·]\s*$/g, "").replace(/^\s*[-–—:·]\s*/g, "");
  return name.replace(/\s+/g, " ").trim();
}
