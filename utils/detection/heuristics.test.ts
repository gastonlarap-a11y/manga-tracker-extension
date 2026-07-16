import { describe, expect, it } from "vitest";
import {
  CONFIDENCE_THRESHOLD,
  cleanMangaName,
  detectFromHeuristics,
  extractChapterFromUrl,
} from "./heuristics";
import type { PageSignals } from "./page-signals";

function signals(overrides: Partial<PageSignals>): PageSignals {
  return {
    url: "https://example.com/manga/one-piece/capitulo/1100",
    documentTitle: "",
    ogTitle: null,
    twitterTitle: null,
    firstHeading: null,
    ...overrides,
  };
}

describe("extractChapterFromUrl", () => {
  it.each([
    ["https://example.com/one-piece/capitulo/1100", "1100"],
    ["https://example.com/one-piece/capitulo-1100", "1100"],
    ["https://example.com/one-piece/cap-130.5", "130.5"],
    ["https://example.com/one-piece/chapter-12", "12"],
    ["https://example.com/one-piece/chapter/12", "12"],
    ["https://example.com/one-piece/ch-45", "45"],
    ["https://example.com/one-piece/c/45", "45"],
    ["https://example.com/serie/capitulo/130,5", "130.5"],
  ])("extracts the chapter from %s", (url, expected) => {
    expect(extractChapterFromUrl(url)).toBe(expected);
  });

  it.each([
    ["https://olympusxyz.com/", "catalog home"],
    ["https://example.com/biblioteca", "library listing"],
    ["https://example.com/manga/one-piece", "manga detail without chapter"],
    ["not a url", "invalid url"],
  ])("returns null for %s (%s)", (url) => {
    expect(extractChapterFromUrl(url)).toBeNull();
  });

  it("ignores chapter-like patterns in the query string", () => {
    expect(
      extractChapterFromUrl("https://example.com/search?q=/chapter-12"),
    ).toBeNull();
  });
});

describe("detectFromHeuristics", () => {
  it("does not detect catalog pages (no chapter in url)", () => {
    const result = detectFromHeuristics(
      signals({
        url: "https://olympusxyz.com/",
        ogTitle: "Olympus Scanlation | Lee cientos de cómics",
      }),
    );

    expect(result).toEqual({ detected: false, reason: "no-chapter-in-url" });
  });

  it("detects a chapter page from og:title with auto-send confidence", () => {
    const result = detectFromHeuristics(
      signals({
        url: "https://example.com/manga/one-piece/capitulo/1100",
        ogTitle: "One Piece Capítulo 1100 | Example Scan",
      }),
    );

    expect(result).toEqual({
      detected: true,
      mangaName: "One Piece",
      chapterLabel: "Cap. 1100",
      confidence: 0.8,
    });
    if (result.detected) {
      expect(result.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
    }
  });

  it("prefers og:title over the other title sources", () => {
    const result = detectFromHeuristics(
      signals({
        ogTitle: "From OG",
        twitterTitle: "From Twitter",
        firstHeading: "From Heading",
        documentTitle: "From Document",
      }),
    );

    expect(result).toMatchObject({ detected: true, mangaName: "From OG" });
  });

  it("keeps a heading-based detection at the auto-send threshold", () => {
    const result = detectFromHeuristics(
      signals({ firstHeading: "Solo Leveling" }),
    );

    expect(result).toMatchObject({ detected: true, confidence: 0.7 });
  });

  it("leaves a document-title-only detection below the threshold", () => {
    const result = detectFromHeuristics(
      signals({ documentTitle: "Solo Leveling cap 1100" }),
    );

    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.confidence).toBeLessThan(CONFIDENCE_THRESHOLD);
    }
  });

  it("does not detect when no title source exists", () => {
    const result = detectFromHeuristics(signals({ documentTitle: "  " }));

    expect(result).toEqual({ detected: false, reason: "no-title" });
  });
});

describe("cleanMangaName", () => {
  it("strips the site suffix after a pipe", () => {
    expect(cleanMangaName("One Piece | Example Scan", "12")).toBe("One Piece");
  });

  it.each([
    ["One Piece Capítulo 1100", "1100", "One Piece"],
    ["One Piece Capitulo 1100", "1100", "One Piece"],
    ["One Piece Cap. 130.5", "130.5", "One Piece"],
    ["One Piece cap 130,5", "130.5", "One Piece"],
    ["One Piece Chapter 12", "12", "One Piece"],
    ["One Piece Ch. 12", "12", "One Piece"],
  ])("removes the chapter fragment from %s", (raw, chapter, expected) => {
    expect(cleanMangaName(raw, chapter)).toBe(expected);
  });

  it("removes leftover separators around the chapter fragment", () => {
    expect(cleanMangaName("One Piece - Capítulo 1100", "1100")).toBe(
      "One Piece",
    );
  });

  it("keeps unrelated numbers intact", () => {
    expect(cleanMangaName("Mob Psycho 100", "12")).toBe("Mob Psycho 100");
  });
});
