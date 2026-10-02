/**
 * What the backend tells this extension beyond the per-site rules: tuning for
 * the heuristic, the site themes, notices for the popup, and when a chapter
 * counts as read. Fetched by the background only, cached, and served from the
 * cache — the same shape as utils/site-rules.ts, for the same reason: a
 * change here reaches people with the next desktop release, not after a Web
 * Store review.
 *
 * Everything is checked before it is believed. A field of the wrong shape is
 * as if it had not been sent, and a schema version this extension does not
 * know is ignored whole: an old extension must keep detecting with its
 * compiled defaults rather than misread a newer backend.
 */
import { storage } from "#imports";
import { getExtensionConfig } from "./api/client";
import type {
  DetectionTuningDto,
  ExtensionConfigDto,
  ExtensionNoticeDto,
  ReadingSettingsDto,
  SiteThemeDto,
} from "./api/types";

const CACHE_KEY = "local:extensionConfig" as const;

/** The schema this extension reads (`EXTENSION_CONFIG_SCHEMA_VERSION`). */
export const SUPPORTED_SCHEMA_VERSION = 1;

/**
 * Much shorter than the site rules' six hours: the reading settings are
 * changed by a person in the dashboard who expects them to apply now, and a
 * request to localhost every few minutes of reading costs nothing.
 */
export const CONFIG_TTL_MS = 5 * 60 * 1000;

/** What an absent or unreadable answer means: count a page when it is seen. */
export const DEFAULT_READING_SETTINGS: ReadingSettingsDto = {
  readingRequired: false,
  readMinSeconds: 30,
  readMinScrollPercent: 80,
};

type CachedConfig = {
  // Null is an answer too: a backend older than the endpoint said 404, and
  // asking it again on every page would change nothing until it updates.
  config: ExtensionConfigDto | null;
  fetchedAt: number;
};

/**
 * The answer, checked field by field, or null when it is not one this
 * extension can read at all.
 */
export function parseExtensionConfig(body: unknown): ExtensionConfigDto | null {
  if (!isObject(body) || body.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    return null;
  }
  return {
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    minExtensionVersion:
      typeof body.minExtensionVersion === "string"
        ? body.minExtensionVersion
        : "0.0.0",
    detection: parseTuning(body.detection),
    themes: Array.isArray(body.themes)
      ? body.themes.flatMap((theme) => parseTheme(theme) ?? [])
      : [],
    notices: Array.isArray(body.notices)
      ? body.notices.flatMap((notice) => parseNotice(notice) ?? [])
      : [],
    reading: parseReading(body.reading),
  };
}

/** The cached config, however old, or null if none has arrived yet. */
export async function cachedConfig(): Promise<ExtensionConfigDto | null> {
  const cached = await storage.getItem<CachedConfig>(CACHE_KEY);
  return cached?.config ?? null;
}

/**
 * Fetches the config and stores it. A failure leaves a previous copy alone —
 * the backend being away, or mid restart, says nothing about whether it was
 * good. With no copy to keep, a backend too old to have the endpoint (404) is
 * remembered as having nothing, so it is not asked again on every page until
 * that answer goes stale.
 */
export async function refreshConfig(
  now: number = Date.now(),
): Promise<boolean> {
  const result = await getExtensionConfig();
  if (!result.ok) {
    if (result.status === 404 && (await cachedConfig()) === null) {
      await storage.setItem<CachedConfig>(CACHE_KEY, {
        config: null,
        fetchedAt: now,
      });
    }
    return false;
  }
  const config = parseExtensionConfig(result.data);
  if (config === null) {
    return false;
  }
  await storage.setItem<CachedConfig>(CACHE_KEY, { config, fetchedAt: now });
  return true;
}

/**
 * The config to detect with, refreshed behind the reader's back when old.
 * Waits only when there is no copy at all, like the site rules: the first page
 * after an install is the one worth a round trip to localhost.
 */
export async function configForDetection(
  now: number = Date.now(),
): Promise<ExtensionConfigDto | null> {
  const cached = await storage.getItem<CachedConfig>(CACHE_KEY);
  if (cached === null) {
    await refreshConfig(now);
    return await cachedConfig();
  }
  if (now - cached.fetchedAt > CONFIG_TTL_MS) {
    void refreshConfig(now);
  }
  return cached.config;
}

/**
 * Whether this extension is older than the backend says it needs to be, to
 * offer the update in the popup. Numeric per part, so 0.10.0 is newer than
 * 0.9.0; anything unparsable is never "older".
 */
export function isOlderThan(version: string, minimum: string): boolean {
  const own = versionParts(version);
  const wanted = versionParts(minimum);
  if (own === null || wanted === null) {
    return false;
  }
  for (let index = 0; index < 3; index++) {
    const a = own[index] ?? 0;
    const b = wanted[index] ?? 0;
    if (a !== b) {
      return a < b;
    }
  }
  return false;
}

function versionParts(version: string): number[] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  return match ? match.slice(1).map(Number) : null;
}

function parseTuning(value: unknown): DetectionTuningDto {
  const tuning = isObject(value) ? value : {};
  return {
    confidenceThreshold:
      typeof tuning.confidenceThreshold === "number"
        ? tuning.confidenceThreshold
        : null,
    settleDelayMs:
      typeof tuning.settleDelayMs === "number" ? tuning.settleDelayMs : null,
    chapterUrlPatterns: strings(tuning.chapterUrlPatterns),
    readerPathPatterns: strings(tuning.readerPathPatterns),
    chapterWords: strings(tuning.chapterWords),
    sectionSegments: strings(tuning.sectionSegments),
    leadingPrefixes: strings(tuning.leadingPrefixes),
  };
}

function parseTheme(value: unknown): SiteThemeDto | null {
  if (
    !isObject(value) ||
    typeof value.name !== "string" ||
    typeof value.readerMarker !== "string" ||
    value.readerMarker.length === 0
  ) {
    return null;
  }
  return {
    name: value.name,
    readerMarker: value.readerMarker,
    headingSelector: optionalString(value.headingSelector),
    seriesLinkSelector: optionalString(value.seriesLinkSelector),
    nextSelector: optionalString(value.nextSelector),
  };
}

function parseNotice(value: unknown): ExtensionNoticeDto | null {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    typeof value.text !== "string" ||
    value.text.trim().length === 0
  ) {
    return null;
  }
  return {
    id: value.id,
    level: value.level === "warning" ? "warning" : "info",
    text: value.text,
  };
}

function parseReading(value: unknown): ReadingSettingsDto {
  if (!isObject(value) || typeof value.readingRequired !== "boolean") {
    return DEFAULT_READING_SETTINGS;
  }
  return {
    readingRequired: value.readingRequired,
    readMinSeconds: boundedInteger(
      value.readMinSeconds,
      0,
      3600,
      DEFAULT_READING_SETTINGS.readMinSeconds,
    ),
    readMinScrollPercent: boundedInteger(
      value.readMinScrollPercent,
      0,
      100,
      DEFAULT_READING_SETTINGS.readMinScrollPercent,
    ),
  };
}

function boundedInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : fallback;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
