import { browser } from "#imports";
import type { ApiResult } from "./api/client";
import type {
  CreateAdapterBody,
  CreateEventBody,
  CreateEventResponse,
  HealthResponse,
  SiteAdapterDto,
} from "./api/types";
import type { Detection } from "./detection/heuristics";
import type { DetectionEntry } from "./detection-log";

export type RuntimeMessage =
  | { kind: "ping" }
  | { kind: "send-test-event"; tabId: number }
  | { kind: "get-adapter"; domain: string }
  | { kind: "record-event"; payload: CreateEventBody }
  | { kind: "register-site"; originPattern: string; tabId: number }
  | { kind: "unregister-site"; originPattern: string }
  | { kind: "report-detection"; url: string; detection: Detection }
  | { kind: "get-detection"; tabId: number }
  | { kind: "start-calibration"; tabId: number }
  | { kind: "save-adapter"; body: CreateAdapterBody };

export interface MessageResponses {
  ping: ApiResult<HealthResponse>;
  "send-test-event": ApiResult<CreateEventResponse>;
  "get-adapter": ApiResult<SiteAdapterDto | null>;
  "record-event": ApiResult<CreateEventResponse>;
  "register-site": ApiResult<null>;
  "unregister-site": ApiResult<null>;
  "report-detection": null;
  "get-detection": DetectionEntry | null;
  "start-calibration": ApiResult<null>;
  "save-adapter": ApiResult<SiteAdapterDto>;
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
    case "report-detection":
      return (
        "url" in value &&
        typeof value.url === "string" &&
        "detection" in value &&
        isDetection(value.detection)
      );
    case "save-adapter":
      return "body" in value && isCreateAdapterBody(value.body);
    default:
      return false;
  }
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
