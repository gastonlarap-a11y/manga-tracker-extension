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

export interface HealthResponse {
  status: "ok";
}

export interface ErrorResponse {
  error: string;
}
