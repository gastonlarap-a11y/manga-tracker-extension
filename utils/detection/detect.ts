import type { SiteRuleDto, SiteThemeDto } from "../api/types";
import { type DetectionSelectors, detectFromAdapter } from "./adapter";
import { DEFAULT_DETECTION_CONFIG, type DetectionConfig } from "./config";
import type { Detection } from "./heuristics";
import { detectFromHeuristics } from "./heuristics";
import {
  collectPageSignals,
  type PageHints,
  seriesUrlFrom,
} from "./page-signals";
import { nextChapterUrl, themeFor } from "./themes";

/** What detection knows beyond the page: everything the backend told it. */
export interface DetectionContext {
  config: DetectionConfig;
  themes: readonly SiteThemeDto[];
  /** The site's curated rule, when the catalogue has one. */
  rule: SiteRuleDto | null;
}

export const NO_CONTEXT: DetectionContext = {
  config: DEFAULT_DETECTION_CONFIG,
  themes: [],
  rule: null,
};

/** One read of a page: the verdict, and what the popup can offer from it. */
export interface PageReading {
  detection: Detection;
  /** The theme that recognised the page, shown in the popup. */
  theme: string | null;
  /** The series page this page links back to, when it does. */
  seriesLinkUrl: string | null;
  /** The next chapter's address, when the theme or rule knows its link. */
  nextUrl: string | null;
}

/**
 * Reads a page, in order of how much each source knows: the user's
 * calibration (or the site's curated selectors) first, then the heuristic —
 * fed the hints the site's rule and theme give it.
 */
export function readPage(
  doc: Document,
  url: string,
  selectors: DetectionSelectors | null,
  context: DetectionContext = NO_CONTEXT,
): PageReading {
  const { rule } = context;
  const theme = themeFor(doc, context.themes);
  const hints: PageHints = {
    reader: theme !== null,
    headingSelector: theme?.headingSelector ?? null,
    // The site's own rule over its theme: it was written for this one site.
    seriesLinkSelector:
      rule?.seriesLinkSelector ?? theme?.seriesLinkSelector ?? null,
    sectionSegments: context.config.sectionSegments,
  };
  const facts = {
    theme: theme?.name ?? null,
    seriesLinkUrl: seriesUrlFrom(doc, url, hints),
    nextUrl: nextChapterUrl(doc, url, [
      rule?.nextSelector,
      theme?.nextSelector,
    ]),
  };

  if (isIgnoredPath(rule, url)) {
    return {
      ...facts,
      detection: { detected: false, reason: "ignored-path" },
    };
  }
  if (selectors) {
    const detection = detectFromAdapter(selectors, doc, url);
    if (detection) {
      return { ...facts, detection };
    }
  }
  return {
    ...facts,
    detection: detectFromHeuristics(
      collectPageSignals(doc, url, hints),
      context.config,
    ),
  };
}

/** The calibrated adapter first, heuristics as fallback; no backend context. */
export function detectReading(
  doc: Document,
  url: string,
  adapter: DetectionSelectors | null,
): Detection {
  return readPage(doc, url, adapter).detection;
}

/** The threshold this site's readings have to reach to be recorded. */
export function thresholdFor(
  rule: SiteRuleDto | null,
  config: DetectionConfig,
): number {
  const own = rule?.confidenceThreshold;
  return typeof own === "number" && own > 0 && own <= 1
    ? own
    : config.confidenceThreshold;
}

/** How long a page on this site is given to settle before it is read. */
export function settleDelayFor(
  rule: SiteRuleDto | null,
  config: DetectionConfig,
): number {
  const own = rule?.settleDelayMs;
  return typeof own === "number" &&
    Number.isInteger(own) &&
    own >= 0 &&
    own <= 30_000
    ? own
    : config.settleDelayMs;
}

function isIgnoredPath(rule: SiteRuleDto | null, url: string): boolean {
  for (const source of rule?.ignorePaths ?? []) {
    try {
      if (new RegExp(source, "i").test(url)) {
        return true;
      }
    } catch {
      // A malformed pattern ignores nothing.
    }
  }
  return false;
}
