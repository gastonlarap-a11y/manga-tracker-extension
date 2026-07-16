import { browser } from "#imports";
import type { ApiResult } from "./api/client";

const DETECTOR_SCRIPT = "/content-scripts/detector.js" as const;

function scriptId(originPattern: string): string {
  return `detector:${originPattern}`;
}

// Registers the detector for an origin the user just granted (persists across
// sessions) and runs it immediately on the requesting tab so tracking starts
// without a reload.
export async function registerSite(
  originPattern: string,
  tabId: number,
): Promise<ApiResult<null>> {
  try {
    const id = scriptId(originPattern);
    const existing = await browser.scripting.getRegisteredContentScripts({
      ids: [id],
    });
    if (existing.length === 0) {
      await browser.scripting.registerContentScripts([
        {
          id,
          matches: [originPattern],
          js: [DETECTOR_SCRIPT],
          runAt: "document_idle",
          persistAcrossSessions: true,
        },
      ]);
    }
    await browser.scripting.executeScript({
      target: { tabId },
      files: [DETECTOR_SCRIPT],
    });
    return { ok: true, data: null };
  } catch (cause) {
    return {
      ok: false,
      error:
        cause instanceof Error ? cause.message : "Site registration failed",
    };
  }
}

export async function unregisterSite(
  originPattern: string,
): Promise<ApiResult<null>> {
  try {
    const id = scriptId(originPattern);
    const existing = await browser.scripting.getRegisteredContentScripts({
      ids: [id],
    });
    if (existing.length > 0) {
      await browser.scripting.unregisterContentScripts({ ids: [id] });
    }
    return { ok: true, data: null };
  } catch (cause) {
    return {
      ok: false,
      error:
        cause instanceof Error ? cause.message : "Site unregistration failed",
    };
  }
}
