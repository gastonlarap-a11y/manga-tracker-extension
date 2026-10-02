import { describe, expect, it } from "vitest";
import type { DetectionTuningDto } from "../api/types";
import { compileDetectionConfig, DEFAULT_DETECTION_CONFIG } from "./config";

function tuning(overrides: Partial<DetectionTuningDto>): DetectionTuningDto {
  return {
    confidenceThreshold: null,
    settleDelayMs: null,
    chapterUrlPatterns: [],
    readerPathPatterns: [],
    chapterWords: [],
    sectionSegments: [],
    leadingPrefixes: [],
    ...overrides,
  };
}

describe("compileDetectionConfig", () => {
  it("is the compiled defaults when the backend says nothing", () => {
    expect(compileDetectionConfig(null)).toBe(DEFAULT_DETECTION_CONFIG);
    expect(compileDetectionConfig(undefined)).toBe(DEFAULT_DETECTION_CONFIG);
  });

  it("replaces the numbers it is given within their bounds", () => {
    const config = compileDetectionConfig(
      tuning({ confidenceThreshold: 0.6, settleDelayMs: 3500 }),
    );

    expect(config.confidenceThreshold).toBe(0.6);
    expect(config.settleDelayMs).toBe(3500);
  });

  it("keeps the default for a number out of bounds or of the wrong shape", () => {
    for (const confidenceThreshold of [0, -1, 1.5, Number.NaN]) {
      expect(
        compileDetectionConfig(tuning({ confidenceThreshold }))
          .confidenceThreshold,
      ).toBe(DEFAULT_DETECTION_CONFIG.confidenceThreshold);
    }
    for (const settleDelayMs of [-1, 30_001, 12.5]) {
      expect(
        compileDetectionConfig(tuning({ settleDelayMs })).settleDelayMs,
      ).toBe(DEFAULT_DETECTION_CONFIG.settleDelayMs);
    }
  });

  it("adds to every list and never removes a default", () => {
    // The guarantee the whole design rests on: a remote edit can teach, and
    // cannot stop a site that works today.
    const config = compileDetectionConfig(
      tuning({
        chapterUrlPatterns: ["/episodio-(\\d+)"],
        readerPathPatterns: ["/visor/"],
        sectionSegments: ["webtoon"],
        leadingPrefixes: ["Mira"],
      }),
    );

    expect(config.chapterUrlPatterns).toEqual(
      expect.arrayContaining([...DEFAULT_DETECTION_CONFIG.chapterUrlPatterns]),
    );
    expect(config.chapterUrlPatterns).toHaveLength(
      DEFAULT_DETECTION_CONFIG.chapterUrlPatterns.length + 1,
    );
    expect(config.readerPathPatterns).toHaveLength(
      DEFAULT_DETECTION_CONFIG.readerPathPatterns.length + 1,
    );
    expect(config.sectionSegments.has("series")).toBe(true);
    expect(config.sectionSegments.has("webtoon")).toBe(true);
    expect(config.leadingPrefixTokens.has("leer")).toBe(true);
    expect(config.leadingPrefixTokens.has("mira")).toBe(true);
  });

  it("drops a regex that does not compile and keeps the rest", () => {
    const config = compileDetectionConfig(
      tuning({ readerPathPatterns: ["/visor/", "(unclosed"] }),
    );

    expect(config.readerPathPatterns).toHaveLength(
      DEFAULT_DETECTION_CONFIG.readerPathPatterns.length + 1,
    );
  });

  it("drops a chapter pattern with no group to read the number from", () => {
    const config = compileDetectionConfig(
      tuning({ chapterUrlPatterns: ["/episodio-\\d+"] }),
    );

    expect(config.chapterUrlPatterns).toHaveLength(
      DEFAULT_DETECTION_CONFIG.chapterUrlPatterns.length,
    );
  });

  it("escapes a chapter word, so it is matched as text", () => {
    const config = compileDetectionConfig(tuning({ chapterWords: ["ep."] }));

    expect(
      new RegExp(`\\b${config.chapterWords}\\s*(\\d+)`, "i").exec("Ep. 4")?.[1],
    ).toBe("4");
    expect(
      new RegExp(`\\b${config.chapterWords}\\s*(\\d+)`, "i").exec("epX 4"),
    ).toBeNull();
  });

  it("ignores list entries that are not words", () => {
    const config = compileDetectionConfig(
      tuning({
        sectionSegments: ["", "a/b", "x".repeat(41)],
        // A malformed answer: not an array of strings at all.
        chapterWords: [42] as unknown as string[],
      }),
    );

    expect(config.sectionSegments.size).toBe(
      DEFAULT_DETECTION_CONFIG.sectionSegments.size,
    );
    expect(config.chapterWords).toBe(DEFAULT_DETECTION_CONFIG.chapterWords);
  });
});
