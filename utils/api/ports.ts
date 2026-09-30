/**
 * The ports the backend may listen on — a contract with its installer, which
 * picks a free one from this range.
 *
 * On its own, with no imports, because `wxt.config.ts` reads it at build time
 * to write the manifest's host permissions: discovery and the permission it
 * needs cannot drift apart when both come from here. Widening the range means
 * widening it in the installer too.
 */

/**
 * Where a checkout and any install that could get it listen. Probed first and
 * on its own, so the ordinary case costs exactly one request.
 */
export const DEFAULT_PORT = 5150;

/** The last port an installer may fall back to. Ten candidates, 5150–5159. */
export const LAST_PORT = 5159;

export function candidatePorts(): number[] {
  const ports: number[] = [];
  for (let port = DEFAULT_PORT; port <= LAST_PORT; port++) {
    ports.push(port);
  }
  return ports;
}
