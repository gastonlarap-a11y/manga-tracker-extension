/**
 * Which selectors detection uses on a site, whether or not the backend is
 * there to ask.
 *
 * A calibration lives in the backend (`/api/adapters`), and it used to be asked
 * for on every page with nothing to fall back on. With the backend away, a
 * calibrated site lost its calibration, detection fell back to the heuristics
 * that had failed there in the first place — which is why it was calibrated —
 * and the reading never got as far as the outbox that exists for exactly that
 * moment. So the last calibration this browser saw is kept per site, and a
 * curated rule from the backend's catalogue stands in when there is no
 * calibration at all.
 *
 * In order: the user's calibration from the backend; that same calibration as
 * last seen, when the backend cannot answer; the site's curated selectors;
 * nothing, which is the generic heuristics.
 */
import { storage } from "#imports";
import { getAdapter } from "./api/client";
import type { SiteAdapterDto } from "./api/types";
import type { DetectionSelectors } from "./detection/adapter";
import { ruleForHost, rulesForDetection } from "./site-rules";

/**
 * One key per site rather than one map for all: tabs on different sites detect
 * at the same time, and a shared map would need its read-modify-write
 * serialized for nothing.
 */
function cacheKey(domain: string): `local:${string}` {
  return `local:calibration:${domain.toLowerCase()}`;
}

/**
 * What the backend last said about a site. `null` is an answer — "not
 * calibrated" — and is kept as one, so a site the user never calibrated does
 * not look like a cache miss.
 */
type Remembered = { adapter: SiteAdapterDto | null };

export async function selectorsForDetection(
  domain: string,
): Promise<DetectionSelectors | null> {
  const fetched = await getAdapter(domain);
  if (fetched.ok) {
    await storage.setItem<Remembered>(cacheKey(domain), {
      adapter: fetched.data,
    });
    return fetched.data ?? (await curatedSelectors(domain));
  }

  // Away, or answering with an error. Either way the calibration the user made
  // has not stopped being theirs.
  const remembered = await storage.getItem<Remembered>(cacheKey(domain));
  return remembered?.adapter ?? (await curatedSelectors(domain));
}

/**
 * The selectors the backend's catalogue carries for a site, when it has a
 * title selector — without one there is nothing detection could anchor on.
 * Served from the rules cache, so this works with the backend away too.
 */
async function curatedSelectors(
  domain: string,
): Promise<DetectionSelectors | null> {
  const rule = ruleForHost(await rulesForDetection(), domain);
  if (rule === null || rule.titleSelector === null) {
    return null;
  }
  return {
    titleSelector: rule.titleSelector,
    chapterSelector: rule.chapterSelector,
    chapterUrlRegex: rule.chapterUrlRegex,
  };
}
