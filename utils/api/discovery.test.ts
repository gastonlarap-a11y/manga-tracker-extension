import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import {
  baseUrlFor,
  candidatePorts,
  DEFAULT_PORT,
  discoverBaseUrl,
  forgetBaseUrl,
  LAST_PORT,
  resolveBaseUrl,
  SERVICE_NAME,
} from "./discovery";

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

function healthResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Answers a healthy backend on exactly one port and refuses everywhere else. */
function backendOn(port: number, body: unknown): void {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url === `${baseUrlFor(port)}/health`) {
      return healthResponse(body);
    }
    throw new TypeError("Failed to fetch");
  });
}

beforeEach(() => {
  fakeBrowser.reset();
});

afterEach(() => {
  fetchMock.mockReset();
});

describe("candidatePorts", () => {
  it("is the ten-port window the installer picks from", () => {
    const ports = candidatePorts();

    expect(ports).toHaveLength(10);
    expect(ports[0]).toBe(DEFAULT_PORT);
    expect(ports.at(-1)).toBe(LAST_PORT);
  });
});

describe("discoverBaseUrl", () => {
  it("finds the backend on the default port with a single request", async () => {
    // The ordinary case has to stay cheap: no ten-port sweep when the backend
    // is exactly where it has always been.
    backendOn(DEFAULT_PORT, { status: "ok", service: SERVICE_NAME });

    expect(await discoverBaseUrl()).toBe(baseUrlFor(DEFAULT_PORT));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("accepts a backend older than the service field, but only on 5150", async () => {
    // Updating the extension before the backend must not break the install
    // that is already working.
    backendOn(DEFAULT_PORT, { status: "ok" });

    expect(await discoverBaseUrl()).toBe(baseUrlFor(DEFAULT_PORT));
  });

  it("finds a backend an installer moved to another port", async () => {
    backendOn(5157, { status: "ok", service: SERVICE_NAME });

    expect(await discoverBaseUrl()).toBe(baseUrlFor(5157));
  });

  it("ignores an unrelated local server that answers 200", async () => {
    // Something else on 5153 replying {status:"ok"} is not our backend, and
    // posting reading events into it would be silent data loss.
    backendOn(5153, { status: "ok" });

    expect(await discoverBaseUrl()).toBeNull();
  });

  it("ignores a server whose name is not ours", async () => {
    backendOn(5153, { status: "ok", service: "some-other-app" });

    expect(await discoverBaseUrl()).toBeNull();
  });

  it("picks the lowest port when two backends answer", async () => {
    // Reproducibility: a run must not latch onto whichever replied first.
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (
        url === `${baseUrlFor(5155)}/health` ||
        url === `${baseUrlFor(5152)}/health`
      ) {
        return healthResponse({ status: "ok", service: SERVICE_NAME });
      }
      throw new TypeError("Failed to fetch");
    });

    expect(await discoverBaseUrl()).toBe(baseUrlFor(5152));
  });

  it("returns null when nothing is listening", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    expect(await discoverBaseUrl()).toBeNull();
    // Every candidate was tried and none answered.
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it("does not mistake a non-JSON or failing response for the backend", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html>nope</html>", { status: 200 }),
    );

    expect(await discoverBaseUrl()).toBeNull();
  });
});

describe("resolveBaseUrl", () => {
  it("probes once and reuses the result across service worker restarts", async () => {
    // The reason the cache is in storage and not in memory: MV3 tears the
    // worker down after seconds of inactivity.
    backendOn(5156, { status: "ok", service: SERVICE_NAME });

    expect(await resolveBaseUrl()).toBe(baseUrlFor(5156));
    const afterFirst = fetchMock.mock.calls.length;
    expect(await resolveBaseUrl()).toBe(baseUrlFor(5156));

    expect(fetchMock).toHaveBeenCalledTimes(afterFirst);
  });

  it("sweeps once when several callers ask at the same time", async () => {
    // Startup fires the detector re-sync, the cover backfill and any open tab
    // at once; without the in-flight guard that is three full sweeps.
    backendOn(5158, { status: "ok", service: SERVICE_NAME });

    const [a, b, c] = await Promise.all([
      resolveBaseUrl(),
      resolveBaseUrl(),
      resolveBaseUrl(),
    ]);

    expect([a, b, c]).toEqual([
      baseUrlFor(5158),
      baseUrlFor(5158),
      baseUrlFor(5158),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it("looks again after the cached backend is forgotten", async () => {
    backendOn(DEFAULT_PORT, { status: "ok", service: SERVICE_NAME });
    expect(await resolveBaseUrl()).toBe(baseUrlFor(DEFAULT_PORT));

    // The backend moved: a reinstall picked a different free port.
    await forgetBaseUrl();
    backendOn(5154, { status: "ok", service: SERVICE_NAME });

    expect(await resolveBaseUrl()).toBe(baseUrlFor(5154));
  });

  it("caches nothing when the backend is not running", async () => {
    // A failed lookup must not be remembered, or starting the backend would
    // require restarting the browser.
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await resolveBaseUrl()).toBeNull();

    backendOn(DEFAULT_PORT, { status: "ok", service: SERVICE_NAME });
    expect(await resolveBaseUrl()).toBe(baseUrlFor(DEFAULT_PORT));
  });
});
