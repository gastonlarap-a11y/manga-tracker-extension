/**
 * Finding the backend.
 *
 * The base URL used to be the constant `http://localhost:5150`. That holds for
 * a developer checkout, where the port is chosen once and written down, but not
 * for an installed copy: the installer picks a port that is actually free on
 * that machine, because 5150 may well be taken by something else. The extension
 * therefore has to look for the backend instead of assuming where it is.
 *
 * The search is bounded by a contract with the installer: the backend lives on
 * one of ten ports. An unbounded search is not an option — 65k probes per
 * lookup is not a search, it is a port scan.
 */
import { browser } from "#imports";

/**
 * Where a checkout and any install that could get it listen. Probed first and
 * on its own, so the ordinary case costs exactly one request.
 */
export const DEFAULT_PORT = 5150;

/** The last port an installer may fall back to. Ten candidates, 5150–5159. */
export const LAST_PORT = 5159;

/**
 * `GET /health` answers with this. Without it a probe cannot tell this backend
 * from anything else on the machine that returns 200 on a loopback port, and
 * the extension would happily post reading events into a stranger.
 */
export const SERVICE_NAME = "manga-tracker-api";

/**
 * Long enough for a loopback round trip, short enough that ten of them in
 * parallel are unnoticeable. A refused connection fails immediately anyway;
 * this only bounds a port held by something that accepts and never answers.
 */
const PROBE_TIMEOUT_MS = 800;

/**
 * Survives service worker restarts — MV3 tears the worker down after seconds of
 * inactivity, so an in-memory cache would be thrown away between two readings
 * of the same chapter. It does not survive a browser restart, which is the
 * point: a port changed by a reinstall is picked up without stale state having
 * to be invalidated by hand.
 */
const CACHE_KEY = "backendBaseUrl";

export function baseUrlFor(port: number): string {
  return `http://localhost:${port}`;
}

export function candidatePorts(): number[] {
  const ports: number[] = [];
  for (let port = DEFAULT_PORT; port <= LAST_PORT; port++) {
    ports.push(port);
  }
  return ports;
}

/**
 * Asks a port whether our backend is behind it.
 *
 * `requireServiceName` is what keeps the widened search honest. On the default
 * port a bare `{status:"ok"}` is accepted, because a backend older than the
 * release that added the field is still ours and still listening exactly there.
 * On every other port the name is mandatory: those are ports we only reach
 * because we went looking, and a 200 from an unrelated local server is a real
 * possibility.
 */
async function probe(
  port: number,
  requireServiceName: boolean,
): Promise<boolean> {
  let response: Response;
  try {
    response = await fetch(`${baseUrlFor(port)}/health`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch {
    // Refused, timed out, or blocked: not our backend, and not an error worth
    // reporting — most of the ten candidates are expected to answer nothing.
    return false;
  }
  if (!response.ok) {
    return false;
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return false;
  }
  if (typeof body !== "object" || body === null || !("status" in body)) {
    return false;
  }
  if (body.status !== "ok") {
    return false;
  }
  const service = "service" in body ? body.service : undefined;
  if (service === undefined) {
    return !requireServiceName;
  }
  return service === SERVICE_NAME;
}

/**
 * Probes the candidates and returns the base URL of the first backend found,
 * lowest port first. Nothing is cached here — see `resolveBaseUrl`.
 */
export async function discoverBaseUrl(): Promise<string | null> {
  if (await probe(DEFAULT_PORT, false)) {
    return baseUrlFor(DEFAULT_PORT);
  }
  const rest = candidatePorts().filter((port) => port !== DEFAULT_PORT);
  // In parallel, but the winner is chosen by port and not by who answers first:
  // discovery has to be reproducible, or two machines with two backends running
  // would each latch onto a different one between runs.
  const found = await Promise.all(
    rest.map(async (port) => ((await probe(port, true)) ? port : null)),
  );
  const port = found.find((candidate) => candidate !== null);
  return port === undefined ? null : baseUrlFor(port);
}

/**
 * One discovery at a time. On startup the detector re-sync, the cover backfill
 * and any open tab all reach for the backend at once; without this they would
 * each run their own ten-port sweep.
 */
let inFlight: Promise<string | null> | null = null;

/** The cached base URL, discovering it if this browser session has not yet. */
export async function resolveBaseUrl(): Promise<string | null> {
  const cached = await browser.storage.session.get(CACHE_KEY);
  const stored = cached[CACHE_KEY];
  if (typeof stored === "string") {
    return stored;
  }
  if (inFlight === null) {
    inFlight = discoverBaseUrl()
      .then(async (baseUrl) => {
        if (baseUrl !== null) {
          await rememberBaseUrl(baseUrl);
        }
        return baseUrl;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/**
 * Pins where the backend is, skipping discovery. Its real use is in tests: a
 * test that pins the location the way `Runner` pins commands in the API repo
 * never depends on how many ports a sweep happened to try.
 */
export async function rememberBaseUrl(baseUrl: string): Promise<void> {
  await browser.storage.session.set({ [CACHE_KEY]: baseUrl });
}

/**
 * Drops the cached URL after a request could not reach it, so the next call
 * looks again. Without this, a backend that moved would stay unreachable until
 * the browser was restarted.
 */
export async function forgetBaseUrl(): Promise<void> {
  await browser.storage.session.remove(CACHE_KEY);
}
