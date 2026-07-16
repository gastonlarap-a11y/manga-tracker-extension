import { browser, defineBackground } from "#imports";
import { handleMessage } from "@/utils/message-handler";
import { isRuntimeMessage } from "@/utils/messages";

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isRuntimeMessage(message)) {
      return false;
    }
    void handleMessage(message).then(sendResponse);
    // true keeps the message channel open for the async response.
    return true;
  });
});
