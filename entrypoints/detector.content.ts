import { browser, defineContentScript } from "#imports";
import {
  encodeBytesToBase64,
  fetchCoverImageBytes,
} from "@/utils/cover-capture";
import {
  findRenderedCoverElement,
  huntCover,
  isSeriesPath,
  matchLibraryEntry,
  pickSeriesPageCover,
} from "@/utils/detection/cover-hunt";
import { detectReading } from "@/utils/detection/detect";
import {
  CONFIDENCE_THRESHOLD,
  seriesUrlFromChapterPath,
} from "@/utils/detection/heuristics";
import { seriesUrlFrom } from "@/utils/detection/page-signals";
import type { CoverHealStatus } from "@/utils/detection-log";
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

      // Stable identity within this site, independent of how the site writes
      // its <title> today. The anchor comes first because it is evidence the
      // page itself gives; the path is the fallback for the sites that expose
      // no such link, which turned out to be almost all of them. Omitted when
      // neither can say.
      const seriesUrl =
        seriesUrlFrom(document, url) ?? seriesUrlFromChapterPath(url);
      const recorded = await sendRuntimeMessage({
        kind: "record-event",
        payload: {
          mangaName: detection.mangaName,
          chapterLabel: detection.chapterLabel,
          sourceUrl: url,
          ...(seriesUrl !== null ? { seriesUrl } : {}),
        },
      });
      // The popup must be able to tell "detected" apart from "detected and
      // saved" — a failed POST would otherwise vanish without a trace.
      void sendRuntimeMessage({
        kind: "report-delivery",
        url,
        delivery: recorded.ok
          ? { status: "sent" }
          : { status: "failed", error: recorded.error },
      });
      if (!recorded.ok) {
        console.debug(
          "[manga-tracker] record-event failed",
          url,
          recorded.error,
        );
      }
      if (recorded.ok) {
        lastReportedUrl = url;
        const manga = recorded.data.manga;
        if (manga.coverUrl === null) {
          void attachCover(
            detection.mangaName,
            detection.chapterLabel,
            url,
            seriesUrl,
          );
        } else if (!manga.hasStoredCover) {
          // Heal pending cover bytes right where the user reads: a chapter
          // page is same-site with its CDN, the one context every
          // bot-protection admits.
          void healCoverBytes(manga.id, manga.coverUrl, manga.canonicalName);
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
      seriesUrl: string | null,
    ): Promise<void> {
      const coverUrl = await huntCover(document, mangaName, sourceUrl);
      if (!coverUrl) {
        return;
      }
      void sendRuntimeMessage({
        kind: "record-event",
        // The same series identity as the first send: this is the same event,
        // and it must resolve to the same manga.
        payload: {
          mangaName,
          chapterLabel,
          sourceUrl,
          coverUrl,
          ...(seriesUrl !== null ? { seriesUrl } : {}),
        },
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
          try {
            if (await tryCaptureCoverOnce()) {
              lastCoverCheckUrl = url;
              return;
            }
          } catch (cause) {
            // A rejected runtime message must not kill the remaining
            // attempts (or die silently).
            console.info(
              "[manga-tracker] cover capture attempt crashed",
              cause,
            );
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
          "[manga-tracker] cover capture: no pending manga matches",
          document.title,
        );
        return false;
      }

      let coverUrl = entry.coverUrl;
      if (coverUrl === null) {
        coverUrl = pickSeriesPageCover(document, entry.canonicalName);
        if (!coverUrl) {
          console.debug(
            "[manga-tracker] cover capture: no candidate image yet for",
            entry.canonicalName,
          );
          return false;
        }
        console.info("[manga-tracker] cover capture: sending", coverUrl);
        const set = await sendRuntimeMessage({
          kind: "set-cover",
          mangaId: entry.id,
          coverUrl,
        });
        if (!set.ok) {
          return false;
        }
        // The background already attempted a byte fetch for the new URL;
        // CDNs that block it fall through to the heal chain below.
      }

      return healCoverBytes(entry.id, coverUrl, entry.canonicalName);
    }

    // Byte heal for a cover whose CDN rejects the service worker's fetch
    // (Cloudflare validates the browsing context): first a fetch from THIS
    // page's own same-site context (full quality; works when the CDN allows
    // CORS reads — manhwa-latino), else crop the rendered element out of the
    // screen (mangasnosekai). Every outcome logs at info level AND lands in
    // the per-tab detection log so the popup can explain a missing cover.
    async function healCoverBytes(
      mangaId: string,
      coverUrl: string,
      mangaName: string,
    ): Promise<boolean> {
      const url = location.href;
      const report = (coverHeal: CoverHealStatus) => {
        void sendRuntimeMessage({ kind: "report-cover-heal", url, coverHeal });
      };
      try {
        const inPage = await fetchCoverImageBytes(coverUrl, fetch, "omit");
        if (inPage) {
          const uploaded = await sendRuntimeMessage({
            kind: "upload-cover-bytes",
            mangaId,
            base64: encodeBytesToBase64(inPage.bytes),
            contentType: inPage.contentType,
          });
          console.info(
            "[manga-tracker] cover heal (in-page fetch)",
            coverUrl,
            uploaded,
          );
          if (uploaded.ok) {
            report({ status: "healed" });
            return true;
          }
        } else {
          console.info(
            "[manga-tracker] cover heal: in-page fetch failed (CORS/CDN)",
            coverUrl,
          );
        }

        const element = findRenderedCoverElement(document, coverUrl, mangaName);
        if (!element) {
          console.info(
            "[manga-tracker] cover heal: no rendered cover element for",
            mangaName,
          );
          report({
            status: "failed",
            error: "sin elemento de portada renderizado",
          });
          return false;
        }
        if (!(await ensureInViewport(element))) {
          console.info(
            "[manga-tracker] cover heal: cover element not in viewport",
            mangaName,
          );
          report({
            status: "failed",
            error: "la portada no entra en el viewport",
          });
          return false;
        }
        const rect = element.getBoundingClientRect();
        const captured = await sendRuntimeMessage({
          kind: "capture-cover-pixels",
          mangaId,
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
          dpr: window.devicePixelRatio,
        });
        console.info("[manga-tracker] cover heal (pixel capture)", captured);
        report(
          captured.ok
            ? { status: "healed" }
            : { status: "failed", error: captured.error },
        );
        return captured.ok;
      } catch (cause) {
        const error = cause instanceof Error ? cause.message : String(cause);
        console.info("[manga-tracker] cover heal crashed", error);
        report({ status: "failed", error });
        return false;
      }
    }

    // captureVisibleTab only sees the viewport; scroll the cover into it and
    // give the browser a beat to repaint before measuring the final rect.
    async function ensureInViewport(element: Element): Promise<boolean> {
      const fits = (rect: DOMRect) =>
        rect.width > 0 &&
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= window.innerHeight &&
        rect.right <= window.innerWidth;
      if (fits(element.getBoundingClientRect())) {
        return true;
      }
      element.scrollIntoView({ block: "center", inline: "center" });
      await sleep(300);
      return fits(element.getBoundingClientRect());
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
