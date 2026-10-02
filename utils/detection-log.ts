import type { Detection } from "./detection/heuristics";
import type { HoldReason } from "./tracking-prefs";

// Result of forwarding a passing detection to the backend, so the popup can
// tell "detected" apart from "detected AND saved" — a failed POST used to be
// completely invisible. Absent while the send is in flight.
export type DeliveryStatus =
  // `mangaId` names the card the reading landed on, for "Ver en la
  // biblioteca". Absent on a report from a detector older than it.
  | { status: "sent"; mangaId?: string }
  // The backend was not reachable; the reading waits in utils/outbox.ts.
  | { status: "queued" }
  | { status: "failed"; error: string }
  // Detected, but under the threshold: shown, never recorded.
  | { status: "below-threshold" }
  // "Lectura real" is on, and the page has not been read long enough yet.
  | { status: "waiting"; minSeconds: number; minScrollPercent: number }
  // Paused, or a private window that does not record.
  | { status: "held"; reason: HoldReason };

// Outcome of the cover byte-heal chain (in-page fetch → pixel capture), so
// the popup can say why a cover is still missing instead of failing silently.
export type CoverHealStatus =
  | { status: "healed" }
  | { status: "failed"; error: string };

/** What a page offered beyond the verdict (utils/detection/detect.ts). */
export interface PageFacts {
  theme: string | null;
  seriesLinkUrl: string | null;
  nextUrl: string | null;
}

export interface DetectionEntry {
  url: string;
  detection: Detection;
  facts?: PageFacts;
  delivery?: DeliveryStatus;
  coverHeal?: CoverHealStatus;
}

// Last detector run per tab, kept in the service worker so the popup can
// explain WHY a page did or did not track. In-memory on purpose: Chrome may
// kill the worker when idle and the log restarts empty — the popup then shows
// "no detection yet", which is accurate for a fresh worker.
const entries = new Map<number, DetectionEntry>();

type Listener = (tabId: number, entry: DetectionEntry | null) => void;
const listeners = new Set<Listener>();

/**
 * Called whenever a tab's entry changes — the toolbar badge follows the log
 * without every writer having to remember it.
 */
export function onDetectionChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function set(tabId: number, entry: DetectionEntry | null): void {
  if (entry === null) {
    entries.delete(tabId);
  } else {
    entries.set(tabId, entry);
  }
  for (const listener of listeners) {
    listener(tabId, entry);
  }
}

export function recordDetection(tabId: number, entry: DetectionEntry): void {
  set(tabId, entry);
}

// The url guard keeps a late delivery report from tagging the detection of a
// page the tab has already navigated away from.
export function recordDelivery(
  tabId: number,
  url: string,
  delivery: DeliveryStatus,
): void {
  const entry = entries.get(tabId);
  if (entry && entry.url === url) {
    set(tabId, { ...entry, delivery });
  }
}

export function recordCoverHeal(
  tabId: number,
  url: string,
  coverHeal: CoverHealStatus,
): void {
  const entry = entries.get(tabId);
  if (entry && entry.url === url) {
    set(tabId, { ...entry, coverHeal });
  }
}

export function getDetection(tabId: number): DetectionEntry | null {
  return entries.get(tabId) ?? null;
}

/** Every tab with an entry, for repainting all badges at once (a pause). */
export function trackedTabs(): number[] {
  return [...entries.keys()];
}

export function clearTab(tabId: number): void {
  if (entries.has(tabId)) {
    set(tabId, null);
  }
}
