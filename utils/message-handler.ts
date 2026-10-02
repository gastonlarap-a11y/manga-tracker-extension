import { browser } from "#imports";
import type { ApiResult } from "./api/client";
import {
  createAdapter,
  createReadingEvent,
  getLibrary,
  getLibraryForSite,
  getLibraryPage,
  getManga,
  getRecentlyRead,
  neverReachedServer,
  pingHealth,
  setMangaCover,
  uploadMangaCoverImage,
} from "./api/client";
import { resolveBaseUrl } from "./api/discovery";
import type {
  CreateAdapterBody,
  CreateEventBody,
  CreateEventResponse,
  LibraryEntryDto,
  MangaDto,
} from "./api/types";
import {
  decodeBase64ToBytes,
  fetchCoverImageBytes,
  MAX_COVER_IMAGE_BYTES,
} from "./cover-capture";
import type { CoverRect } from "./cover-pixels";
import { captureCoverFromVisibleTab } from "./cover-pixels";
import {
  getDetection,
  recordCoverHeal,
  recordDelivery,
  recordDetection,
} from "./detection-log";
import { selectorsForDetection } from "./detection-selectors";
import {
  type ContentCommand,
  deliveryOf,
  type MessageResponses,
  type RecordEventResponse,
  type RuntimeMessage,
} from "./messages";
import { enqueue, flushOutbox, queuedReadings } from "./outbox";
import {
  cachedConfig,
  configForDetection,
  refreshConfig,
} from "./remote-config";
import {
  ensureDetectorRegistered,
  registerSite,
  unregisterSite,
} from "./site-registration";
import { rulesForDetection } from "./site-rules";
import { holdReason } from "./tracking-prefs";

const CALIBRATION_SCRIPT = "/content-scripts/calibration.js" as const;

/** How many series "Seguir leyendo" offers. */
export const RECENT_READING_COUNT = 5;

// What the background needs to know about the sender's tab: the window to
// screenshot, whether the tab is the one actually on screen, and whether it
// is a private window.
export interface SenderTabInfo {
  windowId?: number;
  active?: boolean;
  incognito?: boolean;
}

// Business logic behind the background service worker; the entrypoint only
// wires this to browser.runtime.onMessage (mirrors the API's routes/service
// split). senderTabId is the tab the message came from (content scripts).
export function handleMessage(
  message: RuntimeMessage,
  senderTabId?: number,
  senderTab?: SenderTabInfo,
): Promise<MessageResponses[RuntimeMessage["kind"]]> {
  switch (message.kind) {
    case "ping":
      return pingHealth();
    case "get-selectors":
      return selectorsForDetection(message.domain);
    case "get-site-rules":
      return rulesForDetection();
    case "record-event":
      return recordEvent(message.payload, senderTab?.incognito === true);
    case "record-manual":
      return recordManual(message.tabId, message.payload);
    case "get-extension-config":
      return configForDetection();
    case "refresh-extension-config":
      return refreshConfig().then(() => cachedConfig());
    case "get-recent-reading":
      return recentReading();
    case "get-backend-url":
      return resolveBaseUrl().then((baseUrl) => ({ baseUrl }));
    case "register-site":
      return registerSite(message.originPattern, message.tabId);
    case "unregister-site":
      return unregisterSite(message.originPattern);
    case "ensure-site-registered":
      return ensureDetectorRegistered(message.originPatterns, message.tabId);
    case "report-detection": {
      if (senderTabId !== undefined) {
        recordDetection(senderTabId, {
          url: message.url,
          detection: message.detection,
          ...(message.facts ? { facts: message.facts } : {}),
        });
      }
      return Promise.resolve(null);
    }
    case "report-delivery": {
      if (senderTabId !== undefined) {
        recordDelivery(senderTabId, message.url, message.delivery);
      }
      return Promise.resolve(null);
    }
    case "report-cover-heal": {
      if (senderTabId !== undefined) {
        recordCoverHeal(senderTabId, message.url, message.coverHeal);
      }
      return Promise.resolve(null);
    }
    case "get-detection":
      return Promise.resolve(getDetection(message.tabId));
    case "start-calibration":
      return startCalibration(message.tabId);
    case "save-adapter":
      return saveAdapter(message.body, senderTabId);
    case "get-library-for-site":
      return getLibraryForSite(message.domain);
    case "get-outbox":
      return queuedReadings().then((queue) => ({ pending: queue.length }));
    case "set-cover":
      return setCoverWithBytes(message.mangaId, message.coverUrl);
    case "backfill-covers":
      return backfillMissingCovers().then(() => null);
    case "upload-cover-bytes":
      return uploadCoverBase64(
        message.mangaId,
        message.base64,
        message.contentType,
      );
    case "capture-cover-pixels":
      return captureCoverPixels(
        message.mangaId,
        message.rect,
        message.dpr,
        senderTab,
      );
  }
}

// Bytes fetched by the content script in the page's own context (same-site,
// so the CDN's bot protection lets it through) — full quality, unlike the
// pixel fallback.
async function uploadCoverBase64(
  mangaId: string,
  base64: string,
  contentType: string,
): Promise<ApiResult<null>> {
  if (!contentType.startsWith("image/")) {
    return { ok: false, error: "Invalid cover payload" };
  }
  const bytes = decodeBase64ToBytes(base64);
  if (
    bytes === null ||
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_COVER_IMAGE_BYTES
  ) {
    return { ok: false, error: "Invalid cover payload" };
  }
  const uploaded = await uploadMangaCoverImage(mangaId, bytes, contentType);
  return uploaded.ok ? { ok: true, data: null } : uploaded;
}

// Pixel fallback: screenshot the sender's visible tab and crop the rendered
// cover. Guarded here, not by the backend — which stores whatever bytes it is
// sent — against downgrading a cover already stored at full quality with a
// screenshot, and tab-side (only the on-screen tab can be captured). The check
// asks for the one manga, never for the whole library.
async function captureCoverPixels(
  mangaId: string,
  rect: CoverRect,
  dpr: number,
  senderTab?: SenderTabInfo,
): Promise<ApiResult<null>> {
  if (senderTab?.active !== true || senderTab.windowId === undefined) {
    return { ok: false, error: "Tab is not visible" };
  }
  const manga = await getManga(mangaId);
  if (!manga.ok) {
    return manga.status === 404
      ? { ok: false, error: "Manga not found" }
      : manga;
  }
  if (manga.data.hasStoredCover) {
    return { ok: true, data: null };
  }
  const image = await captureCoverFromVisibleTab(senderTab.windowId, rect, dpr);
  if (!image) {
    return { ok: false, error: "Pixel capture failed" };
  }
  const uploaded = await uploadMangaCoverImage(
    mangaId,
    image.bytes,
    image.contentType,
  );
  return uploaded.ok ? { ok: true, data: null } : uploaded;
}

// Both cover paths follow up a stored coverUrl with a byte capture, awaited
// inside the handler: an MV3 service worker may be killed once the message
// port closes, so fire-and-forget could die mid-fetch.
/**
 * Records a reading, keeps it when the backend is not there, and — once one
 * gets through — sends whatever was kept before it.
 */
async function recordEvent(
  payload: CreateEventBody,
  incognito: boolean,
): Promise<RecordEventResponse> {
  // Checked here, where every reading passes, rather than in each detector:
  // a detector loaded before the pause was turned on must obey it too.
  const held = await holdReason(incognito);
  if (held !== null) {
    return {
      ok: false,
      error:
        held === "paused"
          ? "El tracking está en pausa."
          : "Las ventanas privadas no se guardan.",
      held,
    };
  }
  const result = await recordEventWithCover(payload);
  if (neverReachedServer(result)) {
    try {
      await enqueue(payload);
    } catch (cause) {
      // Keeping it failed too. The honest answer is the original failure:
      // saying "queued" here would promise a send that will never happen.
      console.error("[manga-tracker] could not queue a reading", cause);
      return result;
    }
    return { ok: false, error: result.error, queued: true };
  }
  // It answered, so it is back. Not awaited: this reading's own answer should
  // not wait on everything that queued up before it.
  void flushReadings();
  return result;
}

/**
 * "Guardar a mano": a reading someone typed in the popup, for a page detection
 * missed or misread. Recorded like any other — the outbox, the pause and the
 * private-window rule all apply — and logged against the tab so the popup and
 * the badge say what became of it.
 */
async function recordManual(
  tabId: number,
  payload: CreateEventBody,
): Promise<RecordEventResponse> {
  let incognito = false;
  try {
    incognito = (await browser.tabs.get(tabId)).incognito;
  } catch {
    // The tab closed under the popup; the reading is still the user's.
  }
  const previous = getDetection(tabId);
  recordDetection(tabId, {
    url: payload.sourceUrl,
    detection: {
      detected: true,
      mangaName: payload.mangaName,
      chapterLabel: payload.chapterLabel,
      confidence: 1,
    },
    ...(previous?.url === payload.sourceUrl && previous.facts
      ? { facts: previous.facts }
      : {}),
  });
  const result = await recordEvent(payload, incognito);
  recordDelivery(tabId, payload.sourceUrl, deliveryOf(result));
  return result;
}

/**
 * The series read most recently. A backend older than the paged library
 * (before 0.1.19) answers 404, and gets the whole library sorted here
 * instead — slower, and only ever on a machine that has not updated.
 */
async function recentReading(): Promise<ApiResult<LibraryEntryDto[]>> {
  const page = await getRecentlyRead(RECENT_READING_COUNT);
  if (page.ok) {
    return { ok: true, data: page.data.items };
  }
  if (page.status !== 404) {
    return page;
  }
  const library = await getLibrary();
  if (!library.ok) {
    return library;
  }
  const readAt = (entry: LibraryEntryDto) =>
    entry.lastActivity ? Date.parse(entry.lastActivity.readAt) : 0;
  return {
    ok: true,
    data: library.data
      .filter((entry) => entry.status === "reading")
      .sort((a, b) => readAt(b) - readAt(a))
      .slice(0, RECENT_READING_COUNT),
  };
}

/**
 * Drains the outbox, capturing covers the way a live reading does. The one
 * entry point for the alarm, startup and a reading that got through.
 */
export async function flushReadings(): Promise<void> {
  try {
    const flushed = await flushOutbox(recordEventWithCover);
    if (flushed.sent + flushed.refused > 0) {
      console.info("[manga-tracker] outbox drained", flushed);
    }
  } catch (cause) {
    console.error("[manga-tracker] outbox flush failed", cause);
  }
}

async function recordEventWithCover(
  payload: CreateEventBody,
): Promise<ApiResult<CreateEventResponse>> {
  const result = await createReadingEvent(payload);
  if (
    result.ok &&
    payload.coverUrl !== undefined &&
    result.data.manga.coverUrl === payload.coverUrl
  ) {
    // Only when THIS coverUrl won server-side (first cover wins).
    await captureCoverBytes(result.data.manga.id, payload.coverUrl);
  }
  return result;
}

async function setCoverWithBytes(
  mangaId: string,
  coverUrl: string,
): Promise<ApiResult<MangaDto>> {
  const result = await setMangaCover(mangaId, coverUrl);
  if (result.ok && result.data.coverUrl === coverUrl) {
    await captureCoverBytes(mangaId, coverUrl);
  }
  return result;
}

// Best-effort: the coverUrl is already stored; bytes only make it immune to
// CDN blocking and site death. Failures keep the URL-proxy behavior. Without
// a granted host permission the fetch is guaranteed to fail with a noisy
// CORS error in the worker console, so it is skipped upfront.
async function captureCoverBytes(
  mangaId: string,
  coverUrl: string,
): Promise<void> {
  if (!(await coverOriginPermitted(coverUrl))) {
    return;
  }
  const image = await fetchCoverImageBytes(coverUrl);
  if (!image) {
    return;
  }
  await uploadMangaCoverImage(mangaId, image.bytes, image.contentType);
}

/** How many cards the cover backfill reads per request. */
export const BACKFILL_PAGE_SIZE = 200;

/**
 * Byte backfill for covers stored before byte capture existed (or whose
 * capture failed): entries with a coverUrl but no stored bytes, whose CDN
 * origin the user has already granted. Sequential, and a page of the library
 * at a time: a service worker holding thousands of cards at once is the
 * worker Chrome kills first. Runs once per browser session (background
 * startup) and after a permission upgrade from the popup.
 */
export async function backfillMissingCovers(): Promise<void> {
  let cursor: string | null = null;
  do {
    const page = await getLibraryPage(cursor, BACKFILL_PAGE_SIZE);
    if (!page.ok) {
      return;
    }
    for (const entry of page.data.items) {
      if (entry.hasStoredCover || entry.coverUrl === null) {
        continue;
      }
      if (!(await coverOriginPermitted(entry.coverUrl))) {
        continue;
      }
      await captureCoverBytes(entry.id, entry.coverUrl);
    }
    cursor = page.data.nextCursor;
  } while (cursor !== null);
}

async function coverOriginPermitted(coverUrl: string): Promise<boolean> {
  let origin: string;
  try {
    origin = new URL(coverUrl).origin;
  } catch {
    return false;
  }
  try {
    return await browser.permissions.contains({ origins: [`${origin}/*`] });
  } catch {
    return false;
  }
}

async function startCalibration(tabId: number): Promise<ApiResult<null>> {
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      files: [CALIBRATION_SCRIPT],
    });
    return { ok: true, data: null };
  } catch (cause) {
    return {
      ok: false,
      error:
        cause instanceof Error ? cause.message : "Calibration launch failed",
    };
  }
}

async function saveAdapter(
  body: CreateAdapterBody,
  senderTabId: number | undefined,
): Promise<MessageResponses["save-adapter"]> {
  const result = await createAdapter(body);
  if (result.ok && senderTabId !== undefined) {
    // Re-run detection on the calibrated tab so the chapter records now.
    const command: ContentCommand = { kind: "detect-now" };
    void browser.tabs.sendMessage(senderTabId, command).catch(() => {
      // The tab may be gone; the adapter is saved either way.
    });
  }
  return result;
}
