// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryEntryDto } from "../api/types";
import {
  coverFromSeriesDocument,
  findSeriesLink,
  huntCover,
  isSeriesPath,
  matchLibraryEntry,
  nameMatches,
  pickCoverFromImages,
  pickSeriesPageCover,
} from "./cover-hunt";

const PAGE_URL = "https://olympusxyz.com/capitulo/128179/comic-de-duende";
const NAME = "De duende a Dios Goblin";

// Mirrors the real olympus chapter page: og:image is the site logo, the
// visible /series/ anchors belong to RECOMMENDED mangas, the chapter panels
// carry the manga name in their alt, and the manga's own series link exists.
function loadOlympusLikeChapter(): void {
  document.head.innerHTML =
    '<meta property="og:image" content="/olympus-logo-180.webp" />';
  document.body.innerHTML = `
    <a href="/series/comic-secta-de-la-montana-20260716">Secta de la Montaña</a>
    <a href="/series/comic-roman-dmitry-20260716">Roman Dmitry</a>
    <a href="/series/comic-de-duende-a-dios-goblin-20260716">De duende a Dios Goblin</a>
    <img src="https://media.example.com/comics/1372/128179/0.webp"
         alt="De duende a Dios Goblin &gt; Capitulo 107 &gt; Page 01" />
  `;
}

function setNaturalSize(img: HTMLImageElement, width: number, height: number) {
  Object.defineProperty(img, "naturalWidth", { value: width });
  Object.defineProperty(img, "naturalHeight", { value: height });
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("nameMatches", () => {
  it.each([
    [NAME, "/series/comic-de-duende-a-dios-goblin-20260716", true],
    [NAME, "De duende a Dios Goblin > Capitulo 107 > Page 01", true],
    [NAME, "/series/comic-secta-de-la-montana", false],
    ["Solo Leveling", "solo-leveling cover", true],
    ["Solo Leveling", "otra cosa", false],
  ])("matches %s against %s → %s", (name, text, expected) => {
    expect(nameMatches(name, text)).toBe(expected);
  });
});

describe("findSeriesLink", () => {
  it("picks the manga's own series page, not the recommended ones", () => {
    loadOlympusLikeChapter();

    expect(findSeriesLink(document, NAME, PAGE_URL)).toBe(
      "https://olympusxyz.com/series/comic-de-duende-a-dios-goblin-20260716",
    );
  });

  it("returns null when no series link names the manga", () => {
    document.body.innerHTML =
      '<a href="/series/comic-secta-de-la-montana">Secta</a>';

    expect(findSeriesLink(document, NAME, PAGE_URL)).toBeNull();
  });

  it("ignores cross-origin links", () => {
    document.body.innerHTML =
      '<a href="https://otro-sitio.com/series/de-duende-a-dios-goblin">De duende a Dios Goblin</a>';

    expect(findSeriesLink(document, NAME, PAGE_URL)).toBeNull();
  });
});

describe("coverFromSeriesDocument", () => {
  it("prefers a non-branding og:image", () => {
    const parsed = new DOMParser().parseFromString(
      '<html><head><meta property="og:image" content="/covers/duende.webp"></head><body></body></html>',
      "text/html",
    );

    expect(
      coverFromSeriesDocument(parsed, NAME, "https://olympusxyz.com/series/x"),
    ).toBe("https://olympusxyz.com/covers/duende.webp");
  });

  it("falls back to the image whose alt names the manga", () => {
    const parsed = new DOMParser().parseFromString(
      `<html><head><meta property="og:image" content="/olympus-logo-180.webp"></head>
       <body><img src="/covers/duende.webp" alt="De duende a Dios Goblin"></body></html>`,
      "text/html",
    );

    expect(
      coverFromSeriesDocument(parsed, NAME, "https://olympusxyz.com/series/x"),
    ).toBe("https://olympusxyz.com/covers/duende.webp");
  });
});

describe("pickCoverFromImages", () => {
  it("excludes chapter panels and keeps cover-sized thumbnails", () => {
    loadOlympusLikeChapter();
    const images = document.querySelectorAll("img");
    const panel = images[0];
    if (!(panel instanceof HTMLImageElement)) {
      throw new Error("fixture missing panel img");
    }
    setNaturalSize(panel, 800, 12000);

    expect(pickCoverFromImages(document, NAME)).toBeNull();

    const thumb = document.createElement("img");
    thumb.setAttribute("alt", "De duende a Dios Goblin");
    thumb.setAttribute("src", "https://olympusxyz.com/thumbs/duende.webp");
    setNaturalSize(thumb, 300, 450);
    document.body.append(thumb);

    expect(pickCoverFromImages(document, NAME)).toBe(
      "https://olympusxyz.com/thumbs/duende.webp",
    );
  });
});

function libraryEntry(overrides: Partial<LibraryEntryDto>): LibraryEntryDto {
  return {
    id: "m1",
    canonicalName: NAME,
    normalizedSlug: "de-duende-a-dios-goblin",
    coverUrl: null,
    status: "reading",
    tags: [],
    reachedChapter: null,
    lastActivity: null,
    lastSourceUrl: null,
    readCount: 0,
    sourceDomains: [],
    ...overrides,
  };
}

describe("isSeriesPath", () => {
  it.each([
    ["/series/comic-de-duende-a-dios-goblin-20260716", true],
    ["/manhwa/carnicero-marcial", true],
    ["/leer/carnicero-marcial_1750256573107-36_01", false],
    ["/capitulo/1187745088806715393/", false],
  ])("classifies %s → %s", (pathname, expected) => {
    expect(isSeriesPath(pathname)).toBe(expected);
  });
});

describe("matchLibraryEntry", () => {
  const pageText = "Carnicero Marcial - Manhwaweb Carnicero Marcial";

  it("picks the uncovered entry whose name matches the page", () => {
    const entries = [
      libraryEntry({ id: "m1" }),
      libraryEntry({ id: "m2", canonicalName: "Carnicero Marcial" }),
    ];

    expect(matchLibraryEntry(entries, pageText)?.id).toBe("m2");
  });

  it("skips entries that already have a cover", () => {
    const entries = [
      libraryEntry({
        id: "m2",
        canonicalName: "Carnicero Marcial",
        coverUrl: "https://cdn.example.com/covers/carnicero.webp",
      }),
    ];

    expect(matchLibraryEntry(entries, pageText)).toBeNull();
  });

  it("returns null when no name overlaps the page text", () => {
    expect(matchLibraryEntry([libraryEntry({})], "Otra cosa")).toBeNull();
  });
});

describe("pickSeriesPageCover", () => {
  function appendImage(
    src: string,
    alt: string,
    width: number,
    height: number,
  ): void {
    const img = document.createElement("img");
    img.setAttribute("src", src);
    img.setAttribute("alt", alt);
    setNaturalSize(img, width, height);
    document.body.append(img);
  }

  it("prefers a non-branding og:image", () => {
    document.head.innerHTML =
      '<meta property="og:image" content="https://cdn.example.com/covers/duende.webp" />';
    appendImage("https://cdn.example.com/other.webp", "", 300, 450);

    expect(pickSeriesPageCover(document, NAME)).toBe(
      "https://cdn.example.com/covers/duende.webp",
    );
  });

  it("prefers the image naming the manga over a larger portrait", () => {
    appendImage("https://cdn.example.com/big-portrait.webp", "", 600, 900);
    appendImage(
      "https://cdn.example.com/duende.webp",
      "De duende a Dios Goblin",
      200,
      300,
    );

    expect(pickSeriesPageCover(document, NAME)).toBe(
      "https://cdn.example.com/duende.webp",
    );
  });

  it("falls back to the largest portrait image", () => {
    appendImage("https://cdn.example.com/small.webp", "", 150, 220);
    appendImage("https://cdn.example.com/hero.webp", "", 400, 600);

    expect(pickSeriesPageCover(document, NAME)).toBe(
      "https://cdn.example.com/hero.webp",
    );
  });

  it("excludes panels, landscape images and branding", () => {
    appendImage("https://cdn.example.com/panel.webp", "", 800, 12000);
    appendImage("https://cdn.example.com/wide-banner-art.webp", "", 400, 500);
    appendImage("https://cdn.example.com/screenshot.webp", "", 500, 300);

    expect(pickSeriesPageCover(document, NAME)).toBeNull();
  });

  it("accepts a full-resolution hero cover (manhwaweb serves 1472×2364)", () => {
    appendImage("https://cdn.example.com/thumb.webp", "", 150, 220);
    appendImage("https://img1mw.xyz/manhwas/x/cover_123.webp", "", 1472, 2364);

    expect(pickSeriesPageCover(document, NAME)).toBe(
      "https://img1mw.xyz/manhwas/x/cover_123.webp",
    );
  });

  it("uses the rendered box while the image bytes are still loading", () => {
    const img = document.createElement("img");
    img.setAttribute("src", "https://cdn.example.com/still-loading.webp");
    setNaturalSize(img, 0, 0);
    img.getBoundingClientRect = () =>
      // Cast justified: only width/height are read from the rect.
      ({ width: 220, height: 330 }) as DOMRect;
    document.body.append(img);

    expect(pickSeriesPageCover(document, NAME)).toBe(
      "https://cdn.example.com/still-loading.webp",
    );
  });

  it("name-matches a percent-encoded src despite accents", () => {
    appendImage("https://cdn.example.com/big-portrait.webp", "", 600, 900);
    appendImage(
      "https://img1mw.xyz/manhwas/emperador_m%C3%A1gico_1703957316968/cover_9.webp",
      "",
      200,
      300,
    );

    expect(pickSeriesPageCover(document, "Emperador Magico")).toBe(
      "https://img1mw.xyz/manhwas/emperador_m%C3%A1gico_1703957316968/cover_9.webp",
    );
  });
});

describe("huntCover", () => {
  it("fetches the series page and takes its cover", async () => {
    loadOlympusLikeChapter();
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        new Response(
          '<html><head><meta property="og:image" content="/covers/duende.webp"></head><body></body></html>',
          { status: 200, headers: { "Content-Type": "text/html" } },
        ),
      );

    const cover = await huntCover(document, NAME, PAGE_URL, fetchFn);

    expect(fetchFn).toHaveBeenCalledWith(
      "https://olympusxyz.com/series/comic-de-duende-a-dios-goblin-20260716",
    );
    expect(cover).toBe("https://olympusxyz.com/covers/duende.webp");
  });

  it("returns null when nothing usable exists", async () => {
    document.head.innerHTML = "";
    document.body.innerHTML = "<p>nada</p>";
    const fetchFn = vi.fn();

    expect(await huntCover(document, NAME, PAGE_URL, fetchFn)).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
