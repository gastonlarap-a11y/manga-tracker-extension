// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { pickElement } from "./calibration";

function loadBody(html: string): void {
  document.body.innerHTML = html;
}

describe("pickElement", () => {
  it("builds a selector that round-trips to the clicked element", () => {
    loadBody(
      '<main><h1 class="series-title">Segunda Vida Para Ser Un Ranker</h1></main>',
    );
    const element = document.querySelector("h1");
    if (!element) {
      throw new Error("fixture missing h1");
    }

    const pick = pickElement(element, document);

    expect(pick).not.toBeNull();
    expect(pick?.text).toBe("Segunda Vida Para Ser Un Ranker");
    expect(document.querySelector(pick?.selector ?? "")).toBe(element);
  });

  it("distinguishes between repeated siblings", () => {
    loadBody(
      "<ul><li>Capítulo 223</li><li>Capítulo 224</li><li>Capítulo 225</li></ul>",
    );
    const second = document.querySelectorAll("li")[1];
    if (!second) {
      throw new Error("fixture missing li");
    }

    const pick = pickElement(second, document);

    expect(pick?.text).toBe("Capítulo 224");
    expect(document.querySelector(pick?.selector ?? "")).toBe(second);
  });

  it("rejects elements without visible text", () => {
    loadBody('<div><img src="page.jpg" alt=""></div>');
    const image = document.querySelector("img");
    if (!image) {
      throw new Error("fixture missing img");
    }

    expect(pickElement(image, document)).toBeNull();
  });
});
