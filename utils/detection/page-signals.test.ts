// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { collectPageSignals, coverFromDocument } from "./page-signals";

const URL_UNDER_TEST = "https://example.com/one-piece/capitulo/1100";

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  document.title = "";
});

describe("collectPageSignals", () => {
  it("collects every available signal", () => {
    document.head.innerHTML = `
      <meta property="og:title" content="OG title" />
      <meta name="twitter:title" content="Twitter title" />
    `;
    document.title = "Doc title";
    document.body.innerHTML = "<h1>Heading title</h1>";

    expect(collectPageSignals(document, URL_UNDER_TEST)).toEqual({
      url: URL_UNDER_TEST,
      documentTitle: "Doc title",
      ogTitle: "OG title",
      twitterTitle: "Twitter title",
      firstHeading: "Heading title",
    });
  });

  it("returns null for missing or empty signals", () => {
    document.head.innerHTML = '<meta property="og:title" content="   " />';
    document.body.innerHTML = "<h1>   </h1><h1>Second heading</h1>";

    const signals = collectPageSignals(document, URL_UNDER_TEST);

    expect(signals.ogTitle).toBeNull();
    expect(signals.twitterTitle).toBeNull();
    expect(signals.firstHeading).toBe("Second heading");
  });
});

describe("coverFromDocument", () => {
  it("returns the og:image url", () => {
    document.head.innerHTML =
      '<meta property="og:image" content="https://cdn.example.com/cover.jpg" />';

    expect(coverFromDocument(document)).toBe(
      "https://cdn.example.com/cover.jpg",
    );
  });

  it("falls back to twitter:image", () => {
    document.head.innerHTML =
      '<meta name="twitter:image" content="https://cdn.example.com/tw.jpg" />';

    expect(coverFromDocument(document)).toBe("https://cdn.example.com/tw.jpg");
  });

  it("returns null when the page declares no image", () => {
    expect(coverFromDocument(document)).toBeNull();
  });

  it("rejects non-http schemes", () => {
    document.head.innerHTML =
      '<meta property="og:image" content="data:image/png;base64,xyz" />';

    expect(coverFromDocument(document)).toBeNull();
  });
});
