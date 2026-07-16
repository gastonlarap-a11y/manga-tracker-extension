import type { SiteAdapterDto } from "../api/types";
import { detectFromAdapter } from "./adapter";
import type { Detection } from "./heuristics";
import { detectFromHeuristics } from "./heuristics";
import { collectPageSignals } from "./page-signals";

// Phase 6 pipeline: calibrated adapter first, heuristics as fallback.
export function detectReading(
  doc: Document,
  url: string,
  adapter: SiteAdapterDto | null,
): Detection {
  if (adapter) {
    const detection = detectFromAdapter(adapter, doc, url);
    if (detection) {
      return detection;
    }
  }
  return detectFromHeuristics(collectPageSignals(doc, url));
}
