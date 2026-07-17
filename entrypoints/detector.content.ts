import { browser, defineContentScript } from "#imports";
import {
  huntCover,
  isSeriesPath,
  matchLibraryEntry,
  pickSeriesPageCover,
} from "@/utils/detection/cover-hunt";
import { detectReading } from "@/utils/detection/detect";
import { CONFIDENCE_THRESHOLD } from "@/utils/detection/heuristics";
import { isContentCommand, sendRuntimeMessage } from "@/utils/messages";

// SPAs swap content without reloading; wait for the page to settle before
// detecting (project plan, phase 6/8).
const SETTLE_DELAY_MS = 2000;

// Bounded polling for the series-page cover capture (~10.5s total): long
// enough for a slow ficha to render and its hero image to get a src.
const COVER_CAPTURE_ATTEMPTS = 8;
const COVER_CAPTURE_RETRY_MS = 1500;

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
    let lastCoverCheckUrl: string | null = null;
    let activeCaptureUrl: string | null = null;
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
      if (!detection.detected) {
        // Level 4 of the cover hunt: not a chapter, but it may be the RENDERED
        // series page of a tracked manga (the only place SPAs show the cover).
        if (
          detection.reason === "no-chapter-in-url" &&
          isSeriesPath(location.pathname)
        ) {
          void captureSeriesCover(url);
        }
        return;
      }
      if (detection.confidence < CONFIDENCE_THRESHOLD) {
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
        if (recorded.data.manga.coverUrl === null) {
          void attachCover(detection.mangaName, detection.chapterLabel, url);
        }
      }
    }

    // Best-effort, one-off per manga: hunts the real cover (page meta →
    // series page → in-page thumbnail) and re-sends the same event with it.
    // The backend dedupes the event but persists the cover (first wins).
    async function attachCover(
      mangaName: string,
      chapterLabel: string,
      sourceUrl: string,
    ): Promise<void> {
      const coverUrl = await huntCover(document, mangaName, sourceUrl);
      if (!coverUrl) {
        return;
      }
      void sendRuntimeMessage({
        kind: "record-event",
        payload: { mangaName, chapterLabel, sourceUrl, coverUrl },
      });
    }

    // SPA series pages render (and load their hero image) well after the
    // settle delay, so the capture polls on its own bounded schedule instead
    // of hoping for another title mutation. Only a SENT cover marks the URL
    // as done; every decision lands in console.debug so a field report is
    // one F12 away.
    async function captureSeriesCover(url: string): Promise<void> {
      if (url === lastCoverCheckUrl || url === activeCaptureUrl) {
        return;
      }
      activeCaptureUrl = url;
      try {
        for (let attempt = 0; attempt < COVER_CAPTURE_ATTEMPTS; attempt++) {
          if (attempt > 0) {
            await sleep(COVER_CAPTURE_RETRY_MS);
          }
          if (location.href !== url || url === lastCoverCheckUrl) {
            return;
          }
          if (await tryCaptureCoverOnce()) {
            lastCoverCheckUrl = url;
            return;
          }
        }
        console.debug("[manga-tracker] cover capture gave up", url);
      } finally {
        activeCaptureUrl = null;
      }
    }

    async function tryCaptureCoverOnce(): Promise<boolean> {
      const library = await sendRuntimeMessage({ kind: "get-library" });
      if (!library.ok) {
        return false;
      }
      const heading = document.querySelector("h1")?.textContent ?? "";
      const entry = matchLibraryEntry(
        library.data,
        `${document.title} ${heading}`,
      );
      if (!entry) {
        console.debug(
          "[manga-tracker] cover capture: no uncovered manga matches",
          document.title,
        );
        return false;
      }
      const coverUrl = pickSeriesPageCover(document, entry.canonicalName);
      if (!coverUrl) {
        console.debug(
          "[manga-tracker] cover capture: no candidate image yet for",
          entry.canonicalName,
        );
        return false;
      }
      console.debug("[manga-tracker] cover capture: sending", coverUrl);
      void sendRuntimeMessage({
        kind: "set-cover",
        mangaId: entry.id,
        coverUrl,
      });
      return true;
    }

    function sleep(ms: number): Promise<void> {
      return new Promise((resolve) => ctx.setTimeout(resolve, ms));
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
