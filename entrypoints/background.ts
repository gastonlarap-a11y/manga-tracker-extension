import { browser, defineBackground } from "#imports";
import { handleMessage } from "@/utils/message-handler";
import { isRuntimeMessage } from "@/utils/messages";
import { syncRegisteredSites } from "@/utils/site-registration";

export default defineBackground(() => {
  // Extension reloads/updates wipe runtime-registered content scripts while
  // the granted permissions survive — re-sync on both signals.
  browser.runtime.onInstalled.addListener(() => void resyncDetectors());
  browser.runtime.onStartup.addListener(() => void resyncDetectors());

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isRuntimeMessage(message)) {
      return false;
    }
    void handleMessage(message).then(sendResponse);
    // true keeps the message channel open for the async response.
    return true;
  });
});

async function resyncDetectors(): Promise<void> {
  const result = await syncRegisteredSites();
  if (!result.ok) {
    console.error(`[manga-tracker] detector re-sync failed: ${result.error}`);
  }
}
