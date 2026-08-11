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
 */
export interface SiteRuleDto {
  domain: string;
  series: SeriesRuleDto | null;
  titleSelector: string | null;
  chapterSelector: string | null;
  chapterUrlRegex: string | null;
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
