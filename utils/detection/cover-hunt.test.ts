// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  coverFromSeriesDocument,
  findSeriesLink,
  huntCover,
  nameMatches,
  pickCoverFromImages,
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
