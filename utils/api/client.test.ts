import { afterEach, describe, expect, it, vi } from "vitest";
import {
  API_BASE_URL,
  createReadingEvent,
  getAdapter,
  pingHealth,
} from "./client";
import type { CreateEventResponse } from "./types";

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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

afterEach(() => {
  fetchMock.mockReset();
});

describe("pingHealth", () => {
  it("returns ok on a healthy backend", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: "ok" }, 200));

    const result = await pingHealth();

    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/health`, undefined);
    expect(result).toEqual({ ok: true, data: { status: "ok" } });
  });

  it("returns the failure when the backend is unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const result = await pingHealth();

    expect(result).toEqual({ ok: false, error: "Failed to fetch" });
  });
});

describe("createReadingEvent", () => {
  const body = {
    mangaName: "One Piece",
    chapterLabel: "Cap. 0 (evento test)",
    sourceUrl: "https://example.com/one-piece",
  };

  it("POSTs the event and returns the created manga and event", async () => {
    fetchMock.mockResolvedValue(jsonResponse(createEventResponse, 201));

    const result = await createReadingEvent(body);

    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/api/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(result).toEqual({ ok: true, data: createEventResponse });
  });

  it("surfaces the API error message on a 4xx response", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: "Invalid request" }, 400),
    );

    const result = await createReadingEvent(body);

    expect(result).toEqual({
      ok: false,
      error: "Invalid request",
      status: 400,
    });
  });

  it("falls back to the HTTP status when the error body is not JSON", async () => {
    fetchMock.mockResolvedValue(new Response("Bad Gateway", { status: 502 }));

    const result = await createReadingEvent(body);

    expect(result).toEqual({ ok: false, error: "HTTP 502", status: 502 });
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
    fetchMock.mockResolvedValue(jsonResponse(adapter, 200));

    const result = await getAdapter("example.com");

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE_URL}/api/adapters/example.com`,
      undefined,
    );
    expect(result).toEqual({ ok: true, data: adapter });
  });

  it("maps a 404 to a null adapter instead of a failure", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: "Adapter not found" }, 404),
    );

    const result = await getAdapter("example.com");

    expect(result).toEqual({ ok: true, data: null });
  });

  it("keeps other failures as errors", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: "Internal Server Error" }, 500),
    );

    const result = await getAdapter("example.com");

    expect(result).toEqual({
      ok: false,
      error: "Internal Server Error",
      status: 500,
    });
  });
});
