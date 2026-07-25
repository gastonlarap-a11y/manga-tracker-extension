// Accent/case-insensitive token helpers shared by the signal collector
// (series-link validation) and the heuristics (site-branding discard).

const COMBINING_MARKS = /\p{M}/gu;

export function normalizeTokens(value: string): string[] {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

// Whether two texts share their tokens (fully, or at least half of the larger
// set), so a human label can be checked against a URL slug regardless of
// accents, casing or separators.
export function tokensRoughlyMatch(a: string, b: string): boolean {
  const tokensA = normalizeTokens(a);
  const tokensB = normalizeTokens(b);
  if (tokensA.length === 0 || tokensB.length === 0) {
    return false;
  }
  if (tokensA.join(" ") === tokensB.join(" ")) {
    return true;
  }
  const setB = new Set(tokensB);
  const shared = tokensA.filter((token) => setB.has(token)).length;
  return shared * 2 >= Math.max(tokensA.length, tokensB.length);
}
