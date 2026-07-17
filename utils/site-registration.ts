import { browser } from "#imports";
import type { ApiResult } from "./api/client";

const DETECTOR_SCRIPT = "/content-scripts/detector.js" as const;
const DETECTOR_ID_PREFIX = "detector:";
// Fixed backend host permission (manifest host_permissions) — not a tracked site.
const BACKEND_ORIGIN_PATTERN = "http://localhost:5150/*";

function scriptId(originPattern: string): string {
  return `${DETECTOR_ID_PREFIX}${originPattern}`;
}

type DetectorRegistration = Parameters<
  typeof browser.scripting.registerContentScripts
>[0][number];

function detectorRegistration(originPattern: string): DetectorRegistration {
  return {
    id: scriptId(originPattern),
    matches: [originPattern],
    js: [DETECTOR_SCRIPT],
    runAt: "document_idle",
    persistAcrossSessions: true,
  };
}

// Registers the detector for an origin the user just granted (persists across
// browser sessions) and runs it immediately on the requesting tab so tracking
// starts without a reload.
export async function registerSite(
  originPattern: string,
  tabId: number,
): Promise<ApiResult<null>> {
  try {
    const existing = await browser.scripting.getRegisteredContentScripts({
      ids: [scriptId(originPattern)],
    });
    if (existing.length === 0) {
      await browser.scripting.registerContentScripts([
        detectorRegistration(originPattern),
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

// Reloading the extension also invalidates the content scripts of tabs that
// are ALREADY open, and registered scripts only inject on new page loads —
// so a pre-reload tab navigating via SPA would go untracked forever. The
// background calls this after the registration sync to hook those tabs back.
export async function injectDetectorIntoOpenTabs(): Promise<ApiResult<null>> {
  try {
    const granted = await browser.permissions.getAll();
    const origins = (granted.origins ?? []).filter(
      (origin) => origin !== BACKEND_ORIGIN_PATTERN,
    );
    for (const originPattern of origins) {
      const tabs = await browser.tabs.query({ url: originPattern });
      for (const tab of tabs) {
        if (tab.id === undefined) {
          continue;
        }
        try {
          await browser.scripting.executeScript({
            target: { tabId: tab.id },
            files: [DETECTOR_SCRIPT],
          });
        } catch {
          // Discarded or protected tab; the rest must still get the detector.
        }
      }
    }
    return { ok: true, data: null };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : "Tab reinjection failed",
    };
  }
}

// Chrome wipes runtime-registered content scripts when the extension is
// reloaded or updated, while the granted host permissions survive. The
// background calls this on installed/startup to bring registrations back in
// sync with the permissions (both directions).
export async function syncRegisteredSites(): Promise<ApiResult<null>> {
  try {
    const [granted, registered] = await Promise.all([
      browser.permissions.getAll(),
      browser.scripting.getRegisteredContentScripts(),
    ]);
    const grantedOrigins = (granted.origins ?? []).filter(
      (origin) => origin !== BACKEND_ORIGIN_PATTERN,
    );
    const registeredIds = new Set(
      registered
        .map((script) => script.id)
        .filter((id) => id.startsWith(DETECTOR_ID_PREFIX)),
    );

    const missing = grantedOrigins.filter(
      (origin) => !registeredIds.has(scriptId(origin)),
    );
    if (missing.length > 0) {
      await browser.scripting.registerContentScripts(
        missing.map(detectorRegistration),
      );
    }

    const grantedIds = new Set(grantedOrigins.map(scriptId));
    const stale = [...registeredIds].filter((id) => !grantedIds.has(id));
    if (stale.length > 0) {
      await browser.scripting.unregisterContentScripts({ ids: stale });
    }

    return { ok: true, data: null };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : "Detector sync failed",
    };
  }
}
