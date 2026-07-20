import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { captureCoverFromVisibleTab, cropDataUrl } from "./cover-pixels";

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

const createImageBitmapMock = vi.fn();
vi.stubGlobal("createImageBitmap", createImageBitmapMock);

const drawImageMock = vi.fn();
const convertToBlobMock = vi.fn();
class FakeOffscreenCanvas {
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext(): unknown {
    return { drawImage: drawImageMock };
  }
  convertToBlob(options: unknown): unknown {
    return convertToBlobMock(options);
  }
}
vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);

const captureVisibleTabMock = vi.fn();

const RECT = { x: 10, y: 20, width: 200, height: 300 };

function webpBlob(byteLength: number): unknown {
  return {
    type: "image/webp",
    arrayBuffer: async () => new ArrayBuffer(byteLength),
  };
}

beforeEach(() => {
  fakeBrowser.reset();
  fetchMock.mockReset();
  createImageBitmapMock.mockReset();
  drawImageMock.mockReset();
  convertToBlobMock.mockReset();
  captureVisibleTabMock.mockReset();
  // Cast justified: fake-browser does not implement captureVisibleTab, so the
  // test provides the minimal stub the capture calls.
  fakeBrowser.tabs.captureVisibleTab =
    captureVisibleTabMock as unknown as typeof fakeBrowser.tabs.captureVisibleTab;
});

describe("cropDataUrl", () => {
  it("crops the dpr-scaled rect and returns webp bytes", async () => {
    fetchMock.mockResolvedValue(new Response(new ArrayBuffer(4)));
    const bitmap = { width: 2000, height: 1600 };
    createImageBitmapMock.mockResolvedValue(bitmap);
    convertToBlobMock.mockResolvedValue(webpBlob(6));

    const image = await cropDataUrl("data:image/png;base64,x", RECT, 2);

    expect(drawImageMock).toHaveBeenCalledWith(
      bitmap,
      20,
      40,
      400,
      600,
      0,
      0,
      400,
      600,
    );
    expect(image?.contentType).toBe("image/webp");
    expect(image?.bytes.byteLength).toBe(6);
  });

  it("clamps the crop to the screenshot bounds", async () => {
    fetchMock.mockResolvedValue(new Response(new ArrayBuffer(4)));
    createImageBitmapMock.mockResolvedValue({ width: 1000, height: 700 });
    convertToBlobMock.mockResolvedValue(webpBlob(3));

    const image = await cropDataUrl(
      "data:image/png;base64,x",
      { x: 450, y: 300, width: 200, height: 300 },
      2,
    );

    // 450*2=900 → width clamps to 1000-900=100; 300*2=600 → height to 100.
    expect(drawImageMock).toHaveBeenCalledWith(
      { width: 1000, height: 700 },
      900,
      600,
      100,
      100,
      0,
      0,
      100,
      100,
    );
    expect(image).not.toBeNull();
  });

  it("returns null when the bitmap decode fails", async () => {
    fetchMock.mockResolvedValue(new Response(new ArrayBuffer(4)));
    createImageBitmapMock.mockRejectedValue(new Error("bad png"));

    expect(await cropDataUrl("data:image/png;base64,x", RECT, 2)).toBeNull();
  });
});

describe("captureCoverFromVisibleTab", () => {
  it("returns null without capturing when the rect is too small", async () => {
    const image = await captureCoverFromVisibleTab(
      1,
      { x: 0, y: 0, width: 10, height: 20 },
      2,
    );

    expect(image).toBeNull();
    expect(captureVisibleTabMock).not.toHaveBeenCalled();
  });

  it("returns null when the screenshot itself fails", async () => {
    captureVisibleTabMock.mockRejectedValue(new Error("no permission"));

    expect(await captureCoverFromVisibleTab(1, RECT, 2)).toBeNull();
  });

  it("crops the captured screenshot", async () => {
    captureVisibleTabMock.mockResolvedValue("data:image/png;base64,x");
    fetchMock.mockResolvedValue(new Response(new ArrayBuffer(4)));
    createImageBitmapMock.mockResolvedValue({ width: 2000, height: 1600 });
    convertToBlobMock.mockResolvedValue(webpBlob(5));

    const image = await captureCoverFromVisibleTab(7, RECT, 2);

    expect(captureVisibleTabMock).toHaveBeenCalledWith(7, { format: "png" });
    expect(image?.bytes.byteLength).toBe(5);
  });
});
