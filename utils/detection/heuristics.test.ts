import { describe, expect, it } from "vitest";
import {
  CONFIDENCE_THRESHOLD,
  cleanMangaName,
  detectFromHeuristics,
  extractChapterFromTitle,
  extractChapterFromUrl,
  extractSeriesSlug,
  isReaderPath,
} from "./heuristics";
import type { PageSignals } from "./page-signals";

function signals(overrides: Partial<PageSignals>): PageSignals {
  return {
    url: "https://example.com/manga/one-piece/capitulo/1100",
    documentTitle: "",
    ogTitle: null,
    twitterTitle: null,
    firstHeading: null,
    siteName: null,
    seriesLinkTitle: null,
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
    [
      "https://mhscans.com/series/espadachin-a-tiempo-completo/capitulo-89-pack/",
      "89",
    ],
    [
      "https://lectorxd.com/manhua/un-nio-criado-por-un-rey-demonio-y-un-rey-dragon-parece-tener-una-vida-escolar-inigualable/leer/56",
      "56",
    ],
  ])("extracts the chapter from %s", (url, expected) => {
    expect(extractChapterFromUrl(url)).toBe(expected);
  });

  it.each([
    ["https://olympusxyz.com/", "catalog home"],
    ["https://example.com/biblioteca", "library listing"],
    ["https://example.com/manga/one-piece", "manga detail without chapter"],
    ["https://example.com/manga/one-piece/leer/", "reader segment without id"],
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

describe("isReaderPath", () => {
  it.each([
    ["https://manhwaweb.com/leer/some-slug_1750256573107-36_01"],
    ["https://manhwaweb.com/leer_18/some-slug_123"],
    ["https://example.com/read/solo-leveling/5"],
    ["https://example.com/viewer/abc123"],
    ["https://example.com/manga/one-piece/leer/58204923"],
    ["https://mangadex.org/chapter/e3d4e69e-2a83-4492-9603-507fbff406e7"],
    ["https://example.com/capitulo/a1b2c3"],
  ])("accepts the reader path %s", (url) => {
    expect(isReaderPath(url)).toBe(true);
  });

  it.each([
    ["https://manhwaweb.com/", "catalog home"],
    ["https://manhwaweb.com/biblioteca", "library listing"],
    ["https://manhwaweb.com/manhwa/some-slug_123", "manga detail"],
    ["https://example.com/already-read/123", "reader word inside a segment"],
    ["https://example.com/reader-tips/", "hyphenated reader segment"],
    ["not a url", "invalid url"],
  ])("rejects %s (%s)", (url) => {
    expect(isReaderPath(url)).toBe(false);
  });
});

describe("extractSeriesSlug", () => {
  it.each([
    [
      "https://mhscans.com/series/espadachin-a-tiempo-completo/capitulo-89-pack/",
      "espadachin-a-tiempo-completo",
    ],
    ["https://example.com/manga/one-piece/capitulo/1100", "one-piece"],
    ["https://example.com/one-piece/chapter-12", "one-piece"],
    [
      "https://lectorxd.com/manhua/un-nio-criado-por-un-rey-demonio-y-un-rey-dragon-parece-tener-una-vida-escolar-inigualable/leer/56",
      "un-nio-criado-por-un-rey-demonio-y-un-rey-dragon-parece-tener-una-vida-escolar-inigualable",
    ],
  ])("extracts the series slug from %s", (url, expected) => {
    expect(extractSeriesSlug(url)).toBe(expected);
  });

  it.each([
    ["https://olympusxyz.com/capitulo/130729/", "chapter at the path root"],
    ["https://example.com/series/capitulo-12/", "section segment as slug"],
    ["https://example.com/123456/capitulo-12/", "numeric id segment"],
    ["https://manhwaweb.com/leer/some-slug_123", "reader path, no marker"],
    ["not a url", "invalid url"],
  ])("returns null for %s (%s)", (url) => {
    expect(extractSeriesSlug(url)).toBeNull();
  });
});

describe("extractChapterFromTitle", () => {
  it.each([
    ["Capítulo 122 de El Genio entrenador de artes marciales", "122"],
    ["One Piece Chapter 1100", "1100"],
    ["Solo Leveling Cap. 130.5", "130.5"],
    ["Solo Leveling cap 130,5", "130.5"],
  ])("extracts the chapter from %s", (title, expected) => {
    expect(extractChapterFromTitle(title)).toBe(expected);
  });

  it.each([
    ["Mob Psycho 100", "bare number"],
    ["Punch 3", "'ch' inside another word"],
    ["Olympus Scanlation | Lee cientos de cómics", "catalog title"],
  ])("returns null for %s (%s)", (title) => {
    expect(extractChapterFromTitle(title)).toBeNull();
  });
});

describe("detectFromHeuristics", () => {
  it("prefers the title's chapter over an internal id in the url (olympus)", () => {
    const result = detectFromHeuristics(
      signals({
        url: "https://olympusxyz.com/capitulo/130729/",
        ogTitle: "Capítulo 122 de El Genio entrenador de artes marciales",
      }),
    );

    expect(result).toEqual({
      detected: true,
      mangaName: "El Genio entrenador de artes marciales",
      chapterLabel: "Cap. 122",
      confidence: 0.9,
    });
  });

  it("detects a reader page whose chapter only lives in the document title (manhwaweb)", () => {
    const result = detectFromHeuristics(
      signals({
        url: "https://manhwaweb.com/leer/puedo-destruir-los--mundos-con-un-cuchillo-carnicero_1750256573107-36_01",
        documentTitle:
          "Puedo Destruir los Mundos con un Cuchillo Carnicero Capitulo 1 manhwa - ManhwaWeb",
      }),
    );

    expect(result).toEqual({
      detected: true,
      mangaName: "Puedo Destruir los Mundos con un Cuchillo Carnicero",
      chapterLabel: "Cap. 1",
      confidence: 0.75,
    });
  });

  it("detects the ikigai title format over a giant internal url id", () => {
    const result = detectFromHeuristics(
      signals({
        url: "https://viralikigai.milkchoco.online/capitulo/1187745088806715393/",
        documentTitle:
          "Capítulo 224 - Segunda Vida Para Ser Un Ranker | Ikigai Mangas",
      }),
    );

    expect(result).toEqual({
      detected: true,
      mangaName: "Segunda Vida Para Ser Un Ranker",
      chapterLabel: "Cap. 224",
      confidence: 0.75,
    });
  });

  it("never uses an implausibly long url number as the chapter", () => {
    const result = detectFromHeuristics(
      signals({
        url: "https://viralikigai.milkchoco.online/capitulo/1187745088806715393/",
        ogTitle: "Segunda Vida Para Ser Un Ranker | Ikigai Mangas",
      }),
    );

    expect(result).toEqual({ detected: false, reason: "no-chapter-in-title" });
  });

  it("does not use reader-url numbers as the chapter when no title names one", () => {
    const result = detectFromHeuristics(
      signals({
        url: "https://manhwaweb.com/leer/some-slug_1750256573107-36_01",
        documentTitle: "ManhwaWeb - Manhwa Web",
      }),
    );

    expect(result).toEqual({ detected: false, reason: "no-chapter-in-title" });
  });

  it("prefers the title source naming the chapter over higher-priority ones", () => {
    const result = detectFromHeuristics(
      signals({
        url: "https://manhwaweb.com/leer/solo-leveling_123_12",
        firstHeading: "ManhwaWeb",
        documentTitle: "Solo Leveling Capitulo 12 manhwa - ManhwaWeb",
      }),
    );

    expect(result).toEqual({
      detected: true,
      mangaName: "Solo Leveling",
      chapterLabel: "Cap. 12",
      confidence: 0.75,
    });
  });

  it("falls back to the url chapter when the title has none", () => {
    const result = detectFromHeuristics(
      signals({
        url: "https://example.com/one-piece/chapter-1100",
        ogTitle: "One Piece | Example Scan",
      }),
    );

    expect(result).toMatchObject({
      detected: true,
      mangaName: "One Piece",
      chapterLabel: "Cap. 1100",
    });
  });

  it("detects a reader-segment chapter nested under the series path (lectorxd)", () => {
    const result = detectFromHeuristics(
      signals({
        url: "https://lectorxd.com/manhua/un-nio-criado-por-un-rey-demonio-y-un-rey-dragon-parece-tener-una-vida-escolar-inigualable/leer/56",
        ogTitle:
          "Leer Un Niño Criado Por un Rey Demonio y un Rey Dragón Parece Tener una Vida Escolar Inigualable Capítulo 56 Online | Lector XD",
      }),
    );

    expect(result).toEqual({
      detected: true,
      mangaName:
        "Un Niño Criado Por un Rey Demonio y un Rey Dragón Parece Tener una Vida Escolar Inigualable",
      chapterLabel: "Cap. 56",
      confidence: 0.9,
    });
  });

  it("still rejects a nested reader-path catalog page without a chapter title", () => {
    const result = detectFromHeuristics(
      signals({
        url: "https://example.com/manga/one-piece/leer/",
        ogTitle: "One Piece | Example Scan",
      }),
    );

    expect(result).toEqual({ detected: false, reason: "no-chapter-in-title" });
  });

  // Real page, read off mangadex.org: the url names the chapter but identifies
  // it with a uuid, so the number the old gate demanded never arrives. Whether
  // it detected depended on the first hex digit being a numeral.
  it("detects a chapter page whose url carries an opaque id (mangadex)", () => {
    const result = detectFromHeuristics(
      signals({
        url: "https://mangadex.org/chapter/e3d4e69e-2a83-4492-9603-507fbff406e7",
        documentTitle:
          "1 | Chapter 107 - Tonari no Seki no Yatsu ga Souiu Me de Mitekuru - MangaDex",
        ogTitle:
          "Tonari no Seki no Yatsu ga Souiu Me de Mitekuru - Ch. 107 - MangaDex",
        siteName: "MangaDex",
      }),
    );

    expect(result).toEqual({
      detected: true,
      mangaName: "Tonari no Seki no Yatsu ga Souiu Me de Mitekuru",
      chapterLabel: "Cap. 107",
      confidence: 0.9,
    });
  });

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
      confidence: 0.9,
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

  it("leaves a chapterless document-title detection below the threshold", () => {
    const result = detectFromHeuristics(
      signals({ documentTitle: "Solo Leveling" }),
    );

    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.confidence).toBeLessThan(CONFIDENCE_THRESHOLD);
    }
  });

  it("does not detect when no title source exists", () => {
    const result = detectFromHeuristics(
      signals({
        url: "https://example.com/capitulo/1100",
        documentTitle: "  ",
      }),
    );

    expect(result).toEqual({ detected: false, reason: "no-title" });
  });

  it("uses the validated series link when every title is branding (mhscans)", () => {
    const result = detectFromHeuristics(
      signals({
        url: "https://mhscans.com/series/espadachin-a-tiempo-completo/capitulo-89-pack/",
        documentTitle: "MHScans - MHScans (Oficial)",
        ogTitle: "MHScans - MHScans (Oficial)",
        twitterTitle: "MHScans - MHScans (Oficial)",
        siteName: "MHScans (Oficial)",
        seriesLinkTitle: "Espadachín a Tiempo Completo",
      }),
    );

    expect(result).toEqual({
      detected: true,
      mangaName: "Espadachín a Tiempo Completo",
      chapterLabel: "Cap. 89",
      confidence: 0.8,
    });
  });

  it("falls back to the humanized url slug when no other source survives", () => {
    const result = detectFromHeuristics(
      signals({
        url: "https://mhscans.com/series/espadachin-a-tiempo-completo/capitulo-89-pack/",
        documentTitle: "MHScans - MHScans (Oficial)",
        siteName: "MHScans (Oficial)",
      }),
    );

    expect(result).toEqual({
      detected: true,
      mangaName: "Espadachin a tiempo completo",
      chapterLabel: "Cap. 89",
      confidence: 0.7,
    });
  });

  it("discards a branding-only title via the hostname when og:site_name is missing", () => {
    const result = detectFromHeuristics(
      signals({
        url: "https://mhscans.com/series/espadachin-a-tiempo-completo/capitulo-89/",
        documentTitle: "MhScans",
      }),
    );

    expect(result).toMatchObject({
      detected: true,
      mangaName: "Espadachin a tiempo completo",
    });
  });

  it("never uses a section segment as the series slug", () => {
    const result = detectFromHeuristics(
      signals({ url: "https://example.com/manga/capitulo-12/" }),
    );

    expect(result).toEqual({ detected: false, reason: "no-title" });
  });
});

describe("cleanMangaName", () => {
  it("strips the site suffix after a pipe", () => {
    expect(cleanMangaName("One Piece | Example Scan", "12", null)).toBe(
      "One Piece",
    );
  });

  it.each([
    ["One Piece Capítulo 1100", "1100", "One Piece"],
    ["One Piece Capitulo 1100", "1100", "One Piece"],
    ["One Piece Cap. 130.5", "130.5", "One Piece"],
    ["One Piece cap 130,5", "130.5", "One Piece"],
    ["One Piece Chapter 12", "12", "One Piece"],
    ["One Piece Ch. 12", "12", "One Piece"],
  ])("removes the chapter fragment from %s", (raw, chapter, expected) => {
    expect(cleanMangaName(raw, chapter, null)).toBe(expected);
  });

  it.each([
    [
      "Capítulo 32 de Mi Invocación es de Clase EX | Olympus Scanlation",
      "32",
      "Mi Invocación es de Clase EX",
    ],
    ["Chapter 12 of Solo Leveling", "12", "Solo Leveling"],
    ["Capítulo 130.5 - One Piece", "130.5", "One Piece"],
  ])(
    "drops the leading chapter prefix and connector in %s",
    (raw, chapter, expected) => {
      expect(cleanMangaName(raw, chapter, null)).toBe(expected);
    },
  );

  it("removes leftover separators around the chapter fragment", () => {
    expect(cleanMangaName("One Piece - Capítulo 1100", "1100", null)).toBe(
      "One Piece",
    );
  });

  it("drops site junk after the chapter fragment", () => {
    expect(
      cleanMangaName(
        "Puedo Destruir los Mundos con un Cuchillo Carnicero Capitulo 1 manhwa - ManhwaWeb",
        "1",
        null,
      ),
    ).toBe("Puedo Destruir los Mundos con un Cuchillo Carnicero");
  });

  it("does not treat word-internal 'ch' plus a number as a chapter fragment", () => {
    expect(cleanMangaName("Punch 3 Deluxe", "3", null)).toBe("Punch 3 Deluxe");
  });

  it("keeps unrelated numbers intact", () => {
    expect(cleanMangaName("Mob Psycho 100", "12", null)).toBe("Mob Psycho 100");
  });

  it("strips a leading reader verb confirmed by the url slug (lectorxd)", () => {
    expect(
      cleanMangaName(
        "Leer Un Niño Criado Capítulo 56 Online",
        "56",
        "un-nio-criado",
      ),
    ).toBe("Un Niño Criado");
  });

  it("keeps a genuine title starting with a reader-verb word", () => {
    expect(cleanMangaName("Read or Die Capítulo 5", "5", "read-or-die")).toBe(
      "Read or Die",
    );
  });

  it("does not strip a leading reader verb without url-slug evidence", () => {
    expect(cleanMangaName("Leer Solo Leveling Capítulo 12", "12", null)).toBe(
      "Leer Solo Leveling",
    );
  });

  it("does not strip when the slug's first token disagrees", () => {
    expect(
      cleanMangaName("Leer Solo Leveling Capítulo 12", "12", "otra-cosa"),
    ).toBe("Leer Solo Leveling");
  });

  it("strips a leading section word confirmed by the url slug (manhwa-latino)", () => {
    expect(
      cleanMangaName(
        "MANGA Saikyou Degarashi Ouji no Anyaku Teii Arasoi Capítulo 38",
        "38",
        "saikyou-degarashi-ouji-no-anyaku-teii-arasoi",
      ),
    ).toBe("Saikyou Degarashi Ouji no Anyaku Teii Arasoi");
  });

  it("keeps a genuine title starting with a section word", () => {
    expect(
      cleanMangaName(
        "Manga wo Yomeru Ore ga Sekai Saikyou Capítulo 3",
        "3",
        "manga-wo-yomeru-ore-ga-sekai-saikyou",
      ),
    ).toBe("Manga wo Yomeru Ore ga Sekai Saikyou");
  });

  it("strips a stacked reader verb plus section word in two passes", () => {
    expect(
      cleanMangaName(
        "Leer Manga Solo Leveling Capítulo 12",
        "12",
        "solo-leveling",
      ),
    ).toBe("Solo Leveling");
  });

  it("does not strip a leading section word without url-slug evidence", () => {
    expect(cleanMangaName("Manga Solo Leveling Capítulo 12", "12", null)).toBe(
      "Manga Solo Leveling",
    );
  });
});
