import { browser } from "#imports";
import type { ApiResult } from "./api/client";
import {
  createAdapter,
  createReadingEvent,
  getAdapter,
  getLibrary,
  pingHealth,
  setMangaCover,
  uploadMangaCoverImage,
} from "./api/client";
import type {
  CreateAdapterBody,
  CreateEventBody,
  CreateEventResponse,
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
import type {
  ContentCommand,
  MessageResponses,
  RuntimeMessage,
} from "./messages";
import {
  ensureDetectorRegistered,
  registerSite,
  unregisterSite,
} from "./site-registration";
import { rulesForDetection } from "./site-rules";

const CALIBRATION_SCRIPT = "/content-scripts/calibration.js" as const;

// What the pixel capture needs to know about the sender's tab: the window to
// screenshot and whether the tab is the one actually on screen.
export interface SenderTabInfo {
  windowId?: number;
  active?: boolean;
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
    case "get-adapter":
      return getAdapter(message.domain);
    case "get-site-rules":
      return rulesForDetection();
    case "record-event":
      return recordEventWithCover(message.payload);
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
    case "get-library":
      return getLibrary();
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
// cover. Guarded server-side (never downgrades already-stored bytes with a
// screenshot) and tab-side (only the on-screen tab can be captured).
async function captureCoverPixels(
  mangaId: string,
  rect: CoverRect,
  dpr: number,
  senderTab?: SenderTabInfo,
): Promise<ApiResult<null>> {
  if (senderTab?.active !== true || senderTab.windowId === undefined) {
    return { ok: false, error: "Tab is not visible" };
  }
  const library = await getLibrary();
  if (!library.ok) {
    return library;
  }
  const entry = library.data.find((candidate) => candidate.id === mangaId);
  if (!entry) {
    return { ok: false, error: "Manga not found" };
  }
  if (entry.hasStoredCover) {
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

/**
 * Byte backfill for covers stored before byte capture existed (or whose
 * capture failed): entries with a coverUrl but no stored bytes, whose CDN
 * origin the user has already granted. Sequential — the library is tiny.
 * Runs once per browser session (background startup) and after a permission
 * upgrade from the popup.
 */
export async function backfillMissingCovers(): Promise<void> {
  const library = await getLibrary();
  if (!library.ok) {
    return;
  }
  for (const entry of library.data) {
    if (entry.hasStoredCover || entry.coverUrl === null) {
      continue;
    }
    if (!(await coverOriginPermitted(entry.coverUrl))) {
      continue;
    }
    await captureCoverBytes(entry.id, entry.coverUrl);
  }
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
