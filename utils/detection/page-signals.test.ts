// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  collectPageSignals,
  coverFromDocument,
  seriesUrlFrom,
} from "./page-signals";

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
      <meta property="og:site_name" content="Example Scan" />
    `;
    document.title = "Doc title";
    document.body.innerHTML = `
      <h1>Heading title</h1>
      <a href="https://example.com/one-piece/">One Piece</a>
    `;

    expect(collectPageSignals(document, URL_UNDER_TEST)).toEqual({
      url: URL_UNDER_TEST,
      documentTitle: "Doc title",
      ogTitle: "OG title",
      twitterTitle: "Twitter title",
      firstHeading: "Heading title",
      siteName: "Example Scan",
      seriesLinkTitle: "One Piece",
    });
  });

  it("returns null for missing or empty signals", () => {
    document.head.innerHTML = '<meta property="og:title" content="   " />';
    document.body.innerHTML = "<h1>   </h1><h1>Second heading</h1>";

    const signals = collectPageSignals(document, URL_UNDER_TEST);

    expect(signals.ogTitle).toBeNull();
    expect(signals.twitterTitle).toBeNull();
    expect(signals.firstHeading).toBe("Second heading");
    expect(signals.siteName).toBeNull();
    expect(signals.seriesLinkTitle).toBeNull();
  });
});

describe("series link signal", () => {
  const CHAPTER_URL =
    "https://mhscans.com/series/espadachin-a-tiempo-completo/capitulo-89-pack/";

  it("finds the breadcrumb anchor whose href prefixes the chapter path", () => {
    document.body.innerHTML = `
      <ol>
        <li><a href="https://mhscans.com/">Home</a></li>
        <li><a href="https://mhscans.com/manga/">All Mangas</a></li>
        <li>
          <a href="https://mhscans.com/series/espadachin-a-tiempo-completo/">
            Espadachín a Tiempo Completo
          </a>
        </li>
      </ol>
      <a href="https://mhscans.com/series/espadachin-a-tiempo-completo/capitulo-88/">
        Capítulo 88
      </a>
    `;

    expect(collectPageSignals(document, CHAPTER_URL).seriesLinkTitle).toBe(
      "Espadachín a Tiempo Completo",
    );
  });

  it("resolves relative hrefs against the page url", () => {
    document.body.innerHTML =
      '<a href="/series/espadachin-a-tiempo-completo/">Espadachín a Tiempo Completo</a>';

    expect(collectPageSignals(document, CHAPTER_URL).seriesLinkTitle).toBe(
      "Espadachín a Tiempo Completo",
    );
  });

  it("rejects anchors whose text does not round-trip against their slug", () => {
    document.body.innerHTML =
      '<a href="/series/espadachin-a-tiempo-completo/">Ver todos los capítulos</a>';

    expect(
      collectPageSignals(document, CHAPTER_URL).seriesLinkTitle,
    ).toBeNull();
  });

  it("ignores cross-origin anchors", () => {
    document.body.innerHTML =
      '<a href="https://other.com/series/espadachin-a-tiempo-completo/">Espadachín a Tiempo Completo</a>';

    expect(
      collectPageSignals(document, CHAPTER_URL).seriesLinkTitle,
    ).toBeNull();
  });
});

describe("seriesUrlFrom", () => {
  const CHAPTER_URL =
    "https://mhscans.com/series/espadachin-a-tiempo-completo/capitulo-89-pack/";

  it("returns the absolute series url the chapter hangs off", () => {
    // Sent to the backend as identity within the site: it survives the site
    // reformatting its <title>, which a title-derived slug does not.
    document.body.innerHTML =
      '<a href="/series/espadachin-a-tiempo-completo/">Espadachín a Tiempo Completo</a>';

    expect(seriesUrlFrom(document, CHAPTER_URL)).toBe(
      "https://mhscans.com/series/espadachin-a-tiempo-completo/",
    );
  });

  it("is null when the page has no usable series link", () => {
    document.body.innerHTML =
      '<a href="/series/espadachin-a-tiempo-completo/">Ver todos los capítulos</a>';

    expect(seriesUrlFrom(document, CHAPTER_URL)).toBeNull();
  });

  it("stays consistent with the title signal it shares its search with", () => {
    document.body.innerHTML =
      '<a href="/series/espadachin-a-tiempo-completo/">Espadachín a Tiempo Completo</a>';

    expect(seriesUrlFrom(document, CHAPTER_URL)).not.toBeNull();
    expect(collectPageSignals(document, CHAPTER_URL).seriesLinkTitle).not.toBe(
      null,
    );
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

  it("rejects site branding images (olympus logo case)", () => {
    document.head.innerHTML =
      '<meta property="og:image" content="https://olympusxyz.com/olympus-logo-180.webp" />';

    expect(coverFromDocument(document)).toBeNull();
  });
});
