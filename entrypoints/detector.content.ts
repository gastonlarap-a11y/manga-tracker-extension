import { browser, defineContentScript } from "#imports";
import { detectReading } from "@/utils/detection/detect";
import { CONFIDENCE_THRESHOLD } from "@/utils/detection/heuristics";
import { isContentCommand, sendRuntimeMessage } from "@/utils/messages";

// SPAs swap content without reloading; wait for the page to settle before
// detecting (project plan, phase 6/8).
const SETTLE_DELAY_MS = 2000;

declare global {
  interface Window {
    // Guards against double injection (registered script + explicit
    // executeScript when tracking is enabled on an already-open tab).
    __mangaTrackerDetectorLoaded?: boolean;
  }
}

// Injected only into origins the user chose to track (registered at runtime
// by the background when the host permission is granted).
export default defineContentScript({
  registration: "runtime",
  main(ctx) {
    if (window.__mangaTrackerDetectorLoaded) {
      return;
    }
    window.__mangaTrackerDetectorLoaded = true;

    let lastReportedUrl: string | null = null;
    let settleTimer: number | undefined;

    async function detectAndReport(): Promise<void> {
      const url = location.href;
      if (url === lastReportedUrl) {
        return;
      }

      const adapterResult = await sendRuntimeMessage({
        kind: "get-adapter",
        domain: location.hostname,
      });
      const adapter = adapterResult.ok ? adapterResult.data : null;

      const detection = detectReading(document, url, adapter);
      // The background keeps the last run per tab so the popup can explain
      // why a page did or did not track.
      console.debug("[manga-tracker] detection", url, detection);
      void sendRuntimeMessage({ kind: "report-detection", url, detection });
      if (!detection.detected || detection.confidence < CONFIDENCE_THRESHOLD) {
        return;
      }

      const recorded = await sendRuntimeMessage({
        kind: "record-event",
        payload: {
          mangaName: detection.mangaName,
          chapterLabel: detection.chapterLabel,
          sourceUrl: url,
        },
      });
      if (recorded.ok) {
        lastReportedUrl = url;
      }
    }

    function scheduleDetection(): void {
      window.clearTimeout(settleTimer);
      settleTimer = ctx.setTimeout(
        () => void detectAndReport(),
        SETTLE_DELAY_MS,
      );
    }

    scheduleDetection();
    ctx.addEventListener(window, "wxt:locationchange", scheduleDetection);

    // After saving a calibration the background asks for an immediate re-run
    // (the fresh adapter can now resolve the page).
    browser.runtime.onMessage.addListener((message) => {
      if (isContentCommand(message)) {
        lastReportedUrl = null;
        scheduleDetection();
      }
    });

    // SPA readers (e.g. manhwaweb) set the chapter title only after their
    // data loads, possibly later than the settle delay — re-detect when
    // <title> actually changes.
    let lastSeenTitle = document.title;
    const titleObserver = new MutationObserver(() => {
      if (document.title !== lastSeenTitle) {
        lastSeenTitle = document.title;
        scheduleDetection();
      }
    });
    titleObserver.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    ctx.onInvalidated(() => titleObserver.disconnect());
  },
});
