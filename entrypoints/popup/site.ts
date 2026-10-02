import { browser } from "#imports";
import { trackingOriginPatterns } from "@/utils/base-domain";
import { sendRuntimeMessage } from "@/utils/messages";

/** The tab the popup was opened over. */
export interface ActiveTab {
  id: number;
  url: string;
  title: string;
  host: string;
}

export type SiteState =
  | { kind: "loading" }
  | { kind: "untrackable" }
  | { kind: "untracked"; host: string; widePatterns: string[]; tabId: number }
  | {
      kind: "permission-denied";
      host: string;
      widePatterns: string[];
      tabId: number;
    }
  // Legacy grant from before base-domain-wide tracking: the exact origin is
  // tracked, but cover CDNs on sibling subdomains are out of reach until the
  // user re-grants the wide patterns (a user gesture Chrome requires).
  | {
      kind: "tracked-narrow";
      host: string;
      narrowPattern: string;
      widePatterns: string[];
      tabId: number;
    }
  | { kind: "tracked"; host: string; originPatterns: string[]; tabId: number }
  | { kind: "error"; error: string };

export type Tracked = Extract<
  SiteState,
  { kind: "tracked" | "tracked-narrow" }
>;

/** The active tab when it is a web page; null for chrome://, a PDF, none. */
export async function readActiveTab(): Promise<ActiveTab | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || !tab.url) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(tab.url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  return {
    id: tab.id,
    url: tab.url,
    title: tab.title ?? "",
    host: parsed.hostname,
  };
}

export async function readSiteState(tab: ActiveTab | null): Promise<SiteState> {
  if (tab === null) {
    return { kind: "untrackable" };
  }
  const { host, id: tabId } = tab;
  const widePatterns = trackingOriginPatterns(host);
  if (await browser.permissions.contains({ origins: widePatterns })) {
    const repair = await ensureRegistered(widePatterns, tabId);
    if (!repair.ok) {
      return repair.state;
    }
    return { kind: "tracked", host, originPatterns: widePatterns, tabId };
  }
  const narrowPattern = `${new URL(tab.url).origin}/*`;
  if (await browser.permissions.contains({ origins: [narrowPattern] })) {
    const repair = await ensureRegistered([narrowPattern], tabId);
    if (!repair.ok) {
      return repair.state;
    }
    return { kind: "tracked-narrow", host, narrowPattern, widePatterns, tabId };
  }
  return { kind: "untracked", host, widePatterns, tabId };
}

// The granted permission alone does not mean the detector is live: extension
// reloads wipe the registrations and keep the permissions, which used to leave
// the popup claiming "tracked" over a site that never detected anything.
async function ensureRegistered(
  originPatterns: string[],
  tabId: number,
): Promise<{ ok: true } | { ok: false; state: SiteState }> {
  const result = await sendRuntimeMessage({
    kind: "ensure-site-registered",
    originPatterns,
    tabId,
  });
  if (!result.ok) {
    return { ok: false, state: { kind: "error", error: result.error } };
  }
  return { ok: true };
}

async function registerPatterns(
  patterns: string[],
  tabId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  for (const originPattern of patterns) {
    const result = await sendRuntimeMessage({
      kind: "register-site",
      originPattern,
      tabId,
    });
    if (!result.ok) {
      return result;
    }
  }
  return { ok: true };
}

export async function enableTracking(
  current: Extract<SiteState, { kind: "untracked" | "permission-denied" }>,
): Promise<SiteState> {
  const granted = await browser.permissions.request({
    origins: current.widePatterns,
  });
  if (!granted) {
    // A dismissed/denied Chrome prompt used to leave the popup mute — the
    // most confusing "nothing happened" of the whole tracking flow.
    return { ...current, kind: "permission-denied" };
  }
  const result = await registerPatterns(current.widePatterns, current.tabId);
  return result.ok
    ? {
        kind: "tracked",
        host: current.host,
        originPatterns: current.widePatterns,
        tabId: current.tabId,
      }
    : { kind: "error", error: result.error };
}

export async function upgradeTracking(
  current: Extract<SiteState, { kind: "tracked-narrow" }>,
): Promise<SiteState> {
  const granted = await browser.permissions.request({
    origins: current.widePatterns,
  });
  if (!granted) {
    return {
      kind: "permission-denied",
      host: current.host,
      widePatterns: current.widePatterns,
      tabId: current.tabId,
    };
  }
  // Swap the legacy exact-origin registration for the wide one so the same
  // pages don't get two detector registrations.
  await sendRuntimeMessage({
    kind: "unregister-site",
    originPattern: current.narrowPattern,
  });
  await browser.permissions.remove({ origins: [current.narrowPattern] });
  const result = await registerPatterns(current.widePatterns, current.tabId);
  if (result.ok) {
    // The CDN just became reachable — retry pending cover byte captures
    // right away instead of waiting for the next browser start.
    void sendRuntimeMessage({ kind: "backfill-covers" });
  }
  return result.ok
    ? {
        kind: "tracked",
        host: current.host,
        originPatterns: current.widePatterns,
        tabId: current.tabId,
      }
    : { kind: "error", error: result.error };
}

/**
 * Stops tracking every pattern given: the detector registration first, then
 * the permission, so nothing is left running on a site the person let go of.
 */
export async function forgetPatterns(
  patterns: readonly string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  for (const originPattern of patterns) {
    const result = await sendRuntimeMessage({
      kind: "unregister-site",
      originPattern,
    });
    if (!result.ok) {
      return result;
    }
  }
  await browser.permissions.remove({ origins: [...patterns] });
  return { ok: true };
}

export async function disableTracking(current: Tracked): Promise<SiteState> {
  const patterns =
    current.kind === "tracked"
      ? current.originPatterns
      : [current.narrowPattern];
  const result = await forgetPatterns(patterns);
  if (!result.ok) {
    return { kind: "error", error: result.error };
  }
  return {
    kind: "untracked",
    host: current.host,
    widePatterns:
      current.kind === "tracked"
        ? current.originPatterns
        : current.widePatterns,
    tabId: current.tabId,
  };
}

export async function startCalibration(
  tabId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await sendRuntimeMessage({ kind: "start-calibration", tabId });
  return result.ok ? { ok: true } : result;
}

/** Opens a page in a new tab next to this one; the popup closes itself. */
export async function openTab(url: string): Promise<void> {
  await browser.tabs.create({ url });
  window.close();
}
