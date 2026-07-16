import { browser } from "#imports";
import type { ApiResult } from "./api/client";
import type {
  CreateEventBody,
  CreateEventResponse,
  HealthResponse,
  SiteAdapterDto,
} from "./api/types";

export type RuntimeMessage =
  | { kind: "ping" }
  | { kind: "send-test-event"; tabId: number }
  | { kind: "get-adapter"; domain: string }
  | { kind: "record-event"; payload: CreateEventBody }
  | { kind: "register-site"; originPattern: string; tabId: number }
  | { kind: "unregister-site"; originPattern: string };

export interface MessageResponses {
  ping: ApiResult<HealthResponse>;
  "send-test-event": ApiResult<CreateEventResponse>;
  "get-adapter": ApiResult<SiteAdapterDto | null>;
  "record-event": ApiResult<CreateEventResponse>;
  "register-site": ApiResult<null>;
  "unregister-site": ApiResult<null>;
}

export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return false;
  }
  switch (value.kind) {
    case "ping":
      return true;
    case "send-test-event":
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
    typeof value.sourceUrl === "string"
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
