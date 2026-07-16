import { browser } from "#imports";
import type { ApiResult } from "./api/client";
import { createReadingEvent, pingHealth } from "./api/client";
import type { CreateEventResponse } from "./api/types";
import type { MessageResponses, RuntimeMessage } from "./messages";
import type { PageInfo } from "./page-info";
import { isPageInfo } from "./page-info";
import { buildTestEventPayload } from "./test-event";

// Business logic behind the background service worker; the entrypoint only
// wires this to browser.runtime.onMessage (mirrors the API's routes/service
// split).
export function handleMessage(
  message: RuntimeMessage,
): Promise<MessageResponses[RuntimeMessage["kind"]]> {
  switch (message.kind) {
    case "ping":
      return pingHealth();
    case "send-test-event":
      return sendTestEvent(message.tabId);
  }
}

async function sendTestEvent(
  tabId: number,
): Promise<ApiResult<CreateEventResponse>> {
  const page = await collectPageInfo(tabId);
  if (!page.ok) {
    return page;
  }
  return createReadingEvent(buildTestEventPayload(page.data));
}

async function collectPageInfo(tabId: number): Promise<ApiResult<PageInfo>> {
  try {
    const [injection] = await browser.scripting.executeScript({
      target: { tabId },
      files: ["/content-scripts/content.js"],
    });
    const result = injection?.result;
    if (isPageInfo(result)) {
      return { ok: true, data: result };
    }
    return { ok: false, error: "Content script returned no page info" };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : "Script injection failed",
    };
  }
}
