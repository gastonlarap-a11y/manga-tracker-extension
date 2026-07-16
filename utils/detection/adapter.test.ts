// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { SiteAdapterDto } from "../api/types";
import { detectFromAdapter } from "./adapter";

function adapter(overrides: Partial<SiteAdapterDto>): SiteAdapterDto {
  return {
    id: "adapter-1",
    domain: "example.com",
    titleSelector: "h1.title",
    chapterSelector: null,
    chapterUrlRegex: null,
    createdAt: "2026-07-16T12:00:00.000Z",
    updatedAt: "2026-07-16T12:00:00.000Z",
    ...overrides,
  };
}

function pageWith(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

describe("detectFromAdapter", () => {
  it("detects title and chapter via selectors with full confidence", () => {
    const doc = pageWith(
      '<h1 class="title">One Piece</h1><span class="chapter">Capítulo 1100</span>',
    );

    const result = detectFromAdapter(
      adapter({ chapterSelector: "span.chapter" }),
      doc,
      "https://example.com/one-piece/whatever",
    );

    expect(result).toEqual({
      detected: true,
      mangaName: "One Piece",
      chapterLabel: "Capítulo 1100",
      confidence: 1,
    });
  });

  it("falls back to the chapter url regex when there is no selector", () => {
    const doc = pageWith('<h1 class="title">One Piece</h1>');

    const result = detectFromAdapter(
      adapter({ chapterUrlRegex: "episodio-(\\d+(?:\\.\\d+)?)" }),
      doc,
      "https://example.com/one-piece/episodio-130.5",
    );

    expect(result).toEqual({
      detected: true,
      mangaName: "One Piece",
      chapterLabel: "Cap. 130.5",
      confidence: 1,
    });
  });

  it("returns null when the title selector no longer matches", () => {
    const doc = pageWith("<h1>Renamed structure</h1>");

    const result = detectFromAdapter(
      adapter({ titleSelector: "h1.title" }),
      doc,
      "https://example.com/one-piece/capitulo/1100",
    );

    expect(result).toBeNull();
  });

  it("returns null when no chapter source resolves", () => {
    const doc = pageWith('<h1 class="title">One Piece</h1>');

    const result = detectFromAdapter(
      adapter({}),
      doc,
      "https://example.com/one-piece",
    );

    expect(result).toBeNull();
  });

  it("treats an invalid stored selector as a miss instead of throwing", () => {
    const doc = pageWith('<h1 class="title">One Piece</h1>');

    const result = detectFromAdapter(
      adapter({ titleSelector: ":::not-a-selector" }),
      doc,
      "https://example.com/one-piece/capitulo/1100",
    );

    expect(result).toBeNull();
  });
});
