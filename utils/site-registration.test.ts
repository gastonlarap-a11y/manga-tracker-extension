import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { registerSite, unregisterSite } from "./site-registration";

const getRegisteredMock = vi.fn();
const registerMock = vi.fn();
const unregisterMock = vi.fn();
const executeScriptMock = vi.fn();

beforeEach(() => {
  fakeBrowser.reset();
  getRegisteredMock.mockReset();
  registerMock.mockReset();
  unregisterMock.mockReset();
  executeScriptMock.mockReset();
  // Cast justified: fake-browser does not implement the scripting namespace,
  // so the test provides the minimal stub the registration logic calls.
  fakeBrowser.scripting = {
    getRegisteredContentScripts: getRegisteredMock,
    registerContentScripts: registerMock,
    unregisterContentScripts: unregisterMock,
    executeScript: executeScriptMock,
  } as unknown as typeof fakeBrowser.scripting;
});

describe("registerSite", () => {
  it("registers the detector for the origin and runs it on the current tab", async () => {
    getRegisteredMock.mockResolvedValue([]);
    registerMock.mockResolvedValue(undefined);
    executeScriptMock.mockResolvedValue([]);

    const result = await registerSite("https://example.com/*", 4);

    expect(registerMock).toHaveBeenCalledWith([
      {
        id: "detector:https://example.com/*",
        matches: ["https://example.com/*"],
        js: ["/content-scripts/detector.js"],
        runAt: "document_idle",
        persistAcrossSessions: true,
      },
    ]);
    expect(executeScriptMock).toHaveBeenCalledWith({
      target: { tabId: 4 },
      files: ["/content-scripts/detector.js"],
    });
    expect(result).toEqual({ ok: true, data: null });
  });

  it("does not register twice for the same origin", async () => {
    getRegisteredMock.mockResolvedValue([
      { id: "detector:https://example.com/*" },
    ]);
    executeScriptMock.mockResolvedValue([]);

    const result = await registerSite("https://example.com/*", 4);

    expect(registerMock).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, data: null });
  });

  it("surfaces registration failures", async () => {
    getRegisteredMock.mockResolvedValue([]);
    registerMock.mockRejectedValue(new Error("Invalid match pattern"));

    const result = await registerSite("bad-pattern", 4);

    expect(result).toEqual({ ok: false, error: "Invalid match pattern" });
  });
});

describe("unregisterSite", () => {
  it("unregisters an existing detector", async () => {
    getRegisteredMock.mockResolvedValue([
      { id: "detector:https://example.com/*" },
    ]);
    unregisterMock.mockResolvedValue(undefined);

    const result = await unregisterSite("https://example.com/*");

    expect(unregisterMock).toHaveBeenCalledWith({
      ids: ["detector:https://example.com/*"],
    });
    expect(result).toEqual({ ok: true, data: null });
  });

  it("is a no-op when nothing is registered", async () => {
    getRegisteredMock.mockResolvedValue([]);

    const result = await unregisterSite("https://example.com/*");

    expect(unregisterMock).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, data: null });
  });
});
