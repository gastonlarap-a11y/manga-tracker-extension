import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import {
  createReadingEvent,
  getAdapter,
  getLibrary,
  pingHealth,
} from "./client";
import { baseUrlFor, DEFAULT_PORT, SERVICE_NAME } from "./discovery";
import type { CreateEventResponse } from "./types";

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

const API_BASE_URL = baseUrlFor(DEFAULT_PORT);

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const health = jsonResponse({ status: "ok", service: SERVICE_NAME }, 200);

/**
 * Every request now starts by locating the backend, so the mock has to answer
 * the health probe as well. Discovery finds it on the default port, which is
 * what these tests are about — the moving-port cases live in discovery.test.ts
 * and in "when the backend moved" below.
 */
function backendReplies(body: unknown, status: number): void {
  fetchMock.mockImplementation(async (input) =>
    String(input).endsWith("/health")
      ? health.clone()
      : jsonResponse(body, status),
  );
}

const createEventResponse: CreateEventResponse = {
  manga: {
    id: "manga-1",
    canonicalName: "One Piece",
    normalizedSlug: "one-piece",
    coverUrl: null,
    coverVersion: 0,
    hasStoredCover: false,
    status: "reading",
    tags: [],
    createdAt: "2026-07-16T12:00:00.000Z",
  },
  event: {
    id: "event-1",
    mangaId: "manga-1",
    chapterLabel: "Cap. 0 (evento test)",
    chapterNumber: 0,
    sourceUrl: "https://example.com/one-piece",
    sourceDomain: "example.com",
    readAt: "2026-07-16T12:00:00.000Z",
  },
};

beforeEach(() => {
  // The discovered base URL is cached in session storage; each test starts
  // without one.
  fakeBrowser.reset();
});

afterEach(() => {
  fetchMock.mockReset();
});

describe("pingHealth", () => {
  it("returns ok on a healthy backend", async () => {
    backendReplies({ status: "ok", service: SERVICE_NAME }, 200);

    const result = await pingHealth();

    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/health`, undefined);
    expect(result).toEqual({
      ok: true,
      data: { status: "ok", service: SERVICE_NAME },
    });
  });

  it("reports the backend as missing when no port answers", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const result = await pingHealth();

    expect(result.ok).toBe(false);
    // The message names the range, because "Failed to fetch" tells whoever
    // reads it in the popup nothing they can act on.
    expect(result).toMatchObject({ error: expect.stringContaining("5150") });
  });
});

describe("createReadingEvent", () => {
  const body = {
    mangaName: "One Piece",
    chapterLabel: "Cap. 0 (evento test)",
    sourceUrl: "https://example.com/one-piece",
  };

  it("POSTs the event and returns the created manga and event", async () => {
    backendReplies(createEventResponse, 201);

    const result = await createReadingEvent(body);

    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/api/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(result).toEqual({ ok: true, data: createEventResponse });
  });

  it("surfaces the API error message on a 4xx response", async () => {
    backendReplies({ error: "Invalid request" }, 400);

    const result = await createReadingEvent(body);

    expect(result).toEqual({
      ok: false,
      error: "Invalid request",
      status: 400,
    });
  });

  it("falls back to the HTTP status when the error body is not JSON", async () => {
    fetchMock.mockImplementation(async (input) =>
      String(input).endsWith("/health")
        ? health.clone()
        : new Response("Bad Gateway", { status: 502 }),
    );

    const result = await createReadingEvent(body);

    expect(result).toEqual({ ok: false, error: "HTTP 502", status: 502 });
  });

  it("does not retry a request the backend answered", async () => {
    // A 500 is an answer. Retrying it elsewhere could post the same reading
    // twice, and the backend already saw this one.
    backendReplies({ error: "Internal Server Error" }, 500);
    await createReadingEvent(body);
    const calls = fetchMock.mock.calls.filter(([input]) =>
      String(input).endsWith("/api/events"),
    );

    expect(calls).toHaveLength(1);
  });
});

describe("when the backend moved to another port", () => {
  it("rediscovers it and completes the request", async () => {
    // The cached URL is stale — an update restarted the backend on a different
    // free port. Nothing reached a server, so repeating the POST is safe.
    backendReplies({ status: "ok", service: SERVICE_NAME }, 200);
    await pingHealth();

    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith(baseUrlFor(5153))) {
        return url.endsWith("/health") ? health.clone() : jsonResponse([], 200);
      }
      throw new TypeError("Failed to fetch");
    });

    const result = await getLibrary();

    expect(result).toEqual({ ok: true, data: [] });
    expect(fetchMock).toHaveBeenCalledWith(
      `${baseUrlFor(5153)}/api/library`,
      undefined,
    );
  });

  it("gives up when it is simply not running", async () => {
    backendReplies({ status: "ok", service: SERVICE_NAME }, 200);
    await pingHealth();
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const result = await getLibrary();

    expect(result.ok).toBe(false);
  });
});

describe("getAdapter", () => {
  const adapter = {
    id: "adapter-1",
    domain: "example.com",
    titleSelector: "h1.title",
    chapterSelector: null,
    chapterUrlRegex: null,
    createdAt: "2026-07-16T12:00:00.000Z",
    updatedAt: "2026-07-16T12:00:00.000Z",
  };

  it("returns the stored adapter", async () => {
    backendReplies(adapter, 200);

    const result = await getAdapter("example.com");

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE_URL}/api/adapters/example.com`,
      undefined,
    );
    expect(result).toEqual({ ok: true, data: adapter });
  });

  it("maps a 404 to a null adapter instead of a failure", async () => {
    backendReplies({ error: "Adapter not found" }, 404);

    const result = await getAdapter("example.com");

    expect(result).toEqual({ ok: true, data: null });
  });

  it("keeps other failures as errors", async () => {
    backendReplies({ error: "Internal Server Error" }, 500);

    const result = await getAdapter("example.com");

    expect(result).toEqual({
      ok: false,
      error: "Internal Server Error",
      status: 500,
    });
  });
});
