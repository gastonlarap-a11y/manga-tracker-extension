// Hand-duplicated contracts from manga-tracker-api (src/lib/schemas.ts,
// src/modules/events/events.routes.ts, src/lib/http.ts). Project constraint:
// when a contract changes in the API, this file changes in the same commit.

export type MangaStatus = "reading" | "completed" | "dropped";

export interface MangaDto {
  id: string;
  canonicalName: string;
  normalizedSlug: string;
  coverUrl: string | null;
  // Bumped on every cover mutation; clients cache-bust /cover with it.
  coverVersion: number;
  // True once cover bytes are stored locally; false = byte heal pending.
  hasStoredCover: boolean;
  status: MangaStatus;
  tags: string[];
  createdAt: string;
  // The canonical this manga was merged into, or null when it owns its card.
  mergedIntoSlug: string | null;
}

export interface ReadingEventDto {
  id: string;
  mangaId: string;
  chapterLabel: string;
  chapterNumber: number | null;
  sourceUrl: string;
  sourceDomain: string;
  readAt: string;
}

export interface CreateEventBody {
  mangaName: string;
  chapterLabel: string;
  sourceUrl: string;
  coverUrl?: string;
  // The series page this chapter belongs to. The backend derives its own key
  // from it and uses it as identity within the site, so a reformatted <title>
  // no longer splits a series into a second manga.
  seriesUrl?: string;
  // ISO 8601. Only on a reading delivered late from the outbox: when it was
  // read, rather than when it finally arrived. A backend older than the field
  // drops unknown keys, so sending it there is harmless.
  readAt?: string;
}

export interface CreateEventResponse {
  manga: MangaDto;
  event: ReadingEventDto;
}

export interface LibraryEntryDto {
  id: string;
  canonicalName: string;
  normalizedSlug: string;
  coverUrl: string | null;
  coverVersion: number;
  // True once cover bytes are stored locally; false = byte backfill pending.
  hasStoredCover: boolean;
  status: MangaStatus;
  tags: string[];
  reachedChapter: { number: number; label: string } | null;
  lastActivity: { readAt: string; chapterLabel: string } | null;
  lastSourceUrl: string | null;
  readCount: number;
  sourceDomains: string[];
  // How many mangas were merged into this card.
  aliasCount: number;
}

export interface CreateAdapterBody {
  domain: string;
  titleSelector: string;
  chapterSelector?: string;
  chapterUrlRegex?: string;
}

export interface SiteAdapterDto {
  id: string;
  domain: string;
  titleSelector: string;
  chapterSelector: string | null;
  chapterUrlRegex: string | null;
  createdAt: string;
  updatedAt: string;
}

/** How a site's URLs name a series, when the generic heuristics cannot tell. */
export interface SeriesRuleDto {
  /** Matched against the chapter URL; group 1 identifies the series. */
  pattern: string;
  /** Composes the series URL, with `$1` for the captured group. */
  template: string;
  /**
   * Whether the composed URL is a page that exists. False where the identity
   * had to be assembled: good enough to key a series, not to fetch a cover
   * from.
   */
  navigable: boolean;
}

/**
 * Everything the backend knows about one site: the curated rule and, if this
 * machine calibrated the site, its selectors. Either half may be absent.
 *
 * The fields after `chapterUrlRegex` came with backend 0.1.22 and are optional
 * here for that reason: an older backend does not send them, and a copy cached
 * before the backend updated lacks them for up to six hours.
 */
export interface SiteRuleDto {
  domain: string;
  series: SeriesRuleDto | null;
  titleSelector: string | null;
  chapterSelector: string | null;
  chapterUrlRegex: string | null;
  /** Other hosts the site is served from; matched as if they were `domain`. */
  aliases?: string[];
  /** Regexes against the full URL: pages never recorded. */
  ignorePaths?: string[];
  confidenceThreshold?: number | null;
  settleDelayMs?: number | null;
  /** Anchors back to the series page; the last one off this page is taken. */
  seriesLinkSelector?: string | null;
  /** The anchor to the next chapter. */
  nextSelector?: string | null;
}

/**
 * Additions to the heuristic's vocabulary and replacements for its numbers.
 * A null number keeps the compiled default; see utils/detection/config.ts.
 */
export interface DetectionTuningDto {
  confidenceThreshold: number | null;
  settleDelayMs: number | null;
  chapterUrlPatterns: string[];
  readerPathPatterns: string[];
  chapterWords: string[];
  sectionSegments: string[];
  leadingPrefixes: string[];
}

/** A site theme many sites are built on (Madara, MangaThemesia…). */
export interface SiteThemeDto {
  name: string;
  /** Present on a chapter page of this theme, and on nothing else. */
  readerMarker: string;
  /** An element whose text names the series and the chapter. */
  headingSelector: string | null;
  seriesLinkSelector: string | null;
  nextSelector: string | null;
}

export interface ExtensionNoticeDto {
  id: string;
  level: "info" | "warning";
  text: string;
}

/** When a chapter page counts as read; edited from the dashboard. */
export interface ReadingSettingsDto {
  readingRequired: boolean;
  readMinSeconds: number;
  readMinScrollPercent: number;
}

/** `GET /api/extension-config` (manga-tracker-api src/modules/extension). */
export interface ExtensionConfigDto {
  schemaVersion: number;
  minExtensionVersion: string;
  detection: DetectionTuningDto;
  themes: SiteThemeDto[];
  notices: ExtensionNoticeDto[];
  reading: ReadingSettingsDto;
}

/** `GET /api/library/page`: one page of cards and where the next begins. */
export interface LibraryPageDto {
  items: LibraryEntryDto[];
  nextCursor: string | null;
}

export interface HealthResponse {
  status: "ok";
  /**
   * Optional only for compatibility with a backend older than the release that
   * added it. Port discovery treats it as mandatory on every port but 5150 —
   * see utils/api/discovery.ts.
   */
  service?: string;
}

export interface ErrorResponse {
  error: string;
}
