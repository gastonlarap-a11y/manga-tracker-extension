import { finder } from "@medv/finder";

export interface CalibrationPick {
  selector: string;
  text: string;
}

/**
 * Why a click did not become a pick — said on screen, never swallowed. A
 * rejected click that looked like nothing happened is what "calibrar no me
 * toma los clics" was, half the time.
 */
export type PickRejection =
  // An image, an icon, an empty wrapper.
  | "no-text"
  // A whole block: the click landed on a container, not on the title.
  | "too-much-text"
  // No selector finds this element and only it.
  | "no-selector";

export type PickResult =
  | { ok: true; pick: CalibrationPick }
  | { ok: false; reason: PickRejection };

/**
 * Past this, the element is a section of the page rather than a title or a
 * chapter label. The longest real title in the library is under 120.
 */
const MAX_PICK_TEXT = 160;

// A pick is only valid when the generated selector re-finds exactly the
// clicked element (round-trip check): adapters run on future page loads, so
// an ambiguous selector would silently track the wrong text.
//
// finder's defaults already refuse class names and ids that carry digits or
// look generated (`css-1x2y3z`), which is what keeps a selector working on the
// next chapter of the same site.
export function pickElement(element: Element, doc: Document): PickResult {
  const text = element.textContent?.replace(/\s+/g, " ").trim() ?? "";
  if (text.length === 0) {
    return { ok: false, reason: "no-text" };
  }
  if (text.length > MAX_PICK_TEXT) {
    return { ok: false, reason: "too-much-text" };
  }

  let selector: string;
  try {
    selector = doc.body ? finder(element, { root: doc.body }) : finder(element);
  } catch {
    // finder throws when no unique selector exists for the element.
    return { ok: false, reason: "no-selector" };
  }

  return doc.querySelector(selector) === element
    ? { ok: true, pick: { selector, text } }
    : { ok: false, reason: "no-selector" };
}

export interface Box {
  width: number;
  height: number;
}

/** Share of the viewport, in both directions, past which an element covers it. */
const COVERING_SHARE = 0.9;

/**
 * The page element a click at one point was meant for, out of everything
 * stacked under that point (`document.elementsFromPoint`, topmost first).
 *
 * The topmost element is not always it. Manga sites lay a transparent layer
 * over the whole page that opens an ad on the first click, and that layer is
 * what an event's target says was clicked — the title underneath never saw
 * it. So whatever covers the viewport is skipped, along with the overlay's
 * own host, the document's roots and frames (an ad, or someone else's page).
 * What is left, topmost first, is the element under the pointer as the
 * reader sees it.
 */
export function pickTarget(
  stack: readonly Element[],
  viewport: Box,
  options: {
    isOwn: (element: Element) => boolean;
    boxOf: (element: Element) => Box;
  },
): Element | null {
  for (const element of stack) {
    const tag = element.tagName.toLowerCase();
    if (
      tag === "html" ||
      tag === "body" ||
      tag === "iframe" ||
      options.isOwn(element)
    ) {
      continue;
    }
    const box = options.boxOf(element);
    if (
      box.width >= viewport.width * COVERING_SHARE &&
      box.height >= viewport.height * COVERING_SHARE
    ) {
      continue;
    }
    return element;
  }
  return null;
}
