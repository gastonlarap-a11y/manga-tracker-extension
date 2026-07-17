import { finder } from "@medv/finder";

export interface CalibrationPick {
  selector: string;
  text: string;
}

// A pick is only valid when the generated selector re-finds exactly the
// clicked element (round-trip check): adapters run on future page loads, so
// an ambiguous selector would silently track the wrong text.
export function pickElement(
  element: Element,
  doc: Document,
): CalibrationPick | null {
  const text = element.textContent?.trim() ?? "";
  if (text.length === 0) {
    return null;
  }

  let selector: string;
  try {
    selector = doc.body ? finder(element, { root: doc.body }) : finder(element);
  } catch {
    // finder throws when no unique selector exists for the element.
    return null;
  }

  return doc.querySelector(selector) === element ? { selector, text } : null;
}
