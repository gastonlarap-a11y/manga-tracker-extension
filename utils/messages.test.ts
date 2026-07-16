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

  it("rejects unknown kinds and non-objects", () => {
    expect(isRuntimeMessage({ kind: "other" })).toBe(false);
    expect(isRuntimeMessage(null)).toBe(false);
    expect(isRuntimeMessage("ping")).toBe(false);
  });
});
