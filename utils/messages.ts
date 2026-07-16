import { browser } from "#imports";
import type { ApiResult } from "./api/client";
import type { CreateEventResponse, HealthResponse } from "./api/types";

export type RuntimeMessage =
  | { kind: "ping" }
  | { kind: "send-test-event"; tabId: number };

export interface MessageResponses {
  ping: ApiResult<HealthResponse>;
  "send-test-event": ApiResult<CreateEventResponse>;
}

export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return false;
  }
  if (value.kind === "ping") {
    return true;
  }
  return (
    value.kind === "send-test-event" &&
    "tabId" in value &&
    typeof value.tabId === "number"
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
