import { describe, expect, it } from "vitest";
import { buildTestEventPayload } from "./test-event";

describe("buildTestEventPayload", () => {
  it("uses the page title and url", () => {
    const payload = buildTestEventPayload({
      title: "One Piece — Cap. 1100",
      url: "https://example.com/one-piece/chapter-1100",
    });

    expect(payload).toEqual({
      mangaName: "One Piece — Cap. 1100",
      chapterLabel: "Cap. 0 (evento test)",
      sourceUrl: "https://example.com/one-piece/chapter-1100",
    });
  });

  it("trims surrounding whitespace from the title", () => {
    const payload = buildTestEventPayload({
      title: "  Solo Leveling  ",
      url: "https://example.com/solo-leveling",
    });

    expect(payload.mangaName).toBe("Solo Leveling");
  });

  it("falls back to a placeholder when the title is blank", () => {
    const payload = buildTestEventPayload({
      title: "   ",
      url: "https://example.com/blank",
    });

    expect(payload.mangaName).toBe("Untitled page");
  });
});
