/**
 * The generic heuristic's vocabulary and thresholds, as one value.
 *
 * Compiled defaults first: they are what every release before 0.2.0 ran with,
 * measured against real reading history, and they keep working with no backend
 * at all. The backend (`GET /api/extension-config`, curated in
 * manga-tracker-api `src/lib/extension-config.ts`) can then **add** to the
 * lists and **replace** the numbers — never remove a default. A remote edit
 * that could take away "capítulo" could stop every site at once; one that adds
 * "episodio" can only teach.
 *
 * Everything remote is data: words, numbers, regex sources. Nothing that
 * arrives here is executed, which is what Manifest V3 requires of an extension
 * and what the Web Store reviews.
 */
import type { DetectionTuningDto } from "../api/types";
import { normalizeTokens } from "./text";

export interface DetectionConfig {
  /** Auto-send threshold: below it a detection is shown, never recorded. */
  confidenceThreshold: number;
  /** How long a page is given to finish rendering before it is read. */
  settleDelayMs: number;
  /** Against the URL path; group 1 is the chapter number. */
  chapterUrlPatterns: readonly RegExp[];
  /** Against the URL path: a reader page, whether or not a number follows. */
  readerPathPatterns: readonly RegExp[];
  /** Regex alternation (no group) of the words a title names a chapter with. */
  chapterWords: string;
  /** Path segments that name a site section, never a series. */
  sectionSegments: ReadonlySet<string>;
  /** Normalized leading title words a site prepends to a manga's name. */
  leadingPrefixTokens: ReadonlySet<string>;
  /** Longer URL numbers are internal ids, never chapters. */
  maxUrlChapterDigits: number;
}

const DEFAULT_CHAPTER_URL_PATTERNS: readonly RegExp[] = [
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
// A segment that literally says "chapter" belongs here too, even though the
// chapter patterns already claim it when a number follows: on mangadex the id
// is a uuid (/chapter/e3d4e69e-…), so the number never comes, and the page was
// gated out for having no chapter in its url — while its og:title said
// "… - Ch. 107 -" all along. Naming the segment is the evidence; the number is
// only one way of confirming it.
const DEFAULT_READER_PATH_PATTERNS: readonly RegExp[] = [
  /\/(?:leer|lector|read|reader|ver|viewer|cap[íi]tulo|chapter|cap|ch)(?:_\w+)?\//i,
];

// Regex fragments, not plain words: "cap[íi]tulo" covers the accent being
// dropped. Order does not decide a match — every use is followed by a number,
// so an alternative that only half-matches backtracks into the next.
const DEFAULT_CHAPTER_WORDS: readonly string[] = [
  "cap[íi]tulo",
  "chapter",
  "cap\\.?",
  "ch\\.?",
];

// /series/<slug>/capitulo-89/ → "series" is not the manga.
const DEFAULT_SECTION_SEGMENTS: readonly string[] = [
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
];

// Sites wrap the title in an imperative call to action or a section label
// (lectorxd: "Leer <Name> Capítulo 56"; manhwa-latino: "MANGA <Name>").
const DEFAULT_LEADING_PREFIXES: readonly string[] = [
  // Reader verbs
  "leer",
  "lee",
  "ver",
  "read",
  "reading",
  // Section words
  "manga",
  "manhwa",
  "manhua",
  "comic",
  "comics",
  "serie",
  "series",
];

/** Bounds a remote number has to fall in to replace its default. */
const MAX_SETTLE_DELAY_MS = 30_000;
/** A remote word longer than this is not a word. */
const MAX_WORD_LENGTH = 40;

export const DEFAULT_DETECTION_CONFIG: DetectionConfig = {
  confidenceThreshold: 0.7,
  settleDelayMs: 2000,
  chapterUrlPatterns: DEFAULT_CHAPTER_URL_PATTERNS,
  readerPathPatterns: DEFAULT_READER_PATH_PATTERNS,
  chapterWords: alternation(DEFAULT_CHAPTER_WORDS),
  sectionSegments: new Set(DEFAULT_SECTION_SEGMENTS),
  leadingPrefixTokens: new Set(DEFAULT_LEADING_PREFIXES),
  maxUrlChapterDigits: 4,
};

/**
 * The defaults with whatever the backend adds, each remote value checked on
 * its own: one malformed regex drops that regex, not the rest of the tuning,
 * and anything that is not the expected shape is as if it had not been sent.
 * `null` — no backend, or one older than this — is the defaults exactly.
 */
export function compileDetectionConfig(
  tuning: DetectionTuningDto | null | undefined,
): DetectionConfig {
  if (tuning === null || tuning === undefined || typeof tuning !== "object") {
    return DEFAULT_DETECTION_CONFIG;
  }
  const extraWords = words(tuning.chapterWords).map(
    (word) => `${escapeRegExp(word)}\\.?`,
  );
  return {
    confidenceThreshold: inRange(tuning.confidenceThreshold, 0, 1, {
      exclusiveMin: true,
    })
      ? tuning.confidenceThreshold
      : DEFAULT_DETECTION_CONFIG.confidenceThreshold,
    settleDelayMs:
      Number.isInteger(tuning.settleDelayMs) &&
      inRange(tuning.settleDelayMs, 0, MAX_SETTLE_DELAY_MS)
        ? tuning.settleDelayMs
        : DEFAULT_DETECTION_CONFIG.settleDelayMs,
    chapterUrlPatterns: [
      ...DEFAULT_CHAPTER_URL_PATTERNS,
      ...regexes(tuning.chapterUrlPatterns).filter(capturesAGroup),
    ],
    readerPathPatterns: [
      ...DEFAULT_READER_PATH_PATTERNS,
      ...regexes(tuning.readerPathPatterns),
    ],
    chapterWords: alternation([...DEFAULT_CHAPTER_WORDS, ...extraWords]),
    sectionSegments: new Set([
      ...DEFAULT_SECTION_SEGMENTS,
      ...words(tuning.sectionSegments).filter((word) => !word.includes("/")),
    ]),
    leadingPrefixTokens: new Set([
      ...DEFAULT_LEADING_PREFIXES,
      ...words(tuning.leadingPrefixes).flatMap((word) =>
        normalizeTokens(word).slice(0, 1),
      ),
    ]),
    maxUrlChapterDigits: DEFAULT_DETECTION_CONFIG.maxUrlChapterDigits,
  };
}

function alternation(fragments: readonly string[]): string {
  return `(?:${fragments.join("|")})`;
}

function inRange(
  value: unknown,
  min: number,
  max: number,
  { exclusiveMin = false }: { exclusiveMin?: boolean } = {},
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    (exclusiveMin ? value > min : value >= min) &&
    value <= max
  );
}

/** The usable strings of a remote list, trimmed and lowercased. */
function words(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0 && item.length <= MAX_WORD_LENGTH);
}

/** The remote regex sources that compile, compiled; the rest dropped. */
function regexes(value: unknown): RegExp[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const compiled: RegExp[] = [];
  for (const source of value) {
    if (typeof source !== "string" || source.length === 0) {
      continue;
    }
    try {
      compiled.push(new RegExp(source, "i"));
    } catch {
      // A malformed pattern is a bug in the catalogue, not a reason to drop
      // the rest of it.
    }
  }
  return compiled;
}

/**
 * Whether a pattern has a group 1 to read the chapter number from. One without
 * would mark a page as a chapter and leave nothing to record as one.
 */
function capturesAGroup(pattern: RegExp): boolean {
  const groups = new RegExp(`${pattern.source}|`).exec("");
  return groups !== null && groups.length > 1;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
