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

  it("rejects unknown kinds and non-objects", () => {
    expect(isRuntimeMessage({ kind: "other" })).toBe(false);
    expect(isRuntimeMessage(null)).toBe(false);
    expect(isRuntimeMessage("ping")).toBe(false);
  });
});
