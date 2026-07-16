import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { handleMessage } from "./message-handler";

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

const executeScriptMock = vi.fn();

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  fakeBrowser.reset();
  fetchMock.mockReset();
  executeScriptMock.mockReset();
  // Cast justified: fake-browser does not implement the scripting namespace,
  // so the test provides the minimal stub the handler calls.
  fakeBrowser.scripting = {
    executeScript: executeScriptMock,
  } as unknown as typeof fakeBrowser.scripting;
});

describe("handleMessage", () => {
  it("answers ping with the backend health result", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: "ok" }, 200));

    const response = await handleMessage({ kind: "ping" });

    expect(response).toEqual({ ok: true, data: { status: "ok" } });
  });

  it("collects page info via the content script and posts the test event", async () => {
    executeScriptMock.mockResolvedValue([
      { result: { title: "One Piece", url: "https://example.com/one-piece" } },
    ]);
    const created = { manga: { id: "m1" }, event: { id: "e1" } };
    fetchMock.mockResolvedValue(jsonResponse(created, 201));

    const response = await handleMessage({ kind: "send-test-event", tabId: 7 });

    expect(executeScriptMock).toHaveBeenCalledWith({
      target: { tabId: 7 },
      files: ["/content-scripts/content.js"],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:5150/api/events",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          mangaName: "One Piece",
          chapterLabel: "Cap. 0 (evento test)",
          sourceUrl: "https://example.com/one-piece",
        }),
      }),
    );
    expect(response).toEqual({ ok: true, data: created });
  });

  it("reports the failure when the script cannot be injected", async () => {
    executeScriptMock.mockRejectedValue(
      new Error("Cannot access a chrome:// URL"),
    );

    const response = await handleMessage({ kind: "send-test-event", tabId: 7 });

    expect(response).toEqual({
      ok: false,
      error: "Cannot access a chrome:// URL",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("routes get-adapter to the backend and maps a 404 to null", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: "Adapter not found" }, 404),
    );

    const response = await handleMessage({
      kind: "get-adapter",
      domain: "example.com",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:5150/api/adapters/example.com",
      undefined,
    );
    expect(response).toEqual({ ok: true, data: null });
  });

  it("routes record-event straight to the events endpoint", async () => {
    const created = { manga: { id: "m1" }, event: { id: "e1" } };
    fetchMock.mockResolvedValue(jsonResponse(created, 201));
    const payload = {
      mangaName: "One Piece",
      chapterLabel: "Cap. 1100",
      sourceUrl: "https://example.com/one-piece/capitulo/1100",
    };

    const response = await handleMessage({ kind: "record-event", payload });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:5150/api/events",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(payload),
      }),
    );
    expect(response).toEqual({ ok: true, data: created });
  });

  it("rejects a content script result that is not page info", async () => {
    executeScriptMock.mockResolvedValue([{ result: null }]);

    const response = await handleMessage({ kind: "send-test-event", tabId: 7 });

    expect(response).toEqual({
      ok: false,
      error: "Content script returned no page info",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
