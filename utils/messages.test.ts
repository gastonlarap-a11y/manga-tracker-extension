import { describe, expect, it } from "vitest";
import { isRuntimeMessage } from "./messages";

describe("isRuntimeMessage", () => {
  it("accepts a ping message", () => {
    expect(isRuntimeMessage({ kind: "ping" })).toBe(true);
  });

  it("accepts a tab-scoped message with a numeric tabId", () => {
    expect(isRuntimeMessage({ kind: "get-detection", tabId: 3 })).toBe(true);
  });

  it("rejects a tab-scoped message without tabId", () => {
    expect(isRuntimeMessage({ kind: "get-detection" })).toBe(false);
  });

  it("accepts a get-selectors message with a domain", () => {
    expect(isRuntimeMessage({ kind: "get-selectors", domain: "a.com" })).toBe(
      true,
    );
    expect(isRuntimeMessage({ kind: "get-selectors" })).toBe(false);
  });

  it("accepts a get-outbox message, which carries nothing", () => {
    expect(isRuntimeMessage({ kind: "get-outbox" })).toBe(true);
  });

  it("accepts the 0.2.0 messages that carry nothing", () => {
    for (const kind of [
      "get-extension-config",
      "refresh-extension-config",
      "get-recent-reading",
      "get-backend-url",
    ]) {
      expect(isRuntimeMessage({ kind })).toBe(true);
    }
  });

  it("accepts record-manual only with a tab and a full payload", () => {
    const payload = {
      mangaName: "X",
      chapterLabel: "Cap. 1",
      sourceUrl: "https://a.com/1",
    };
    expect(isRuntimeMessage({ kind: "record-manual", tabId: 1, payload })).toBe(
      true,
    );
    expect(isRuntimeMessage({ kind: "record-manual", payload })).toBe(false);
    expect(
      isRuntimeMessage({ kind: "record-manual", tabId: 1, payload: {} }),
    ).toBe(false);
  });

  it("accepts a detection report with or without page facts", () => {
    const report = {
      kind: "report-detection",
      url: "https://a.com/1",
      detection: { detected: false, reason: "no-title" },
    };
    expect(isRuntimeMessage(report)).toBe(true);
    expect(
      isRuntimeMessage({
        ...report,
        facts: { theme: "madara", seriesLinkUrl: null, nextUrl: null },
      }),
    ).toBe(true);
    expect(isRuntimeMessage({ ...report, facts: { theme: 3 } })).toBe(false);
  });

  it("accepts every delivery status a detector reports, and nothing else", () => {
    const report = (delivery: unknown) => ({
      kind: "report-delivery",
      url: "https://a.com/1",
      delivery,
    });
    for (const delivery of [
      { status: "sent" },
      { status: "sent", mangaId: "m1" },
      { status: "queued" },
      { status: "below-threshold" },
      { status: "waiting", minSeconds: 30, minScrollPercent: 80 },
      { status: "held", reason: "paused" },
      { status: "held", reason: "incognito" },
      { status: "failed", error: "x" },
    ]) {
      expect(isRuntimeMessage(report(delivery))).toBe(true);
    }
    for (const delivery of [
      { status: "held", reason: "bored" },
      { status: "waiting" },
      { status: "sent", mangaId: 3 },
      { status: "lost" },
    ]) {
      expect(isRuntimeMessage(report(delivery))).toBe(false);
    }
  });

  it("accepts a record-event message with a full payload", () => {
    expect(
      isRuntimeMessage({
        kind: "record-event",
        payload: {
          mangaName: "One Piece",
          chapterLabel: "Cap. 12",
          sourceUrl: "https://a.com/c/12",
        },
      }),
    ).toBe(true);
    expect(
      isRuntimeMessage({
        kind: "record-event",
        payload: { mangaName: "One Piece" },
      }),
    ).toBe(false);
  });

  it("accepts register/unregister-site messages with an origin pattern", () => {
    expect(
      isRuntimeMessage({
        kind: "register-site",
        originPattern: "https://a.com/*",
        tabId: 2,
      }),
    ).toBe(true);
    expect(
      isRuntimeMessage({
        kind: "register-site",
        originPattern: "https://a.com/*",
      }),
    ).toBe(false);
    expect(
      isRuntimeMessage({
        kind: "unregister-site",
        originPattern: "https://a.com/*",
      }),
    ).toBe(true);
  });

  it("accepts an ensure-site-registered message with a pattern list", () => {
    expect(
      isRuntimeMessage({
        kind: "ensure-site-registered",
        originPatterns: ["https://a.com/*", "https://*.a.com/*"],
        tabId: 2,
      }),
    ).toBe(true);
    expect(
      isRuntimeMessage({
        kind: "ensure-site-registered",
        originPatterns: "https://a.com/*",
        tabId: 2,
      }),
    ).toBe(false);
    expect(
      isRuntimeMessage({
        kind: "ensure-site-registered",
        originPatterns: ["https://a.com/*", 7],
        tabId: 2,
      }),
    ).toBe(false);
    expect(
      isRuntimeMessage({
        kind: "ensure-site-registered",
        originPatterns: ["https://a.com/*"],
      }),
    ).toBe(false);
  });

  it("asks for one site's cards, never the whole library", () => {
    expect(
      isRuntimeMessage({ kind: "get-library-for-site", domain: "a.com" }),
    ).toBe(true);
    expect(isRuntimeMessage({ kind: "get-library-for-site" })).toBe(false);
    // Gone: the whole library is megabytes at thousands of series.
    expect(isRuntimeMessage({ kind: "get-library" })).toBe(false);
  });

  it("accepts set-cover only with mangaId and coverUrl strings", () => {
    expect(
      isRuntimeMessage({
        kind: "set-cover",
        mangaId: "m1",
        coverUrl: "https://cdn.example.com/cover.webp",
      }),
    ).toBe(true);
    expect(isRuntimeMessage({ kind: "set-cover", mangaId: "m1" })).toBe(false);
    expect(
      isRuntimeMessage({
        kind: "set-cover",
        coverUrl: "https://cdn.example.com/cover.webp",
      }),
    ).toBe(false);
  });

  it("accepts report-delivery only with a url and a valid delivery status", () => {
    expect(
      isRuntimeMessage({
        kind: "report-delivery",
        url: "https://a.com/c/12",
        delivery: { status: "sent" },
      }),
    ).toBe(true);
    expect(
      isRuntimeMessage({
        kind: "report-delivery",
        url: "https://a.com/c/12",
        delivery: { status: "failed", error: "Backend unreachable" },
      }),
    ).toBe(true);
    expect(
      isRuntimeMessage({
        kind: "report-delivery",
        url: "https://a.com/c/12",
        delivery: { status: "failed" },
      }),
    ).toBe(false);
    expect(
      isRuntimeMessage({
        kind: "report-delivery",
        delivery: { status: "sent" },
      }),
    ).toBe(false);
  });

  it("rejects unknown kinds and non-objects", () => {
    expect(isRuntimeMessage({ kind: "other" })).toBe(false);
    expect(isRuntimeMessage(null)).toBe(false);
    expect(isRuntimeMessage("ping")).toBe(false);
  });
});
