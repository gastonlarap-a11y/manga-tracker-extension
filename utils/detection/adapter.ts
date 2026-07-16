import type { SiteAdapterDto } from "../api/types";
import type { Detection } from "./heuristics";

// A calibrated adapter is user-confirmed, so a successful match is fully
// trusted. Returns null when the adapter no longer matches the page (site
// changed its HTML) so the caller can fall back to heuristics.
export function detectFromAdapter(
  adapter: SiteAdapterDto,
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
