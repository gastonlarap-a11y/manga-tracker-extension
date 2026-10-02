import { browser, defineContentScript } from "#imports";
import type { LibraryEntryDto } from "@/utils/api/types";
import {
  encodeBytesToBase64,
  fetchCoverImageBytes,
} from "@/utils/cover-capture";
import {
  compileDetectionConfig,
  DEFAULT_DETECTION_CONFIG,
} from "@/utils/detection/config";
import {
  findRenderedCoverElement,
  huntCover,
  isSeriesPath,
  matchLibraryEntry,
  pickSeriesPageCover,
} from "@/utils/detection/cover-hunt";
import {
  type DetectionContext,
  readPage,
  settleDelayFor,
  thresholdFor,
} from "@/utils/detection/detect";
import { seriesUrlFromChapterPath } from "@/utils/detection/heuristics";
import { ruleForHost, seriesFromRule } from "@/utils/detection/site-rule";
import type { CoverHealStatus } from "@/utils/detection-log";
import {
  deliveryOf,
  isContentCommand,
  sendRuntimeMessage,
} from "@/utils/messages";
import {
  isRead,
  type ReadingRequirement,
  requirementFrom,
  scrollPercent,
} from "@/utils/reading-gate";

// How often a page waiting on "lectura real" checks whether it has been read.
const READING_CHECK_MS = 1000;

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
    // A page waiting to be read, so a title change while it waits does not
    // start a second wait for the same chapter.
    let waitingUrl: string | null = null;
    let settleTimer: number | undefined;
    // The first page waits the compiled delay; once the backend has said how
    // long this site needs, later ones wait that.
    let settleDelayMs = DEFAULT_DETECTION_CONFIG.settleDelayMs;

    /**
     * Everything the backend said that bears on this page, from the
     * background's caches — none of it waits on the network once cached.
     */
    async function loadContext(): Promise<{
      context: DetectionContext;
      requirement: ReadingRequirement | null;
    }> {
      const [rules, remote] = await Promise.all([
        sendRuntimeMessage({ kind: "get-site-rules" }),
        sendRuntimeMessage({ kind: "get-extension-config" }),
      ]);
      const config = compileDetectionConfig(remote?.detection);
      const rule = ruleForHost(rules, location.hostname);
      settleDelayMs = settleDelayFor(rule, config);
      return {
        context: { config, themes: remote?.themes ?? [], rule },
        requirement: requirementFrom(remote?.reading),
      };
    }

    async function detectAndReport(): Promise<void> {
      const url = location.href;
      if (url === lastReportedUrl || url === waitingUrl) {
        return;
      }

      // The site's calibration, or its curated rule — served from the
      // background's cache when the backend is away, so a calibrated site is
      // still detected while its readings wait in the outbox.
      const [selectors, { context, requirement }] = await Promise.all([
        sendRuntimeMessage({
          kind: "get-selectors",
          domain: location.hostname,
        }),
        loadContext(),
      ]);

      const reading = readPage(document, url, selectors, context);
      const { detection } = reading;
      // The background keeps the last run per tab so the popup can explain
      // why a page did or did not track, and offer what the page links to.
      console.debug("[manga-tracker] detection", url, reading);
      void sendRuntimeMessage({
        kind: "report-detection",
        url,
        detection,
        facts: {
          theme: reading.theme,
          seriesLinkUrl: reading.seriesLinkUrl,
          nextUrl: reading.nextUrl,
        },
      });
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
      if (detection.confidence < thresholdFor(context.rule, context.config)) {
        void sendRuntimeMessage({
          kind: "report-delivery",
          url,
          delivery: { status: "below-threshold" },
        });
        return;
      }

      if (requirement !== null) {
        void sendRuntimeMessage({
          kind: "report-delivery",
          url,
          delivery: { status: "waiting", ...requirement },
        });
        waitingUrl = url;
        const read = await waitUntilRead(url, requirement).finally(() => {
          waitingUrl = null;
        });
        if (!read) {
          // Left before reading it: not a chapter read.
          return;
        }
      }

      // Stable identity within this site, independent of how the site writes
      // its <title> today. Three sources, in order of how much they know:
      // a curated rule from the backend is a deliberate statement about this
      // site; the anchor (found by the site's rule, its theme, or the page's
      // own links) is evidence the page itself gives; the path is the generic
      // guess. Omitted when none of them can say.
      const ruled =
        context.rule === null ? null : seriesFromRule(context.rule, url);
      const anchorUrl = reading.seriesLinkUrl;
      const seriesUrl =
        ruled?.url ??
        anchorUrl ??
        seriesUrlFromChapterPath(url, context.config);
      // What the cover hunt may download. A rule that composes an identity
      // rather than finding one names no page, and asking the site for it
      // would read as "this manga has no cover".
      const coverSeriesUrl =
        ruled !== null && !ruled.navigable ? anchorUrl : seriesUrl;
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
        delivery: deliveryOf(recorded),
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
            coverSeriesUrl,
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
      // The cards read on this site, asked for once per visit: what the
      // attempts wait for is the page's artwork, not the library.
      let candidates: LibraryEntryDto[] | null = null;
      try {
        for (let attempt = 0; attempt < COVER_CAPTURE_ATTEMPTS; attempt++) {
          if (attempt > 0) {
            await sleep(COVER_CAPTURE_RETRY_MS);
          }
          if (location.href !== url || url === lastCoverCheckUrl) {
            return;
          }
          try {
            if (candidates === null) {
              const library = await sendRuntimeMessage({
                kind: "get-library-for-site",
                domain: location.hostname,
              });
              if (!library.ok) {
                // The backend is away; the next attempt asks again.
                continue;
              }
              candidates = library.data;
            }
            if (await tryCaptureCoverOnce(candidates)) {
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

    async function tryCaptureCoverOnce(
      candidates: LibraryEntryDto[],
    ): Promise<boolean> {
      const heading = document.querySelector("h1")?.textContent ?? "";
      const entry = matchLibraryEntry(
        candidates,
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

    /**
     * Resolves true once the page has been read as the settings ask, false
     * the moment the tab moves on to another page (or this script is torn
     * down). Time counts only while the tab is visible; scroll counts the
     * window's and any inner reader container's, whichever got further.
     */
    function waitUntilRead(
      url: string,
      requirement: ReadingRequirement,
    ): Promise<boolean> {
      return new Promise((resolve) => {
        let visibleMs = 0;
        let maxScrolled = 0;
        let last = performance.now();
        let done = false;

        const windowPercent = () =>
          scrollPercent(
            window.scrollY,
            window.innerHeight,
            document.documentElement.scrollHeight,
          );
        // Capture phase on document: scroll does not bubble, and some
        // readers scroll a container rather than the window.
        const onScroll = (event: Event) => {
          const target = event.target;
          const percent =
            target instanceof Element
              ? scrollPercent(
                  target.scrollTop,
                  target.clientHeight,
                  target.scrollHeight,
                )
              : windowPercent();
          maxScrolled = Math.max(maxScrolled, percent);
        };
        document.addEventListener("scroll", onScroll, {
          capture: true,
          passive: true,
        });

        const finish = (read: boolean) => {
          if (done) {
            return;
          }
          done = true;
          window.clearInterval(timer);
          document.removeEventListener("scroll", onScroll, true);
          resolve(read);
        };
        const timer = ctx.setInterval(() => {
          const now = performance.now();
          if (document.visibilityState === "visible") {
            visibleMs += now - last;
          }
          last = now;
          if (location.href !== url) {
            finish(false);
            return;
          }
          // The window's current position counts too: a page that cannot
          // scroll is at 100 % without a single scroll event. Only real
          // scrolls are remembered, so a reader whose images had not loaded
          // yet (a short page, briefly) does not pass on that alone.
          const progress = {
            visibleMs,
            maxScrollPercent: Math.max(maxScrolled, windowPercent()),
          };
          if (isRead(progress, requirement)) {
            finish(true);
          }
        }, READING_CHECK_MS);
        ctx.onInvalidated(() => finish(false));
      });
    }

    function scheduleDetection(): void {
      window.clearTimeout(settleTimer);
      settleTimer = ctx.setTimeout(() => {
        // Rejects when the extension was reloaded under an open tab: this
        // script's context is gone and it can no longer message anyone.
        // Nothing to recover — the reloaded extension reinjects a fresh one.
        detectAndReport().catch((cause: unknown) =>
          console.debug("[manga-tracker] detection stopped", cause),
        );
      }, settleDelayMs);
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
