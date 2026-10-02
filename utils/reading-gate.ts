/**
 * "Lectura real": a chapter counts once it has been read, not the moment its
 * page opened. Off by default — every release before 0.2.0 recorded on sight,
 * and someone skimming a site's list of chapters would otherwise see none of
 * them recorded without knowing why. Turned on and tuned from the dashboard;
 * the values arrive with the extension config.
 *
 * Two conditions, both required, either dropped by setting it to 0: the page
 * stayed visible long enough, and it was scrolled far enough. Time alone
 * counts a tab left open in the background; scroll alone counts a fling to the
 * bottom. MAL-Sync settles on 90 % of a chapter's pages for the same reason.
 */
import type { ReadingSettingsDto } from "./api/types";

export interface ReadingRequirement {
  minSeconds: number;
  minScrollPercent: number;
}

export interface ReadingProgress {
  /** Time the page was visible, in ms; a hidden tab does not count. */
  visibleMs: number;
  /** The furthest the reader got down the page, 0–100. */
  maxScrollPercent: number;
}

/** What has to be met, or null when a page counts the moment it is read. */
export function requirementFrom(
  settings: ReadingSettingsDto | null | undefined,
): ReadingRequirement | null {
  if (!settings?.readingRequired) {
    return null;
  }
  const minSeconds = Math.max(0, settings.readMinSeconds);
  const minScrollPercent = Math.min(
    100,
    Math.max(0, settings.readMinScrollPercent),
  );
  if (minSeconds === 0 && minScrollPercent === 0) {
    return null;
  }
  return { minSeconds, minScrollPercent };
}

export function isRead(
  progress: ReadingProgress,
  requirement: ReadingRequirement,
): boolean {
  return (
    progress.visibleMs >= requirement.minSeconds * 1000 &&
    progress.maxScrollPercent >= requirement.minScrollPercent
  );
}

/**
 * How far down the page the bottom of the viewport is, 0–100. A page that
 * does not scroll — a paged reader showing one image — is read all the way
 * down by definition: holding it to a scroll it cannot make would never
 * record it.
 */
export function scrollPercent(
  scrollTop: number,
  viewportHeight: number,
  scrollHeight: number,
): number {
  if (scrollHeight <= viewportHeight) {
    return 100;
  }
  const seen = ((scrollTop + viewportHeight) / scrollHeight) * 100;
  return Math.min(100, Math.max(0, Math.round(seen)));
}
