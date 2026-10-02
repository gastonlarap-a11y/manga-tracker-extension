/**
 * Reading one site's rule: which rule a host has, and the series identity it
 * derives from a chapter URL. Pure — no storage, no browser — so detection's
 * own tests and `scripts/check-sites.ts` reach it outside the extension. The
 * rules themselves are fetched and cached by utils/site-rules.ts.
 */
import type { SiteRuleDto } from "../api/types";

/**
 * The rule for a host, or null when the generic heuristics are enough.
 *
 * Matches subdomains too, so a site read on `www.` or on a regional host still
 * finds its rule — and so does a site read on one of its aliases, the domains
 * a Spanish site rotates through.
 */
export function ruleForHost(
  rules: readonly SiteRuleDto[],
  host: string,
): SiteRuleDto | null {
  const needle = host.toLowerCase().replace(/^www\./, "");
  return (
    rules.find(
      (rule) =>
        servedFrom(needle, rule.domain) ||
        (rule.aliases ?? []).some((alias) => servedFrom(needle, alias)),
    ) ?? null
  );
}

function servedFrom(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * The URL as it reads on the rule's own domain when it was read on an alias;
 * unchanged otherwise. The series pattern names one host, and the key a series
 * gets must not change because the site moved (the backend's `onCanonicalHost`
 * is the same rule).
 */
export function onCanonicalHost(rule: SiteRuleDto, url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (!(rule.aliases ?? []).some((alias) => servedFrom(host, alias))) {
    return url;
  }
  parsed.hostname = rule.domain;
  return parsed.href;
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
    match = new RegExp(rule.series.pattern, "i").exec(
      onCanonicalHost(rule, url),
    );
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
