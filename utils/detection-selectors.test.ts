import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { baseUrlFor, DEFAULT_PORT, rememberBaseUrl } from "./api/discovery";
import type { SiteAdapterDto, SiteRuleDto } from "./api/types";
import { selectorsForDetection } from "./detection-selectors";

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const calibration: SiteAdapterDto = {
  id: "a1",
  domain: "lectorxd.com",
  titleSelector: "h1.series-title",
  chapterSelector: "span.chapter",
  chapterUrlRegex: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

function rule(overrides: Partial<SiteRuleDto> = {}): SiteRuleDto {
  return {
    domain: "lectorxd.com",
    series: null,
    titleSelector: "div.curated-title",
    chapterSelector: null,
    chapterUrlRegex: "capitulo-(\\d+)",
    ...overrides,
  };
}

/**
 * A backend that answers the adapter lookup with `adapter` (a 404 when null)
 * and serves `rules` as its catalogue.
 */
function backendServing(
  adapter: SiteAdapterDto | null,
  rules: SiteRuleDto[] = [],
): void {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/health")) {
      return jsonResponse({ status: "ok", service: "manga-tracker-api" }, 200);
    }
    if (url.includes("/api/site-rules")) {
      return jsonResponse(rules, 200);
    }
    return adapter === null
      ? jsonResponse({ error: "Adapter not found" }, 404)
      : jsonResponse(adapter, 200);
  });
}

function backendAway(): void {
  fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
}

beforeEach(async () => {
  fakeBrowser.reset();
  fetchMock.mockReset();
  await rememberBaseUrl(baseUrlFor(DEFAULT_PORT));
});

describe("selectorsForDetection", () => {
  it("uses the calibration the backend holds", async () => {
    backendServing(calibration);

    expect(await selectorsForDetection("lectorxd.com")).toMatchObject({
      titleSelector: "h1.series-title",
    });
  });

  it("keeps using that calibration while the backend is away", async () => {
    // The case this exists for: a calibrated site used to fall back to the
    // heuristics that failed there, and the reading never reached the outbox.
    backendServing(calibration);
    await selectorsForDetection("lectorxd.com");
    backendAway();

    expect(await selectorsForDetection("lectorxd.com")).toMatchObject({
      titleSelector: "h1.series-title",
    });
  });

  it("stands in the curated rule when the site has no calibration", async () => {
    backendServing(null, [rule()]);

    expect(await selectorsForDetection("lectorxd.com")).toEqual({
      titleSelector: "div.curated-title",
      chapterSelector: null,
      chapterUrlRegex: "capitulo-(\\d+)",
    });
  });

  it("remembers that a site was not calibrated, rather than a miss", async () => {
    // Once the backend said "no calibration", being away must not resurrect
    // an older one or invent one: the curated rule, from the rules cache.
    backendServing(null, [rule()]);
    await selectorsForDetection("lectorxd.com");
    backendAway();

    expect(await selectorsForDetection("lectorxd.com")).toMatchObject({
      titleSelector: "div.curated-title",
    });
  });

  it("gives the heuristics the page when nothing says anything", async () => {
    backendServing(null, [rule({ titleSelector: null })]);

    expect(await selectorsForDetection("lectorxd.com")).toBeNull();
  });

  it("answers even with no backend and nothing cached", async () => {
    backendAway();

    expect(await selectorsForDetection("lectorxd.com")).toBeNull();
  });
});
