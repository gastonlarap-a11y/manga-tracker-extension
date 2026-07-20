import type { Detection } from "./detection/heuristics";

// Result of forwarding a passing detection to the backend, so the popup can
// tell "detected" apart from "detected AND saved" — a failed POST used to be
// completely invisible. Absent while the send is in flight or when the
// detection never reached the threshold.
export type DeliveryStatus =
  | { status: "sent" }
  | { status: "failed"; error: string };

// Outcome of the cover byte-heal chain (in-page fetch → pixel capture), so
// the popup can say why a cover is still missing instead of failing silently.
export type CoverHealStatus =
  | { status: "healed" }
  | { status: "failed"; error: string };

export interface DetectionEntry {
  url: string;
  detection: Detection;
  delivery?: DeliveryStatus;
  coverHeal?: CoverHealStatus;
}

// Last detector run per tab, kept in the service worker so the popup can
// explain WHY a page did or did not track. In-memory on purpose: Chrome may
// kill the worker when idle and the log restarts empty — the popup then shows
// "no detection yet", which is accurate for a fresh worker.
const entries = new Map<number, DetectionEntry>();

export function recordDetection(tabId: number, entry: DetectionEntry): void {
  entries.set(tabId, entry);
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
    entries.set(tabId, { ...entry, delivery });
  }
}

export function recordCoverHeal(
  tabId: number,
  url: string,
  coverHeal: CoverHealStatus,
): void {
  const entry = entries.get(tabId);
  if (entry && entry.url === url) {
    entries.set(tabId, { ...entry, coverHeal });
  }
}

export function getDetection(tabId: number): DetectionEntry | null {
  return entries.get(tabId) ?? null;
}

export function clearTab(tabId: number): void {
  entries.delete(tabId);
}
