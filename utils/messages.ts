import { browser } from "#imports";
import type { ApiResult } from "./api/client";
import type {
  CreateAdapterBody,
  CreateEventBody,
  CreateEventResponse,
  ExtensionConfigDto,
  HealthResponse,
  LibraryEntryDto,
  MangaDto,
  SiteAdapterDto,
  SiteRuleDto,
} from "./api/types";
import type { CoverRect } from "./cover-pixels";
import type { DetectionSelectors } from "./detection/adapter";
import type { Detection } from "./detection/heuristics";
import type {
  CoverHealStatus,
  DeliveryStatus,
  DetectionEntry,
  PageFacts,
} from "./detection-log";
import type { DetectorRepair } from "./site-registration";
import type { HoldReason } from "./tracking-prefs";

/**
 * What recording a reading comes back as. `queued` is its own answer rather
 * than a failure: the backend was not reachable, and the reading is kept in
 * `utils/outbox.ts` to be sent when it is. `held` is not a failure either:
 * tracking is paused, or the tab is a private window that does not record.
 */
export type RecordEventResponse =
  | ApiResult<CreateEventResponse>
  | { ok: false; error: string; queued: true }
  | { ok: false; error: string; held: HoldReason };

/** How a recording's answer reads in the detection log. */
export function deliveryOf(result: RecordEventResponse): DeliveryStatus {
  if (result.ok) {
    return { status: "sent", mangaId: result.data.manga.id };
  }
  if ("held" in result) {
    return { status: "held", reason: result.held };
  }
  if ("queued" in result) {
    return { status: "queued" };
  }
  return { status: "failed", error: result.error };
}

export type RuntimeMessage =
  | { kind: "ping" }
  // The selectors detection uses on a site: its calibration, or the curated
  // rule, from a cache when the backend is away. See utils/detection-selectors.ts.
  | { kind: "get-selectors"; domain: string }
  // Served from the background's cache: only it may fetch, and a detection
  // must not wait on the network to find out how a site names its series.
  | { kind: "get-site-rules" }
  | { kind: "record-event"; payload: CreateEventBody }
  | { kind: "register-site"; originPattern: string; tabId: number }
  | { kind: "unregister-site"; originPattern: string }
  // Reconciles a granted permission with a live detector registration; the two
  // drift apart whenever the extension is reloaded or updated.
  | {
      kind: "ensure-site-registered";
      originPatterns: string[];
      tabId: number;
    }
  | {
      kind: "report-detection";
      url: string;
      detection: Detection;
      // Absent from a detector older than 0.2.0 still running in an open tab.
      facts?: PageFacts;
    }
  | { kind: "report-delivery"; url: string; delivery: DeliveryStatus }
  // Tuning, themes, notices and reading settings, from the background's cache.
  | { kind: "get-extension-config" }
  // Asks for a fresh copy now: the popup opening is the moment someone who
  // just changed a setting in the dashboard looks for it to apply.
  | { kind: "refresh-extension-config" }
  // "Guardar a mano" from the popup, for the tab it was opened on.
  | { kind: "record-manual"; tabId: number; payload: CreateEventBody }
  // The few series read most recently, for "Seguir leyendo".
  | { kind: "get-recent-reading" }
  // Where the backend answers, to open the dashboard on it.
  | { kind: "get-backend-url" }
  | { kind: "report-cover-heal"; url: string; coverHeal: CoverHealStatus }
  | { kind: "get-detection"; tabId: number }
  | { kind: "start-calibration"; tabId: number }
  | { kind: "save-adapter"; body: CreateAdapterBody }
  | { kind: "get-library" }
  // How many readings are waiting in the outbox for the backend.
  | { kind: "get-outbox" }
  | { kind: "set-cover"; mangaId: string; coverUrl: string }
  | { kind: "backfill-covers" }
  // Cover bytes fetched by the content script in the page's own context
  // (same-site request — the one client CDN bot-protection always admits).
  | {
      kind: "upload-cover-bytes";
      mangaId: string;
      base64: string;
      contentType: string;
    }
  // Rendered-pixels fallback for covers whose CDN blocks every direct fetch;
  // rect is the cover element's viewport box in CSS pixels.
  | {
      kind: "capture-cover-pixels";
      mangaId: string;
      rect: CoverRect;
      dpr: number;
    };

export interface MessageResponses {
  ping: ApiResult<HealthResponse>;
  // Never a failure: with nothing to go on, detection uses the heuristics.
  "get-selectors": DetectionSelectors | null;
  // An empty list, never a failure: with no rules, detection uses the generic
  // heuristics, which is what every site got before the catalogue existed.
  "get-site-rules": SiteRuleDto[];
  "record-event": RecordEventResponse;
  "register-site": ApiResult<null>;
  "unregister-site": ApiResult<null>;
  "ensure-site-registered": ApiResult<DetectorRepair>;
  "report-detection": null;
  "report-delivery": null;
  // Null with no backend that has the endpoint: the compiled defaults apply.
  "get-extension-config": ExtensionConfigDto | null;
  "refresh-extension-config": ExtensionConfigDto | null;
  "record-manual": RecordEventResponse;
  "get-recent-reading": ApiResult<LibraryEntryDto[]>;
  "get-backend-url": { baseUrl: string | null };
  "report-cover-heal": null;
  "get-detection": DetectionEntry | null;
  "start-calibration": ApiResult<null>;
  "save-adapter": ApiResult<SiteAdapterDto>;
  "get-library": ApiResult<LibraryEntryDto[]>;
  "get-outbox": { pending: number };
  "set-cover": ApiResult<MangaDto>;
  "backfill-covers": null;
  "upload-cover-bytes": ApiResult<null>;
  "capture-cover-pixels": ApiResult<null>;
}

// Command sent the other way around (background → content script via
// browser.tabs.sendMessage), e.g. after saving an adapter.
export type ContentCommand = { kind: "detect-now" };

export function isContentCommand(value: unknown): value is ContentCommand {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "detect-now"
  );
}

export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return false;
  }
  switch (value.kind) {
    case "ping":
    case "get-library":
    case "get-outbox":
    case "backfill-covers":
    case "get-site-rules":
    case "get-extension-config":
    case "refresh-extension-config":
    case "get-recent-reading":
    case "get-backend-url":
      return true;
    case "record-manual":
      return (
        "tabId" in value &&
        typeof value.tabId === "number" &&
        "payload" in value &&
        isCreateEventBody(value.payload)
      );
    case "get-detection":
    case "start-calibration":
      return "tabId" in value && typeof value.tabId === "number";
    case "get-selectors":
      return "domain" in value && typeof value.domain === "string";
    case "record-event":
      return "payload" in value && isCreateEventBody(value.payload);
    case "register-site":
      return (
        "originPattern" in value &&
        typeof value.originPattern === "string" &&
        "tabId" in value &&
        typeof value.tabId === "number"
      );
    case "unregister-site":
      return (
        "originPattern" in value && typeof value.originPattern === "string"
      );
    case "ensure-site-registered":
      return (
        "originPatterns" in value &&
        Array.isArray(value.originPatterns) &&
        value.originPatterns.every((pattern) => typeof pattern === "string") &&
        "tabId" in value &&
        typeof value.tabId === "number"
      );
    case "report-detection":
      return (
        "url" in value &&
        typeof value.url === "string" &&
        "detection" in value &&
        isDetection(value.detection) &&
        (!("facts" in value) || isPageFacts(value.facts))
      );
    case "report-delivery":
      return (
        "url" in value &&
        typeof value.url === "string" &&
        "delivery" in value &&
        isDeliveryStatus(value.delivery)
      );
    case "report-cover-heal":
      return (
        "url" in value &&
        typeof value.url === "string" &&
        "coverHeal" in value &&
        isCoverHealStatus(value.coverHeal)
      );
    case "save-adapter":
      return "body" in value && isCreateAdapterBody(value.body);
    case "set-cover":
      return (
        "mangaId" in value &&
        typeof value.mangaId === "string" &&
        "coverUrl" in value &&
        typeof value.coverUrl === "string"
      );
    case "upload-cover-bytes":
      return (
        "mangaId" in value &&
        typeof value.mangaId === "string" &&
        "base64" in value &&
        typeof value.base64 === "string" &&
        "contentType" in value &&
        typeof value.contentType === "string"
      );
    case "capture-cover-pixels":
      return (
        "mangaId" in value &&
        typeof value.mangaId === "string" &&
        "rect" in value &&
        isCoverRect(value.rect) &&
        "dpr" in value &&
        typeof value.dpr === "number"
      );
    default:
      return false;
  }
}

function isCoverRect(value: unknown): value is CoverRect {
  return (
    typeof value === "object" &&
    value !== null &&
    "x" in value &&
    typeof value.x === "number" &&
    "y" in value &&
    typeof value.y === "number" &&
    "width" in value &&
    typeof value.width === "number" &&
    "height" in value &&
    typeof value.height === "number"
  );
}

function isCreateEventBody(value: unknown): value is CreateEventBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "mangaName" in value &&
    typeof value.mangaName === "string" &&
    "chapterLabel" in value &&
    typeof value.chapterLabel === "string" &&
    "sourceUrl" in value &&
    typeof value.sourceUrl === "string" &&
    (!("coverUrl" in value) || typeof value.coverUrl === "string") &&
    (!("seriesUrl" in value) || typeof value.seriesUrl === "string")
  );
}

function isCreateAdapterBody(value: unknown): value is CreateAdapterBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "domain" in value &&
    typeof value.domain === "string" &&
    "titleSelector" in value &&
    typeof value.titleSelector === "string"
  );
}

function isCoverHealStatus(value: unknown): value is CoverHealStatus {
  if (typeof value !== "object" || value === null || !("status" in value)) {
    return false;
  }
  if (value.status === "healed") {
    return true;
  }
  return (
    value.status === "failed" &&
    "error" in value &&
    typeof value.error === "string"
  );
}

function isDeliveryStatus(value: unknown): value is DeliveryStatus {
  if (typeof value !== "object" || value === null || !("status" in value)) {
    return false;
  }
  switch (value.status) {
    case "sent":
      return !("mangaId" in value) || typeof value.mangaId === "string";
    case "queued":
    case "below-threshold":
      return true;
    case "failed":
      return "error" in value && typeof value.error === "string";
    case "waiting":
      return (
        "minSeconds" in value &&
        typeof value.minSeconds === "number" &&
        "minScrollPercent" in value &&
        typeof value.minScrollPercent === "number"
      );
    case "held":
      return (
        "reason" in value &&
        (value.reason === "paused" || value.reason === "incognito")
      );
    default:
      return false;
  }
}

function isPageFacts(value: unknown): value is PageFacts {
  const nullableString = (field: unknown) =>
    field === null || typeof field === "string";
  return (
    typeof value === "object" &&
    value !== null &&
    "theme" in value &&
    nullableString(value.theme) &&
    "seriesLinkUrl" in value &&
    nullableString(value.seriesLinkUrl) &&
    "nextUrl" in value &&
    nullableString(value.nextUrl)
  );
}

function isDetection(value: unknown): value is Detection {
  if (typeof value !== "object" || value === null || !("detected" in value)) {
    return false;
  }
  if (value.detected === true) {
    return (
      "mangaName" in value &&
      typeof value.mangaName === "string" &&
      "chapterLabel" in value &&
      typeof value.chapterLabel === "string" &&
      "confidence" in value &&
      typeof value.confidence === "number"
    );
  }
  return (
    value.detected === false &&
    "reason" in value &&
    typeof value.reason === "string"
  );
}

export function sendRuntimeMessage<M extends RuntimeMessage>(
  message: M,
): Promise<MessageResponses[M["kind"]]> {
  // Cast justified: browser.runtime messaging is untyped; RuntimeMessage /
  // MessageResponses is the in-extension contract enforced on both ends.
  return browser.runtime.sendMessage(message) as Promise<
    MessageResponses[M["kind"]]
  >;
}
