import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import {
  injectDetectorIntoOpenTabs,
  registerSite,
  syncRegisteredSites,
  unregisterSite,
} from "./site-registration";

const getRegisteredMock = vi.fn();
const registerMock = vi.fn();
const unregisterMock = vi.fn();
const executeScriptMock = vi.fn();
const getAllPermissionsMock = vi.fn();
const tabsQueryMock = vi.fn();

beforeEach(() => {
  fakeBrowser.reset();
  getRegisteredMock.mockReset();
  registerMock.mockReset();
  unregisterMock.mockReset();
  executeScriptMock.mockReset();
  getAllPermissionsMock.mockReset();
  tabsQueryMock.mockReset();
  // Cast justified: fake-browser does not implement the scripting/permissions
  // namespaces, so the test provides the minimal stubs the logic calls.
  fakeBrowser.scripting = {
    getRegisteredContentScripts: getRegisteredMock,
    registerContentScripts: registerMock,
    unregisterContentScripts: unregisterMock,
    executeScript: executeScriptMock,
  } as unknown as typeof fakeBrowser.scripting;
  fakeBrowser.permissions = {
    getAll: getAllPermissionsMock,
  } as unknown as typeof fakeBrowser.permissions;
  // Cast justified: same as above for the url-filtered tabs query.
  fakeBrowser.tabs.query =
    tabsQueryMock as unknown as typeof fakeBrowser.tabs.query;
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

describe("syncRegisteredSites", () => {
  it("re-registers granted origins whose registration was wiped", async () => {
    getAllPermissionsMock.mockResolvedValue({
      origins: ["http://localhost:5150/*", "https://olympusxyz.com/*"],
      permissions: ["storage", "activeTab", "scripting"],
    });
    getRegisteredMock.mockResolvedValue([]);
    registerMock.mockResolvedValue(undefined);

    const result = await syncRegisteredSites();

    expect(registerMock).toHaveBeenCalledWith([
      {
        id: "detector:https://olympusxyz.com/*",
        matches: ["https://olympusxyz.com/*"],
        js: ["/content-scripts/detector.js"],
        runAt: "document_idle",
        persistAcrossSessions: true,
      },
    ]);
    expect(unregisterMock).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, data: null });
  });

  it("never registers a detector for the backend host permission", async () => {
    getAllPermissionsMock.mockResolvedValue({
      origins: ["http://localhost:5150/*"],
      permissions: [],
    });
    getRegisteredMock.mockResolvedValue([]);

    const result = await syncRegisteredSites();

    expect(registerMock).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, data: null });
  });

  it("leaves origins that are already registered untouched", async () => {
    getAllPermissionsMock.mockResolvedValue({
      origins: ["https://olympusxyz.com/*"],
      permissions: [],
    });
    getRegisteredMock.mockResolvedValue([
      { id: "detector:https://olympusxyz.com/*" },
    ]);

    const result = await syncRegisteredSites();

    expect(registerMock).not.toHaveBeenCalled();
    expect(unregisterMock).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, data: null });
  });

  it("unregisters detectors whose permission was revoked", async () => {
    getAllPermissionsMock.mockResolvedValue({ origins: [], permissions: [] });
    getRegisteredMock.mockResolvedValue([
      { id: "detector:https://revoked.com/*" },
    ]);
    unregisterMock.mockResolvedValue(undefined);

    const result = await syncRegisteredSites();

    expect(unregisterMock).toHaveBeenCalledWith({
      ids: ["detector:https://revoked.com/*"],
    });
    expect(result).toEqual({ ok: true, data: null });
  });

  it("surfaces sync failures", async () => {
    getAllPermissionsMock.mockRejectedValue(new Error("permissions broken"));
    getRegisteredMock.mockResolvedValue([]);

    const result = await syncRegisteredSites();

    expect(result).toEqual({ ok: false, error: "permissions broken" });
  });
});

describe("injectDetectorIntoOpenTabs", () => {
  it("injects the detector into every open tab of granted origins", async () => {
    getAllPermissionsMock.mockResolvedValue({
      origins: ["http://localhost:5150/*", "https://olympusxyz.com/*"],
      permissions: [],
    });
    tabsQueryMock.mockResolvedValue([{ id: 3 }, { id: 9 }]);
    executeScriptMock.mockResolvedValue([]);

    const result = await injectDetectorIntoOpenTabs();

    expect(tabsQueryMock).toHaveBeenCalledWith({
      url: "https://olympusxyz.com/*",
    });
    expect(tabsQueryMock).not.toHaveBeenCalledWith({
      url: "http://localhost:5150/*",
    });
    expect(executeScriptMock).toHaveBeenCalledWith({
      target: { tabId: 3 },
      files: ["/content-scripts/detector.js"],
    });
    expect(executeScriptMock).toHaveBeenCalledWith({
      target: { tabId: 9 },
      files: ["/content-scripts/detector.js"],
    });
    expect(result).toEqual({ ok: true, data: null });
  });

  it("keeps going when one tab rejects the injection", async () => {
    getAllPermissionsMock.mockResolvedValue({
      origins: ["https://olympusxyz.com/*"],
      permissions: [],
    });
    tabsQueryMock.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    executeScriptMock
      .mockRejectedValueOnce(new Error("The tab was discarded"))
      .mockResolvedValueOnce([]);

    const result = await injectDetectorIntoOpenTabs();

    expect(executeScriptMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ok: true, data: null });
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
