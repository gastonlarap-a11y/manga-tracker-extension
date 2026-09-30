import type { SiteAdapterDto } from "../api/types";
import type { Detection } from "./heuristics";

/**
 * What detection reads off a site: the selectors, and nothing about where they
 * came from. A calibration the user made and a curated rule from the backend
 * both fit, which is what lets a rule stand in when there is no calibration.
 */
export type DetectionSelectors = Pick<
  SiteAdapterDto,
  "titleSelector" | "chapterSelector" | "chapterUrlRegex"
>;

// A calibrated adapter is user-confirmed, and a curated rule is a deliberate
// statement about the site, so a successful match is fully trusted. Returns
// null when the selectors no longer match the page (site changed its HTML) so
// the caller can fall back to heuristics.
export function detectFromAdapter(
  adapter: DetectionSelectors,
  doc: Document,
  url: string,
): Detection | null {
  const mangaName = selectorText(doc, adapter.titleSelector);
  if (mangaName === null) {
    return null;
  }

  const chapterLabel =
    (adapter.chapterSelector
      ? selectorText(doc, adapter.chapterSelector)
      : null) ?? chapterFromRegex(adapter.chapterUrlRegex, url);
  if (chapterLabel === null) {
    return null;
  }

  return { detected: true, mangaName, chapterLabel, confidence: 1 };
}

function selectorText(doc: Document, selector: string): string | null {
  let text: string | undefined;
  try {
    text = doc.querySelector(selector)?.textContent?.trim();
  } catch {
    // Invalid selector stored in the adapter: treat as a miss.
    return null;
  }
  return text ? text : null;
}

function chapterFromRegex(
  chapterUrlRegex: string | null,
  url: string,
): string | null {
  if (!chapterUrlRegex) {
    return null;
  }
  let match: RegExpExecArray | null;
  try {
    match = new RegExp(chapterUrlRegex, "i").exec(url);
  } catch {
    // Invalid regex stored in the adapter: treat as a miss.
    return null;
  }
  const captured = match?.[1];
  return captured ? `Cap. ${captured.replace(",", ".")}` : null;
}
