import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { baseUrlFor, DEFAULT_PORT, rememberBaseUrl } from "./api/discovery";
import { handleMessage } from "./message-handler";

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

// Minimal stubs for the pixel-capture crop (happy-dom has neither API).
const createImageBitmapMock = vi.fn();
vi.stubGlobal("createImageBitmap", createImageBitmapMock);
class FakeOffscreenCanvas {
  getContext(): unknown {
    return { drawImage: vi.fn() };
  }
  convertToBlob(): unknown {
    return {
      type: "image/webp",
      arrayBuffer: async () => new ArrayBuffer(8),
    };
  }
}
vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);

const executeScriptMock = vi.fn();
const captureVisibleTabMock = vi.fn();
const permissionsContainsMock = vi.fn();

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(async () => {
  fakeBrowser.reset();
  fetchMock.mockReset();
  // Pin where the backend is, so these tests exercise the handler and not the
  // port sweep — that one is covered in utils/api/discovery.test.ts.
  await rememberBaseUrl(baseUrlFor(DEFAULT_PORT));
  executeScriptMock.mockReset();
  createImageBitmapMock.mockReset();
  captureVisibleTabMock.mockReset();
  // Cast justified: fake-browser does not implement the scripting namespace,
  // so the test provides the minimal stub the handler calls.
  fakeBrowser.scripting = {
    executeScript: executeScriptMock,
  } as unknown as typeof fakeBrowser.scripting;
  // Cast justified: same, for the pixel capture's screenshot call.
  fakeBrowser.tabs.captureVisibleTab =
    captureVisibleTabMock as unknown as typeof fakeBrowser.tabs.captureVisibleTab;
  // Cover-byte fetches are permission-gated; default to granted so tests
  // exercise the capture flow unless they say otherwise.
  permissionsContainsMock.mockResolvedValue(true);
  // Cast justified: fake-browser lacks permissions.contains; the tests
  // provide the minimal stub the guards call.
  fakeBrowser.permissions = {
    contains: permissionsContainsMock,
  } as unknown as typeof fakeBrowser.permissions;
});

describe("handleMessage", () => {
  it("answers ping with the backend health result", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: "ok" }, 200));

    const response = await handleMessage({ kind: "ping" });

    expect(response).toEqual({ ok: true, data: { status: "ok" } });
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

  it("stores a reported detection under the sender tab and serves it back", async () => {
    const detection = {
      detected: false,
      reason: "no-chapter-in-title",
    } as const;

    const ack = await handleMessage(
      {
        kind: "report-detection",
        url: "https://example.com/leer/x",
        detection,
      },
      41,
    );
    const stored = await handleMessage({ kind: "get-detection", tabId: 41 });

    expect(ack).toBeNull();
    expect(stored).toEqual({ url: "https://example.com/leer/x", detection });
  });

  it("merges a delivery report into the stored detection entry", async () => {
    const detection = {
      detected: true,
      mangaName: "Espadachín a Tiempo Completo",
      chapterLabel: "Cap. 89",
      confidence: 0.8,
    } as const;
    const url =
      "https://mhscans.com/series/espadachin-a-tiempo-completo/capitulo-89-pack/";

    await handleMessage({ kind: "report-detection", url, detection }, 42);
    await handleMessage(
      {
        kind: "report-delivery",
        url,
        delivery: { status: "failed", error: "Backend unreachable" },
      },
      42,
    );
    const stored = await handleMessage({ kind: "get-detection", tabId: 42 });

    expect(stored).toEqual({
      url,
      detection,
      delivery: { status: "failed", error: "Backend unreachable" },
    });
  });

  it("ignores a delivery report for a url other than the stored detection", async () => {
    const detection = { detected: false, reason: "no-chapter-in-url" } as const;

    await handleMessage(
      { kind: "report-detection", url: "https://a.com/serie", detection },
      43,
    );
    await handleMessage(
      {
        kind: "report-delivery",
        url: "https://a.com/older-page",
        delivery: { status: "sent" },
      },
      43,
    );
    const stored = await handleMessage({ kind: "get-detection", tabId: 43 });

    expect(stored).toEqual({ url: "https://a.com/serie", detection });
  });

  it("returns null for a tab without a recorded detection", async () => {
    const stored = await handleMessage({ kind: "get-detection", tabId: 999 });

    expect(stored).toBeNull();
  });

  it("injects the calibration script on start-calibration", async () => {
    executeScriptMock.mockResolvedValue([]);

    const response = await handleMessage({
      kind: "start-calibration",
      tabId: 5,
    });

    expect(executeScriptMock).toHaveBeenCalledWith({
      target: { tabId: 5 },
      files: ["/content-scripts/calibration.js"],
    });
    expect(response).toEqual({ ok: true, data: null });
  });

  it("routes get-library to the library endpoint", async () => {
    const entries = [{ id: "m1", canonicalName: "One Piece", coverUrl: null }];
    fetchMock.mockResolvedValue(jsonResponse(entries, 200));

    const response = await handleMessage({ kind: "get-library" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:5150/api/library",
      undefined,
    );
    expect(response).toEqual({ ok: true, data: entries });
  });

  it("routes set-cover to the manga update endpoint", async () => {
    const manga = { id: "m1", coverUrl: "https://cdn.example.com/c.webp" };
    fetchMock.mockResolvedValue(jsonResponse(manga, 200));

    const response = await handleMessage({
      kind: "set-cover",
      mangaId: "m1",
      coverUrl: "https://cdn.example.com/c.webp",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:5150/api/mangas/m1",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ coverUrl: "https://cdn.example.com/c.webp" }),
      }),
    );
    expect(response).toEqual({ ok: true, data: manga });
  });

  it("captures cover bytes after a record-event whose cover won", async () => {
    const coverUrl = "https://zai.manhwa-latino.com/uploads/thumb.webp";
    const coverBytes = new ArrayBuffer(3);
    const created = {
      manga: { id: "m1", coverUrl },
      event: { id: "e1" },
    };
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/events")) {
        return jsonResponse(created, 201);
      }
      if (url === coverUrl) {
        return new Response(coverBytes, {
          status: 200,
          headers: { "content-type": "image/webp" },
        });
      }
      return jsonResponse({ id: "m1" }, 200);
    });

    const response = await handleMessage({
      kind: "record-event",
      payload: {
        mangaName: "Saikyou",
        chapterLabel: "Cap. 38",
        sourceUrl: "https://manhwa-latino.com/manga/saikyou/capitulo-38/",
        coverUrl,
      },
    });

    expect(response).toEqual({ ok: true, data: created });
    expect(fetchMock).toHaveBeenCalledWith(
      coverUrl,
      expect.objectContaining({ credentials: "include" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:5150/api/mangas/m1/cover-image",
      expect.objectContaining({
        method: "PUT",
        headers: { "Content-Type": "image/webp" },
      }),
    );
  });

  it("skips the byte capture when the cover origin is not permission-covered", async () => {
    permissionsContainsMock.mockResolvedValue(false);
    const coverUrl = "https://media.imagesolymp.xyz/comics/covers/1575/x.webp";
    const created = {
      manga: { id: "m1", coverUrl },
      event: { id: "e1" },
    };
    fetchMock.mockResolvedValue(jsonResponse(created, 201));

    const response = await handleMessage({
      kind: "record-event",
      payload: {
        mangaName: "Olympus Manga",
        chapterLabel: "Cap. 1",
        sourceUrl: "https://olympusxyz.com/capitulo/1/",
        coverUrl,
      },
    });

    expect(response).toEqual({ ok: true, data: created });
    // Only the event POST — the CDN fetch would just CORS-fail noisily.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("merges a cover-heal report into the stored detection entry", async () => {
    const detection = { detected: false, reason: "no-chapter-in-url" } as const;
    const url = "https://mangasnosekai.com/manga/el-mundo-del-juego-otome/";

    await handleMessage({ kind: "report-detection", url, detection }, 21);
    await handleMessage(
      {
        kind: "report-cover-heal",
        url,
        coverHeal: { status: "failed", error: "Pixel capture failed" },
      },
      21,
    );
    const stored = await handleMessage({ kind: "get-detection", tabId: 21 });

    expect(stored).toEqual({
      url,
      detection,
      coverHeal: { status: "failed", error: "Pixel capture failed" },
    });
  });

  it("skips the byte capture when another cover already won server-side", async () => {
    const created = {
      manga: { id: "m1", coverUrl: "https://cdn.example.com/earlier.jpg" },
      event: { id: "e1" },
    };
    fetchMock.mockResolvedValue(jsonResponse(created, 201));

    await handleMessage({
      kind: "record-event",
      payload: {
        mangaName: "Saikyou",
        chapterLabel: "Cap. 38",
        sourceUrl: "https://manhwa-latino.com/manga/saikyou/capitulo-38/",
        coverUrl: "https://zai.manhwa-latino.com/uploads/thumb.webp",
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps set-cover ok when the byte capture itself fails", async () => {
    const coverUrl = "https://imagenes.mangasnosekai.com/cover.png";
    const manga = { id: "m2", coverUrl };
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url === coverUrl) {
        return new Response("blocked", { status: 403 });
      }
      return jsonResponse(manga, 200);
    });

    const response = await handleMessage({
      kind: "set-cover",
      mangaId: "m2",
      coverUrl,
    });

    expect(response).toEqual({ ok: true, data: manga });
    const coverImagePuts = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes("/cover-image"),
    );
    expect(coverImagePuts).toEqual([]);
  });

  it("backfills bytes only for permitted covers that lack them", async () => {
    const permittedCover = "https://zai.manhwa-latino.com/uploads/thumb.webp";
    const unpermittedCover = "https://cdn.forbidden.com/cover.png";
    const library = [
      { id: "m1", coverUrl: permittedCover, hasStoredCover: false },
      { id: "m2", coverUrl: unpermittedCover, hasStoredCover: false },
      { id: "m3", coverUrl: "https://x.com/c.png", hasStoredCover: true },
      { id: "m4", coverUrl: null, hasStoredCover: false },
    ];
    const containsMock = vi
      .fn()
      .mockImplementation(async ({ origins }: { origins: string[] }) =>
        origins.some((origin) => origin.includes("manhwa-latino.com")),
      );
    // Cast justified: fake-browser lacks permissions.contains; the test
    // provides the minimal stub the backfill calls.
    fakeBrowser.permissions = {
      contains: containsMock,
    } as unknown as typeof fakeBrowser.permissions;
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/library")) {
        return jsonResponse(library, 200);
      }
      if (url === permittedCover) {
        return new Response(new ArrayBuffer(1), {
          status: 200,
          headers: { "content-type": "image/webp" },
        });
      }
      return jsonResponse({ id: "m1" }, 200);
    });

    const response = await handleMessage({ kind: "backfill-covers" });

    expect(response).toBeNull();
    const fetchedUrls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(fetchedUrls).toContain(permittedCover);
    expect(fetchedUrls).not.toContain(unpermittedCover);
    expect(fetchedUrls).toContain(
      "http://localhost:5150/api/mangas/m1/cover-image",
    );
    expect(
      fetchedUrls.filter((url) => url.includes("/cover-image")),
    ).toHaveLength(1);
  });

  it("uploads content-script-fetched cover bytes from base64", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "m1" }, 200));

    const response = await handleMessage({
      kind: "upload-cover-bytes",
      mangaId: "m1",
      base64: btoa("abc"),
      contentType: "image/webp",
    });

    expect(response).toEqual({ ok: true, data: null });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:5150/api/mangas/m1/cover-image",
      expect.objectContaining({
        method: "PUT",
        headers: { "Content-Type": "image/webp" },
      }),
    );
  });

  it.each([
    ["not base64", "!!!", "image/webp"],
    ["empty payload", "", "image/webp"],
    ["non-image content type", btoa("abc"), "text/html"],
  ])("rejects an invalid cover payload (%s)", async (_label, base64, type) => {
    const response = await handleMessage({
      kind: "upload-cover-bytes",
      mangaId: "m1",
      base64,
      contentType: type,
    });

    expect(response).toEqual({ ok: false, error: "Invalid cover payload" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a pixel capture when the sender tab is not visible", async () => {
    const response = await handleMessage(
      {
        kind: "capture-cover-pixels",
        mangaId: "m1",
        rect: { x: 0, y: 0, width: 200, height: 300 },
        dpr: 2,
      },
      5,
      { windowId: 1, active: false },
    );

    expect(response).toEqual({ ok: false, error: "Tab is not visible" });
    expect(captureVisibleTabMock).not.toHaveBeenCalled();
  });

  it("skips the pixel capture when the cover bytes are already stored", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        [{ id: "m1", coverUrl: "https://x.com/c.png", hasStoredCover: true }],
        200,
      ),
    );

    const response = await handleMessage(
      {
        kind: "capture-cover-pixels",
        mangaId: "m1",
        rect: { x: 0, y: 0, width: 200, height: 300 },
        dpr: 2,
      },
      5,
      { windowId: 1, active: true },
    );

    expect(response).toEqual({ ok: true, data: null });
    expect(captureVisibleTabMock).not.toHaveBeenCalled();
  });

  it("screenshots, crops and uploads the pixel-captured cover", async () => {
    captureVisibleTabMock.mockResolvedValue("data:image/png;base64,x");
    createImageBitmapMock.mockResolvedValue({ width: 2000, height: 1600 });
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/library")) {
        return jsonResponse(
          [
            {
              id: "m1",
              coverUrl: "https://x.com/c.png",
              hasStoredCover: false,
            },
          ],
          200,
        );
      }
      if (url.startsWith("data:")) {
        return new Response(new ArrayBuffer(4));
      }
      return jsonResponse({ id: "m1" }, 200);
    });

    const response = await handleMessage(
      {
        kind: "capture-cover-pixels",
        mangaId: "m1",
        rect: { x: 10, y: 20, width: 200, height: 300 },
        dpr: 2,
      },
      5,
      { windowId: 3, active: true },
    );

    expect(response).toEqual({ ok: true, data: null });
    expect(captureVisibleTabMock).toHaveBeenCalledWith(3, { format: "png" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:5150/api/mangas/m1/cover-image",
      expect.objectContaining({
        method: "PUT",
        headers: { "Content-Type": "image/webp" },
      }),
    );
  });

  it("saves an adapter and asks the sender tab to re-detect", async () => {
    const adapter = { id: "a1", domain: "example.com" };
    fetchMock.mockResolvedValue(jsonResponse(adapter, 200));
    const sendMessageMock = vi.fn().mockResolvedValue(undefined);
    // Cast justified: fake-browser's tabs namespace lacks sendMessage; the
    // test provides the minimal stub the handler calls.
    fakeBrowser.tabs.sendMessage =
      sendMessageMock as unknown as typeof fakeBrowser.tabs.sendMessage;

    const response = await handleMessage(
      {
        kind: "save-adapter",
        body: { domain: "example.com", titleSelector: "h1.title" },
      },
      12,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:5150/api/adapters",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          domain: "example.com",
          titleSelector: "h1.title",
        }),
      }),
    );
    expect(sendMessageMock).toHaveBeenCalledWith(12, { kind: "detect-now" });
    expect(response).toEqual({ ok: true, data: adapter });
  });
});
