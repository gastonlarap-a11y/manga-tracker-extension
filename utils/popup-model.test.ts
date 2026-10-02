import { describe, expect, it } from "vitest";
import type { DetectionEntry } from "./detection-log";
import {
  coverSrc,
  mangaPageUrl,
  manualDraftFrom,
  trackedSites,
  verdictFor,
} from "./popup-model";

const DETECTED: DetectionEntry["detection"] = {
  detected: true,
  mangaName: "Torre de Dios",
  chapterLabel: "Cap. 12",
  confidence: 0.9,
};

describe("verdictFor", () => {
  it("says a reading was saved", () => {
    expect(
      verdictFor({
        url: "u",
        detection: DETECTED,
        delivery: { status: "sent", mangaId: "m1" },
      }),
    ).toMatchObject({ tone: "good", headline: "Guardado" });
  });

  it("explains what lectura real is waiting for", () => {
    const verdict = verdictFor({
      url: "u",
      detection: DETECTED,
      delivery: { status: "waiting", minSeconds: 30, minScrollPercent: 0 },
    });

    expect(verdict.hint).toBe("Lectura real: 30 s en la página.");
  });

  it("tells a page it could not read from a page that is not a chapter", () => {
    expect(
      verdictFor({
        url: "u",
        detection: { detected: false, reason: "no-chapter-in-url" },
      }).tone,
    ).toBe("quiet");
    expect(
      verdictFor({
        url: "u",
        detection: { detected: false, reason: "no-chapter-in-title" },
      }).hint,
    ).toContain("Guardalo a mano");
  });

  it("names the failure the backend gave", () => {
    expect(
      verdictFor({
        url: "u",
        detection: DETECTED,
        delivery: { status: "failed", error: "HTTP 500" },
      }),
    ).toMatchObject({ tone: "bad", hint: "HTTP 500" });
  });
});

describe("trackedSites", () => {
  it("groups each site's patterns and leaves the backend's ports out", () => {
    expect(
      trackedSites([
        "http://localhost:5150/*",
        "http://127.0.0.1:5159/*",
        "https://*.olympusxyz.com/*",
        "http://*.olympusxyz.com/*",
        "https://www.heavenmanga.com/*",
      ]),
    ).toEqual([
      { host: "heavenmanga.com", patterns: ["https://www.heavenmanga.com/*"] },
      {
        host: "olympusxyz.com",
        patterns: ["https://*.olympusxyz.com/*", "http://*.olympusxyz.com/*"],
      },
    ]);
  });

  it("ignores what is not a site pattern", () => {
    expect(trackedSites(["<all_urls>", "*://*/*"])).toEqual([]);
  });
});

describe("manualDraftFrom", () => {
  it("starts from the detection when there is one", () => {
    expect(
      manualDraftFrom({ url: "u", detection: DETECTED }, "lo que sea"),
    ).toEqual({ mangaName: "Torre de Dios", chapterLabel: "Cap. 12" });
  });

  it("drafts from the tab's title otherwise", () => {
    expect(
      manualDraftFrom(
        null,
        "Leer Soy un Dios Maligno Capitulo 567 Español - HeavenManga",
      ),
    ).toEqual({
      mangaName: "Leer Soy un Dios Maligno",
      chapterLabel: "Cap. 567",
    });
  });

  it("leaves the chapter empty when the title names none", () => {
    expect(manualDraftFrom(null, "Torre de Dios - Example Scans")).toEqual({
      mangaName: "Torre de Dios",
      chapterLabel: "",
    });
  });
});

describe("urls", () => {
  it("builds the cover and the dashboard page off the backend's address", () => {
    expect(coverSrc("http://127.0.0.1:5151", "a b", 3)).toBe(
      "http://127.0.0.1:5151/api/mangas/a%20b/cover?v=3",
    );
    expect(mangaPageUrl("http://127.0.0.1:5151", "m1")).toBe(
      "http://127.0.0.1:5151/manga/m1",
    );
  });
});
