// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { type Box, pickElement, pickTarget } from "./calibration";

function loadBody(html: string): void {
  document.body.innerHTML = html;
}

function query(selector: string): Element {
  const element = document.querySelector(selector);
  if (!element) {
    throw new Error(`fixture missing ${selector}`);
  }
  return element;
}

describe("pickElement", () => {
  it("builds a selector that round-trips to the clicked element", () => {
    loadBody(
      '<main><h1 class="series-title">Segunda Vida Para Ser Un Ranker</h1></main>',
    );
    const element = query("h1");

    const result = pickElement(element, document);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pick.text).toBe("Segunda Vida Para Ser Un Ranker");
    expect(document.querySelector(result.pick.selector)).toBe(element);
  });

  it("distinguishes between repeated siblings", () => {
    loadBody(
      "<ul><li>Capítulo 223</li><li>Capítulo 224</li><li>Capítulo 225</li></ul>",
    );
    const second = document.querySelectorAll("li")[1];
    if (!second) {
      throw new Error("fixture missing li");
    }

    const result = pickElement(second, document);

    expect(result.ok && result.pick.text).toBe("Capítulo 224");
    expect(result.ok && document.querySelector(result.pick.selector)).toBe(
      second,
    );
  });

  it("collapses the whitespace a layout puts inside a title", () => {
    loadBody("<h1>\n   Soy un Dios\n   Maligno  </h1>");

    const result = pickElement(query("h1"), document);

    expect(result.ok && result.pick.text).toBe("Soy un Dios Maligno");
  });

  it("says an element without visible text is not a pick", () => {
    loadBody('<div><img src="page.jpg" alt=""></div>');

    expect(pickElement(query("img"), document)).toEqual({
      ok: false,
      reason: "no-text",
    });
  });

  it("says a whole block of the page is not a title", () => {
    loadBody(
      `<article><p>${"Una sinopsis muy larga. ".repeat(12)}</p></article>`,
    );

    expect(pickElement(query("article"), document)).toEqual({
      ok: false,
      reason: "too-much-text",
    });
  });
});

describe("pickTarget", () => {
  const viewport: Box = { width: 1000, height: 800 };
  const boxes = new Map<Element, Box>();
  const options = {
    isOwn: (element: Element) =>
      element.tagName.toLowerCase() === "manga-tracker-calibration",
    boxOf: (element: Element) => boxes.get(element) ?? { width: 0, height: 0 },
  };

  function stack(...elements: [Element, Box][]): Element[] {
    for (const [element, box] of elements) {
      boxes.set(element, box);
    }
    return elements.map(([element]) => element);
  }

  it("skips the transparent ad layer laid over the whole page", () => {
    // The layer is what an event's target says was clicked; the title under
    // it is what the reader clicked.
    const overlay = document.createElement("div");
    const title = document.createElement("h1");

    const target = pickTarget(
      stack(
        [overlay, { width: 1000, height: 800 }],
        [title, { width: 600, height: 40 }],
      ),
      viewport,
      options,
    );

    expect(target).toBe(title);
  });

  it("skips its own overlay, the document roots and frames", () => {
    const own = document.createElement("manga-tracker-calibration");
    const frame = document.createElement("iframe");
    const chapter = document.createElement("span");

    const target = pickTarget(
      stack(
        [own, { width: 0, height: 0 }],
        [frame, { width: 300, height: 250 }],
        [chapter, { width: 120, height: 20 }],
        [document.body, { width: 1000, height: 5000 }],
        [document.documentElement, { width: 1000, height: 5000 }],
      ),
      viewport,
      options,
    );

    expect(target).toBe(chapter);
  });

  it("keeps a full-width element that does not cover the page", () => {
    // A title bar spans the page but is short: that is a pick, not a layer.
    const banner = document.createElement("header");

    expect(
      pickTarget(
        stack([banner, { width: 1000, height: 60 }]),
        viewport,
        options,
      ),
    ).toBe(banner);
  });

  it("finds nothing when only the page itself is under the pointer", () => {
    expect(
      pickTarget(
        stack([document.body, { width: 1000, height: 5000 }]),
        viewport,
        options,
      ),
    ).toBeNull();
  });
});
