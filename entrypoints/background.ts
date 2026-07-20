import { browser, defineBackground } from "#imports";
import { clearTab } from "@/utils/detection-log";
import { backfillMissingCovers, handleMessage } from "@/utils/message-handler";
import { isRuntimeMessage } from "@/utils/messages";
import {
  injectDetectorIntoOpenTabs,
  syncRegisteredSites,
} from "@/utils/site-registration";

export default defineBackground(() => {
  // Extension reloads/updates wipe runtime-registered content scripts while
  // the granted permissions survive — re-sync on both signals. The cover
  // byte backfill piggybacks on the same once-per-session signals.
  browser.runtime.onInstalled.addListener(() => {
    void resyncDetectors();
    void backfillMissingCovers();
  });
  browser.runtime.onStartup.addListener(() => {
    void resyncDetectors();
    void backfillMissingCovers();
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isRuntimeMessage(message)) {
      return false;
    }
    void handleMessage(
      message,
      sender.tab?.id,
      sender.tab
        ? { windowId: sender.tab.windowId, active: sender.tab.active }
        : undefined,
    ).then(sendResponse);
    // true keeps the message channel open for the async response.
    return true;
  });

  browser.tabs.onRemoved.addListener((tabId) => clearTab(tabId));
});

async function resyncDetectors(): Promise<void> {
  const result = await syncRegisteredSites();
  if (!result.ok) {
    console.error(`[manga-tracker] detector re-sync failed: ${result.error}`);
  }
  // Tabs that were already open lost their content scripts on reload and
  // only re-inject on full page loads — hook them back explicitly.
  const reinjected = await injectDetectorIntoOpenTabs();
  if (!reinjected.ok) {
    console.error(
      `[manga-tracker] tab reinjection failed: ${reinjected.error}`,
    );
  }
}
