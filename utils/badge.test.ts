import { describe, expect, it } from "vitest";
import { badgeFor } from "./badge";
import type { DeliveryStatus, DetectionEntry } from "./detection-log";

function detected(delivery?: DeliveryStatus): DetectionEntry {
  return {
    url: "https://example.com/manga/x/capitulo-12/",
    detection: {
      detected: true,
      mangaName: "Torre de Dios",
      chapterLabel: "Cap. 12",
      confidence: 0.9,
    },
    ...(delivery ? { delivery } : {}),
  };
}

describe("badgeFor", () => {
  it("shows nothing on a tab that detected nothing", () => {
    expect(badgeFor(null, false).text).toBe("");
    expect(
      badgeFor(
        {
          url: "https://example.com/",
          detection: { detected: false, reason: "no-chapter-in-url" },
        },
        false,
      ).text,
    ).toBe("");
  });

  it("says what became of the reading, with its name in the tooltip", () => {
    const sent = badgeFor(detected({ status: "sent", mangaId: "m1" }), false);
    expect(sent.text).toBe("✓");
    expect(sent.title).toContain("Torre de Dios · Cap. 12");

    expect(badgeFor(detected({ status: "queued" }), false).text).toBe("↑");
    expect(
      badgeFor(detected({ status: "failed", error: "HTTP 500" }), false).text,
    ).toBe("!");
    expect(badgeFor(detected({ status: "below-threshold" }), false).text).toBe(
      "?",
    );
    expect(
      badgeFor(
        detected({ status: "waiting", minSeconds: 30, minScrollPercent: 80 }),
        false,
      ).text,
    ).toBe("…");
  });

  it("marks every tab as paused while tracking is", () => {
    expect(badgeFor(null, true).text).toBe("‖");
    expect(
      badgeFor(detected({ status: "held", reason: "paused" }), true).text,
    ).toBe("‖");
  });

  it("stays quiet in a private window that records nothing", () => {
    const badge = badgeFor(
      detected({ status: "held", reason: "incognito" }),
      false,
    );
    expect(badge.text).toBe("");
    expect(badge.title).toContain("ventana privada");
  });

  it("shows a send in flight as in progress, not as saved", () => {
    expect(badgeFor(detected(), false).text).toBe("…");
  });
});
