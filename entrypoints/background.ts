import { browser, defineBackground } from "#imports";
import { badgeFor, paintBadge, paintGlobalBadge } from "@/utils/badge";
import {
  clearTab,
  getDetection,
  onDetectionChange,
  trackedTabs,
} from "@/utils/detection-log";
import {
  backfillMissingCovers,
  flushReadings,
  handleMessage,
} from "@/utils/message-handler";
import { isRuntimeMessage } from "@/utils/messages";
import { FLUSH_ALARM } from "@/utils/outbox";
import { refreshConfig } from "@/utils/remote-config";
import {
  injectDetectorIntoOpenTabs,
  syncRegisteredSites,
} from "@/utils/site-registration";
import { refreshRules } from "@/utils/site-rules";
import { pausedItem } from "@/utils/tracking-prefs";

export default defineBackground(() => {
  // Extension reloads/updates wipe runtime-registered content scripts while
  // the granted permissions survive — re-sync on both signals. The cover
  // byte backfill, the site rules and the extension config piggyback on the
  // same once-per-session signals: an update is exactly when a machine may
  // have gained a backend that knows about sites this build has never heard
  // of. Readings kept while the backend was away go out on the same signals,
  // and on the alarm the outbox arms for as long as it holds any.
  // flushReadings logs its own failures, so `void` drops nothing.
  function onSessionStart(): void {
    void resyncDetectors();
    void backfillMissingCovers();
    void refreshRules();
    void refreshConfig();
    void flushReadings();
    void repaintAll();
  }
  browser.runtime.onInstalled.addListener(onSessionStart);
  browser.runtime.onStartup.addListener(onSessionStart);
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === FLUSH_ALARM) {
      void flushReadings();
    }
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isRuntimeMessage(message)) {
      return false;
    }
    void handleMessage(
      message,
      sender.tab?.id,
      sender.tab
        ? {
            windowId: sender.tab.windowId,
            active: sender.tab.active,
            incognito: sender.tab.incognito,
          }
        : undefined,
    ).then(sendResponse);
    // true keeps the message channel open for the async response.
    return true;
  });

  // The badge follows the detection log, whoever wrote to it.
  onDetectionChange((tabId) => void repaint(tabId));
  pausedItem.watch(() => void repaintAll());

  browser.tabs.onRemoved.addListener((tabId) => clearTab(tabId));
  // A new page in the tab: what the old one said no longer applies, and a
  // badge saying "saved" over a page that saved nothing would be a lie. The
  // detector reports again once the new page settles.
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === "loading") {
      clearTab(tabId);
    }
  });
});

async function repaint(tabId: number): Promise<void> {
  const paused = await pausedItem.getValue();
  await paintBadge(tabId, badgeFor(getDetection(tabId), paused));
}

async function repaintAll(): Promise<void> {
  try {
    await paintGlobalBadge(await pausedItem.getValue());
    await Promise.all(trackedTabs().map(repaint));
  } catch (cause) {
    console.error("[manga-tracker] badge repaint failed", cause);
  }
}

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
