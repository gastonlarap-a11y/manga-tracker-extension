import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import {
  CONFIG_TTL_MS,
  cachedConfig,
  configForDetection,
  DEFAULT_READING_SETTINGS,
  isOlderThan,
  parseExtensionConfig,
  refreshConfig,
} from "./remote-config";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/** Answers the port probe, and hands everything else to `onConfig`. */
function backendServing(onConfig: () => Response): void {
  fetchMock.mockImplementation((input: string) =>
    Promise.resolve(
      input.endsWith("/health")
        ? jsonResponse({ status: "ok", service: "manga-tracker-api" }, 200)
        : onConfig(),
    ),
  );
}

function served(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    minExtensionVersion: "0.2.0",
    detection: {
      confidenceThreshold: null,
      settleDelayMs: null,
      chapterUrlPatterns: [],
      readerPathPatterns: [],
      chapterWords: ["episodio"],
      sectionSegments: [],
      leadingPrefixes: [],
    },
    themes: [
      {
        name: "madara",
        readerMarker: ".reading-content",
        headingSelector: "#chapter-heading",
        seriesLinkSelector: null,
        nextSelector: null,
      },
    ],
    notices: [{ id: "n1", level: "info", text: "Hola" }],
    reading: {
      readingRequired: true,
      readMinSeconds: 45,
      readMinScrollPercent: 60,
    },
    ...overrides,
  };
}

beforeEach(() => {
  fakeBrowser.reset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("parseExtensionConfig", () => {
  it("reads a well-formed answer as it is", () => {
    const config = parseExtensionConfig(served());

    expect(config?.detection.chapterWords).toEqual(["episodio"]);
    expect(config?.themes.map((theme) => theme.name)).toEqual(["madara"]);
    expect(config?.reading.readMinSeconds).toBe(45);
  });

  it("ignores a schema it does not know, whole", () => {
    // A newer backend may mean something else by the same field names.
    expect(parseExtensionConfig(served({ schemaVersion: 2 }))).toBeNull();
    expect(parseExtensionConfig("nope")).toBeNull();
    expect(parseExtensionConfig(null)).toBeNull();
  });

  it("drops the pieces of the wrong shape and keeps the rest", () => {
    const config = parseExtensionConfig(
      served({
        themes: [
          { name: "sin-marcador" },
          null,
          {
            name: "ok",
            readerMarker: "#readerarea",
            headingSelector: 7,
          },
        ],
        notices: [
          { id: "n2", text: "" },
          { id: "n3", text: "Hay algo", level: "x" },
        ],
        reading: { readingRequired: true, readMinSeconds: -3 },
      }),
    );

    expect(config?.themes).toEqual([
      {
        name: "ok",
        readerMarker: "#readerarea",
        headingSelector: null,
        seriesLinkSelector: null,
        nextSelector: null,
      },
    ]);
    expect(config?.notices).toEqual([
      { id: "n3", level: "info", text: "Hay algo" },
    ]);
    expect(config?.reading).toEqual({
      readingRequired: true,
      readMinSeconds: DEFAULT_READING_SETTINGS.readMinSeconds,
      readMinScrollPercent: DEFAULT_READING_SETTINGS.readMinScrollPercent,
    });
  });

  it("reads missing reading settings as off", () => {
    expect(
      parseExtensionConfig(served({ reading: undefined }))?.reading,
    ).toEqual(DEFAULT_READING_SETTINGS);
  });
});

describe("the cache", () => {
  it("stores what the backend serves", async () => {
    backendServing(() => jsonResponse(served(), 200));

    expect(await refreshConfig(1000)).toBe(true);
    expect((await cachedConfig())?.notices).toHaveLength(1);
  });

  it("keeps the previous copy when the backend has no such endpoint", async () => {
    backendServing(() => jsonResponse(served(), 200));
    await refreshConfig(1000);

    // A backend older than 0.1.22.
    backendServing(() => jsonResponse({ error: "Not Found" }, 404));

    expect(await refreshConfig(2000)).toBe(false);
    expect(await cachedConfig()).not.toBeNull();
  });

  it("stops asking a backend that has no such endpoint, until the answer is stale", async () => {
    backendServing(() => jsonResponse({ error: "Not Found" }, 404));

    expect(await configForDetection(1000)).toBeNull();
    fetchMock.mockClear();

    // Every page in the next minutes: answered from what the 404 said.
    expect(await configForDetection(1000 + CONFIG_TTL_MS - 1)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    // Stale: asked again — the backend may have updated.
    backendServing(() => jsonResponse(served(), 200));
    await configForDetection(1000 + CONFIG_TTL_MS + 1);
    await vi.waitFor(async () => expect(await cachedConfig()).not.toBeNull());
  });

  it("does not remember a backend that was simply away", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await configForDetection(1000);

    backendServing(() => jsonResponse(served(), 200));

    expect((await configForDetection(1001))?.themes).toHaveLength(1);
  });

  it("waits for the network only when there is no copy at all", async () => {
    backendServing(() => jsonResponse(served(), 200));

    expect((await configForDetection(1000))?.themes).toHaveLength(1);

    // Fresh copy: served without asking.
    fetchMock.mockClear();
    await configForDetection(1000 + CONFIG_TTL_MS - 1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serves a stale copy at once and refreshes behind it", async () => {
    backendServing(() => jsonResponse(served(), 200));
    await refreshConfig(1000);

    backendServing(() => jsonResponse(served({ notices: [] }), 200));
    const stale = await configForDetection(1000 + CONFIG_TTL_MS + 1);

    expect(stale?.notices).toHaveLength(1);
    await vi.waitFor(async () =>
      expect((await cachedConfig())?.notices).toHaveLength(0),
    );
  });

  it("is null with no backend and nothing cached", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    expect(await configForDetection(1000)).toBeNull();
  });
});

describe("isOlderThan", () => {
  it("compares versions part by part, as numbers", () => {
    expect(isOlderThan("0.1.4", "0.2.0")).toBe(true);
    expect(isOlderThan("0.9.0", "0.10.0")).toBe(true);
    expect(isOlderThan("0.2.0", "0.2.0")).toBe(false);
    expect(isOlderThan("1.0.0", "0.9.9")).toBe(false);
  });

  it("never calls a version it cannot read older", () => {
    expect(isOlderThan("dev", "0.2.0")).toBe(false);
    expect(isOlderThan("0.2.0", "")).toBe(false);
  });
});
