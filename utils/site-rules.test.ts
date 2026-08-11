import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import type { SiteRuleDto } from "./api/types";
import {
  CACHE_TTL_MS,
  cachedRules,
  refreshRules,
  ruleForHost,
  rulesForDetection,
  seriesFromRule,
} from "./site-rules";

const fetchMock = vi.fn();

function rule(overrides: Partial<SiteRuleDto> = {}): SiteRuleDto {
  return {
    domain: "manhwaweb.com",
    series: {
      pattern:
        "^https?://(?:www\\.)?manhwaweb\\.com/leer/(.+_\\d{10,})-\\d+(?:[.,]\\d+)?(?:_\\d+)?/?$",
      template: "https://manhwaweb.com/leer/$1",
      navigable: false,
    },
    titleSelector: null,
    chapterSelector: null,
    chapterUrlRegex: null,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/**
 * Answers the port probe, and hands everything else to `onRules`.
 *
 * Port discovery runs through the same fetch, so a mock that returns the rules
 * to every call never gets past finding the backend.
 */
function backendServing(onRules: () => Response | Promise<Response>): void {
  fetchMock.mockImplementation((input: string) =>
    input.endsWith("/health")
      ? Promise.resolve(
          jsonResponse({ status: "ok", service: "manga-tracker-api" }, 200),
        )
      : Promise.resolve(onRules()),
  );
}

beforeEach(() => {
  fakeBrowser.reset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("ruleForHost", () => {
  const rules = [rule(), rule({ domain: "olympusxyz.com" })];

  it("finds a rule by host, ignoring www and case", () => {
    expect(ruleForHost(rules, "manhwaweb.com")?.domain).toBe("manhwaweb.com");
    expect(ruleForHost(rules, "www.manhwaweb.com")?.domain).toBe(
      "manhwaweb.com",
    );
    expect(ruleForHost(rules, "MANHWAWEB.COM")?.domain).toBe("manhwaweb.com");
  });

  it("matches a subdomain", () => {
    expect(ruleForHost(rules, "es.manhwaweb.com")?.domain).toBe(
      "manhwaweb.com",
    );
  });

  it("returns null for a site with no rule", () => {
    expect(ruleForHost(rules, "lectorxd.com")).toBeNull();
    // A different site that merely ends the same way is not a subdomain.
    expect(ruleForHost(rules, "notmanhwaweb.com")).toBeNull();
  });
});

describe("seriesFromRule", () => {
  it("derives the same identity for every chapter of a series", () => {
    const chapters = [
      "https://manhwaweb.com/leer/dragona_1750256573107-36_01",
      "https://manhwaweb.com/leer/dragona_1750256573107-37_01",
    ].map((url) => seriesFromRule(rule(), url)?.url);

    expect(chapters[0]).toBe(
      "https://manhwaweb.com/leer/dragona_1750256573107",
    );
    expect(new Set(chapters).size).toBe(1);
  });

  it("carries whether the identity is a page that can be fetched", () => {
    expect(
      seriesFromRule(
        rule(),
        "https://manhwaweb.com/leer/dragona_1750256573107-36",
      )?.navigable,
    ).toBe(false);
  });

  it("returns null when the rule does not match the URL", () => {
    expect(
      seriesFromRule(rule(), "https://manhwaweb.com/manga/dragona"),
    ).toBeNull();
  });

  it("returns null for a site rule that only carries selectors", () => {
    expect(
      seriesFromRule(
        rule({ series: null, titleSelector: "h1" }),
        "https://manhwaweb.com/leer/dragona_1750256573107-36",
      ),
    ).toBeNull();
  });

  it("survives a malformed pattern instead of breaking detection", () => {
    // A bad regex in the catalogue is a bug to fix there, not a reason to stop
    // detecting on the page the reader is looking at.
    expect(
      seriesFromRule(
        rule({ series: { pattern: "([", template: "$1", navigable: true } }),
        "https://manhwaweb.com/leer/dragona_1750256573107-36",
      ),
    ).toBeNull();
  });
});

describe("the cache", () => {
  it("fetches on the very first detection, when there is nothing to serve", async () => {
    backendServing(() => jsonResponse([rule()], 200));

    const rules = await rulesForDetection(1_000);

    expect(rules).toHaveLength(1);
  });

  it("serves a fresh copy without touching the network", async () => {
    backendServing(() => jsonResponse([rule()], 200));
    await refreshRules(1_000);
    fetchMock.mockClear();

    const rules = await rulesForDetection(1_000 + CACHE_TTL_MS - 1);

    expect(rules).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serves the stale copy immediately and refreshes behind it", async () => {
    // The point of the cache: a detection never waits on the backend.
    backendServing(() => jsonResponse([rule()], 200));
    await refreshRules(1_000);
    backendServing(() =>
      jsonResponse([rule(), rule({ domain: "olympusxyz.com" })], 200),
    );

    const served = await rulesForDetection(1_000 + CACHE_TTL_MS + 1);

    expect(served).toHaveLength(1);
    await vi.waitFor(async () => {
      expect(await cachedRules()).toHaveLength(2);
    });
  });

  it("keeps the last good copy when the backend is down", async () => {
    backendServing(() => jsonResponse([rule()], 200));
    await refreshRules(1_000);
    fetchMock.mockRejectedValue(new Error("connection refused"));

    expect(await refreshRules(2_000)).toBe(false);
    expect(await cachedRules()).toHaveLength(1);
  });

  it("detects with no rules at all when the backend has never answered", async () => {
    // Degrades to the generic heuristics, which is what every site got before
    // the catalogue existed.
    fetchMock.mockRejectedValue(new Error("connection refused"));

    expect(await rulesForDetection(1_000)).toEqual([]);
  });
});
