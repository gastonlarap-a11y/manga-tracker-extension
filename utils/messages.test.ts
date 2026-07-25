import { describe, expect, it } from "vitest";
import { isRuntimeMessage } from "./messages";

describe("isRuntimeMessage", () => {
  it("accepts a ping message", () => {
    expect(isRuntimeMessage({ kind: "ping" })).toBe(true);
  });

  it("accepts a send-test-event message with a numeric tabId", () => {
    expect(isRuntimeMessage({ kind: "send-test-event", tabId: 3 })).toBe(true);
  });

  it("rejects a send-test-event message without tabId", () => {
    expect(isRuntimeMessage({ kind: "send-test-event" })).toBe(false);
  });

  it("accepts a get-adapter message with a domain", () => {
    expect(isRuntimeMessage({ kind: "get-adapter", domain: "a.com" })).toBe(
      true,
    );
    expect(isRuntimeMessage({ kind: "get-adapter" })).toBe(false);
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

  it("accepts a get-library message", () => {
    expect(isRuntimeMessage({ kind: "get-library" })).toBe(true);
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
