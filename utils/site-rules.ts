/**
 * What this extension knows about individual sites, fetched from the local
 * backend instead of being compiled in.
 *
 * The reason is the release cycle, not elegance. This extension ships through
 * the Chrome Web Store, so teaching it one new site used to mean a new version
 * and days of review for what is, in the end, a regex. The backend travels with
 * the desktop app and lands on the machine the next time it updates, so a site
 * nobody anticipated stops being Google's problem.
 *
 * Cached, because a detection must never wait on the network: the cache serves
 * whatever it has, and a stale copy is refreshed behind the reader's back. With
 * no cache at all, detection simply falls back to the generic heuristics, which
 * is what every site got before this existed.
 */
import { storage } from "#imports";
import { getSiteRules } from "./api/client";
import type { SiteRuleDto } from "./api/types";

const CACHE_KEY = "local:siteRules" as const;

/**
 * How long a copy is served before it is refreshed. Long, on purpose: rules
 * change when a site changes its URLs, which is a matter of months, and the
 * cost of being a few hours late is one series keyed by title instead of by
 * URL — recoverable, unlike hammering the backend on every page load.
 */
export const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

type CachedRules = {
  rules: SiteRuleDto[];
  fetchedAt: number;
};

/**
 * The rule for a host, or null when the generic heuristics are enough.
 *
 * Matches subdomains too, so a site read on `www.` or on a regional host still
 * finds its rule.
 */
export function ruleForHost(
  rules: readonly SiteRuleDto[],
  host: string,
): SiteRuleDto | null {
  const needle = host.toLowerCase().replace(/^www\./, "");
  return (
    rules.find(
      (rule) => needle === rule.domain || needle.endsWith(`.${rule.domain}`),
    ) ?? null
  );
}

/**
 * The series page a rule derives from a chapter URL, or null when it does not
 * apply.
 *
 * `navigable` travels with it because the two consumers want different things:
 * the reading event needs an identity, while the cover hunt downloads the page.
 * An identity that was assembled rather than found is fine as a key and useless
 * as an address.
 */
export function seriesFromRule(
  rule: SiteRuleDto,
  url: string,
): { url: string; navigable: boolean } | null {
  if (rule.series === null) {
    return null;
  }
  let match: RegExpExecArray | null;
  try {
    match = new RegExp(rule.series.pattern, "i").exec(url);
  } catch {
    // A malformed pattern is a bug in the catalogue, not a reason to stop
    // detecting on the page in front of the reader.
    return null;
  }
  const captured = match?.[1];
  if (!captured) {
    return null;
  }
  return {
    url: rule.series.template.replace("$1", captured),
    navigable: rule.series.navigable,
  };
}

/** The cached rules, however old, or an empty list if there are none yet. */
export async function cachedRules(): Promise<SiteRuleDto[]> {
  const cached = await storage.getItem<CachedRules>(CACHE_KEY);
  return cached?.rules ?? [];
}

/**
 * Fetches the catalogue and stores it.
 *
 * A failure leaves the previous copy alone: the backend being down or mid
 * restart says nothing about whether the rules that already arrived are still
 * good.
 */
export async function refreshRules(now: number = Date.now()): Promise<boolean> {
  const result = await getSiteRules();
  if (!result.ok) {
    return false;
  }
  await storage.setItem<CachedRules>(CACHE_KEY, {
    rules: result.data,
    fetchedAt: now,
  });
  return true;
}

/**
 * The rules to detect with, refreshing in the background when the copy is old.
 *
 * Never awaits the refresh — the caller is a content script about to decide
 * what the reader is looking at, and a slow backend must not delay that by a
 * single frame.
 */
export async function rulesForDetection(
  now: number = Date.now(),
): Promise<SiteRuleDto[]> {
  const cached = await storage.getItem<CachedRules>(CACHE_KEY);
  if (cached === null) {
    // Nothing yet: this is the one case worth waiting for, since the
    // alternative is detecting the very first page with no rules at all.
    const fetched = await refreshRules(now);
    return fetched ? await cachedRules() : [];
  }
  if (now - cached.fetchedAt > CACHE_TTL_MS) {
    void refreshRules(now);
  }
  return cached.rules;
}
