import { browser } from "#imports";
import type { ApiResult } from "./api/client";
import {
  createAdapter,
  createReadingEvent,
  getAdapter,
  getLibrary,
  pingHealth,
  setMangaCover,
} from "./api/client";
import type { CreateAdapterBody, CreateEventResponse } from "./api/types";
import { getDetection, recordDetection } from "./detection-log";
import type {
  ContentCommand,
  MessageResponses,
  RuntimeMessage,
} from "./messages";
import type { PageInfo } from "./page-info";
import { isPageInfo } from "./page-info";
import { registerSite, unregisterSite } from "./site-registration";
import { buildTestEventPayload } from "./test-event";

const CALIBRATION_SCRIPT = "/content-scripts/calibration.js" as const;

// Business logic behind the background service worker; the entrypoint only
// wires this to browser.runtime.onMessage (mirrors the API's routes/service
// split). senderTabId is the tab the message came from (content scripts).
export function handleMessage(
  message: RuntimeMessage,
  senderTabId?: number,
): Promise<MessageResponses[RuntimeMessage["kind"]]> {
  switch (message.kind) {
    case "ping":
      return pingHealth();
    case "send-test-event":
      return sendTestEvent(message.tabId);
    case "get-adapter":
      return getAdapter(message.domain);
    case "record-event":
      return createReadingEvent(message.payload);
    case "register-site":
      return registerSite(message.originPattern, message.tabId);
    case "unregister-site":
      return unregisterSite(message.originPattern);
    case "report-detection": {
      if (senderTabId !== undefined) {
        recordDetection(senderTabId, {
          url: message.url,
          detection: message.detection,
        });
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
      return setMangaCover(message.mangaId, message.coverUrl);
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
