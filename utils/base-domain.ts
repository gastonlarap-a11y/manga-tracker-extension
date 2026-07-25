// Manga sites serve their cover images from sibling subdomains
// (manhwa-latino.com → zai.manhwa-latino.com), so tracking a site grants the
// whole base domain: the background can then fetch cover bytes from the CDN.

// Minimal heuristic: last 2 labels, expanded to 3 when the 2nd-to-last label
// is a generic second-level label under a 2-letter ccTLD (com.mx, co.uk…).
// Not a full public-suffix list — extend if a real site ever breaks it.
const COMPOUND_SLD = new Set(["com", "net", "org", "co", "gov", "edu", "ac"]);

export function deriveBaseDomain(hostname: string): string {
  const labels = hostname.split(".");
  if (labels.length <= 2) {
    return hostname;
  }
  const tld = labels.at(-1) ?? "";
  const sld = labels.at(-2) ?? "";
  if (tld.length === 2 && COMPOUND_SLD.has(sld)) {
    return labels.slice(-3).join(".");
  }
  return labels.slice(-2).join(".");
}

// Both schemes: some readers still serve chapters (or redirect covers)
// over plain http.
export function trackingOriginPatterns(hostname: string): string[] {
  const base = deriveBaseDomain(hostname);
  return [`https://*.${base}/*`, `http://*.${base}/*`];
}
