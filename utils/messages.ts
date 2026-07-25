import { browser } from "#imports";
import type { ApiResult } from "./api/client";
import type {
  CreateAdapterBody,
  CreateEventBody,
  CreateEventResponse,
  HealthResponse,
  LibraryEntryDto,
  MangaDto,
  SiteAdapterDto,
} from "./api/types";
import type { CoverRect } from "./cover-pixels";
import type { Detection } from "./detection/heuristics";
import type {
  CoverHealStatus,
  DeliveryStatus,
  DetectionEntry,
} from "./detection-log";
import type { DetectorRepair } from "./site-registration";

export type RuntimeMessage =
  | { kind: "ping" }
  | { kind: "send-test-event"; tabId: number }
  | { kind: "get-adapter"; domain: string }
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
  | { kind: "report-detection"; url: string; detection: Detection }
  | { kind: "report-delivery"; url: string; delivery: DeliveryStatus }
  | { kind: "report-cover-heal"; url: string; coverHeal: CoverHealStatus }
  | { kind: "get-detection"; tabId: number }
  | { kind: "start-calibration"; tabId: number }
  | { kind: "save-adapter"; body: CreateAdapterBody }
  | { kind: "get-library" }
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
  "send-test-event": ApiResult<CreateEventResponse>;
  "get-adapter": ApiResult<SiteAdapterDto | null>;
  "record-event": ApiResult<CreateEventResponse>;
  "register-site": ApiResult<null>;
  "unregister-site": ApiResult<null>;
  "ensure-site-registered": ApiResult<DetectorRepair>;
  "report-detection": null;
  "report-delivery": null;
  "report-cover-heal": null;
  "get-detection": DetectionEntry | null;
  "start-calibration": ApiResult<null>;
  "save-adapter": ApiResult<SiteAdapterDto>;
  "get-library": ApiResult<LibraryEntryDto[]>;
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
    case "backfill-covers":
      return true;
    case "send-test-event":
    case "get-detection":
    case "start-calibration":
      return "tabId" in value && typeof value.tabId === "number";
    case "get-adapter":
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
        isDetection(value.detection)
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
    (!("coverUrl" in value) || typeof value.coverUrl === "string")
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
  if (value.status === "sent") {
    return true;
  }
  return (
    value.status === "failed" &&
    "error" in value &&
    typeof value.error === "string"
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
