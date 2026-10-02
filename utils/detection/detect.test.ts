// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import type { SiteRuleDto, SiteThemeDto } from "../api/types";
import { DEFAULT_DETECTION_CONFIG } from "./config";
import {
  type DetectionContext,
  readPage,
  settleDelayFor,
  thresholdFor,
} from "./detect";
import { nextChapterUrl, themeFor } from "./themes";

const MADARA: SiteThemeDto = {
  name: "madara",
  readerMarker: ".reading-content .page-break",
  headingSelector: "#chapter-heading",
  seriesLinkSelector: ".breadcrumb li a",
  nextSelector: "a.next_page",
};

function rule(overrides: Partial<SiteRuleDto> = {}): SiteRuleDto {
  return {
    domain: "example.com",
    series: null,
    titleSelector: null,
    chapterSelector: null,
    chapterUrlRegex: null,
    ...overrides,
  };
}

function context(overrides: Partial<DetectionContext> = {}): DetectionContext {
  return {
    config: DEFAULT_DETECTION_CONFIG,
    themes: [MADARA],
    rule: null,
    ...overrides,
  };
}

// A Madara chapter page, reduced to the markup the theme always emits.
function madaraChapter(): void {
  document.title = "Example Scans";
  document.head.innerHTML =
    '<meta property="og:title" content="Example Scans - Leer manga online" /><meta property="og:site_name" content="Example Scans" />';
  document.body.innerHTML = `
    <ol class="breadcrumb">
      <li><a href="/">Inicio</a></li>
      <li><a href="/manga/">Manga</a></li>
      <li><a href="/manga/torre-de-dios/">Torre de Dios</a></li>
      <li class="active">Capítulo 12</li>
    </ol>
    <h1 id="chapter-heading">Torre de Dios - Capítulo 12</h1>
    <div class="reading-content"><div class="page-break"><img src="/p1.jpg"></div></div>
    <a class="next_page" href="/manga/torre-de-dios/capitulo-13/">Siguiente</a>
  `;
}

const CHAPTER_URL = "https://example.com/manga/torre-de-dios/capitulo-12/";

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  document.title = "";
});

describe("readPage", () => {
  it("reads a theme's page from the theme's own markup", () => {
    madaraChapter();

    const reading = readPage(document, CHAPTER_URL, null, context());

    expect(reading).toEqual({
      theme: "madara",
      seriesLinkUrl: "https://example.com/manga/torre-de-dios/",
      nextUrl: "https://example.com/manga/torre-de-dios/capitulo-13/",
      detection: {
        detected: true,
        mangaName: "Torre de Dios",
        chapterLabel: "Cap. 12",
        confidence: 0.9,
      },
    });
  });

  it("lets a calibration win over the theme", () => {
    madaraChapter();
    document.body.insertAdjacentHTML(
      "beforeend",
      '<span class="mine">Nombre Calibrado</span>',
    );

    const reading = readPage(
      document,
      CHAPTER_URL,
      {
        titleSelector: ".mine",
        chapterSelector: "#chapter-heading",
        chapterUrlRegex: null,
      },
      context(),
    );

    expect(reading.detection).toMatchObject({
      mangaName: "Nombre Calibrado",
      confidence: 1,
    });
    // The facts still come from the page: the popup's buttons do not depend
    // on which source named the manga.
    expect(reading.nextUrl).not.toBeNull();
  });

  it("prefers the site's own series link over its theme's", () => {
    madaraChapter();
    document.body.insertAdjacentHTML(
      "beforeend",
      '<a class="serie" href="/obra/torre/">Torre de Dios</a>',
    );

    const reading = readPage(
      document,
      CHAPTER_URL,
      null,
      context({ rule: rule({ seriesLinkSelector: "a.serie" }) }),
    );

    expect(reading.seriesLinkUrl).toBe("https://example.com/obra/torre/");
  });

  it("never records a path the site's rule ignores", () => {
    madaraChapter();

    const reading = readPage(
      document,
      CHAPTER_URL,
      null,
      context({ rule: rule({ ignorePaths: ["/capitulo-12/$"] }) }),
    );

    expect(reading.detection).toEqual({
      detected: false,
      reason: "ignored-path",
    });
  });

  it("survives a rule whose ignore pattern does not compile", () => {
    madaraChapter();

    const reading = readPage(
      document,
      CHAPTER_URL,
      null,
      context({ rule: rule({ ignorePaths: ["(oops"] }) }),
    );

    expect(reading.detection.detected).toBe(true);
  });

  it("detects as before when the backend sent nothing", () => {
    document.title = "Torre de Dios Capítulo 12";

    const reading = readPage(document, CHAPTER_URL, null);

    expect(reading.theme).toBeNull();
    expect(reading.detection).toMatchObject({
      detected: true,
      mangaName: "Torre de Dios",
    });
  });
});

describe("themeFor", () => {
  it("applies no theme whose marker is missing, or cannot be parsed", () => {
    document.body.innerHTML = '<div id="readerarea"></div>';

    expect(themeFor(document, [MADARA])).toBeNull();
    expect(themeFor(document, [{ ...MADARA, readerMarker: ":::" }])).toBeNull();
  });
});

describe("nextChapterUrl", () => {
  it("only offers a link on the same site to another page", () => {
    document.body.innerHTML = `
      <a class="ext" href="https://otro.com/cap-13">13</a>
      <a class="self" href="${CHAPTER_URL}">12</a>
      <a class="next" href="/manga/torre-de-dios/capitulo-13/">13</a>
    `;

    expect(
      nextChapterUrl(document, CHAPTER_URL, ["a.ext", "a.self"]),
    ).toBeNull();
    expect(
      nextChapterUrl(document, CHAPTER_URL, [null, ":::", "a.ext", "a.next"]),
    ).toBe("https://example.com/manga/torre-de-dios/capitulo-13/");
  });
});

describe("per-site tuning", () => {
  it("uses the site's threshold and delay when they are sane", () => {
    expect(
      thresholdFor(
        rule({ confidenceThreshold: 0.6 }),
        DEFAULT_DETECTION_CONFIG,
      ),
    ).toBe(0.6);
    expect(
      settleDelayFor(rule({ settleDelayMs: 5000 }), DEFAULT_DETECTION_CONFIG),
    ).toBe(5000);
  });

  it("falls back to the global values otherwise", () => {
    for (const confidenceThreshold of [null, 0, 2]) {
      expect(
        thresholdFor(rule({ confidenceThreshold }), DEFAULT_DETECTION_CONFIG),
      ).toBe(DEFAULT_DETECTION_CONFIG.confidenceThreshold);
    }
    expect(settleDelayFor(null, DEFAULT_DETECTION_CONFIG)).toBe(
      DEFAULT_DETECTION_CONFIG.settleDelayMs,
    );
    expect(
      settleDelayFor(rule({ settleDelayMs: 99_999 }), DEFAULT_DETECTION_CONFIG),
    ).toBe(DEFAULT_DETECTION_CONFIG.settleDelayMs);
  });
});
