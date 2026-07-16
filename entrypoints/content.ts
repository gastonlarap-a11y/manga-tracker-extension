import { defineContentScript } from "#imports";
import type { PageInfo } from "@/utils/page-info";

// Injected on demand (activeTab + scripting) from the background service
// worker; `registration: "runtime"` keeps it out of the manifest. The value
// returned by main() becomes the executeScript result.
export default defineContentScript({
  registration: "runtime",
  main(): PageInfo {
    return { title: document.title, url: location.href };
  },
});
