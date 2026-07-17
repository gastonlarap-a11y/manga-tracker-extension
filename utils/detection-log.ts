import type { Detection } from "./detection/heuristics";

export interface DetectionEntry {
  url: string;
  detection: Detection;
}

// Last detector run per tab, kept in the service worker so the popup can
// explain WHY a page did or did not track. In-memory on purpose: Chrome may
// kill the worker when idle and the log restarts empty — the popup then shows
// "no detection yet", which is accurate for a fresh worker.
const entries = new Map<number, DetectionEntry>();

export function recordDetection(tabId: number, entry: DetectionEntry): void {
  entries.set(tabId, entry);
}

export function getDetection(tabId: number): DetectionEntry | null {
  return entries.get(tabId) ?? null;
}

export function clearTab(tabId: number): void {
  entries.delete(tabId);
}
