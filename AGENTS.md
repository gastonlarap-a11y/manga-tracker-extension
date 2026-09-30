# manga-tracker-extension

Browser extension (MV3) of the local-first manga tracker. Talks only to
`manga-tracker-api`, on whichever loopback port that backend was installed on
(`utils/api/discovery.ts`; 5150 by default).
Sibling repo: `../manga-tracker-api` (its PLAN.md is the roadmap for both repos).

## Layout
- `entrypoints/` — WXT file-based entrypoints: `background.ts` (service worker),
  `detector.content.ts` (auto-detection) and
  `calibration.content/` (two-click calibration overlay in a Shadow DOM via
  `createShadowRootUi`); all content scripts are `registration: "runtime"`, injected on
  demand. `popup/` (React)
- `utils/` — shared logic (auto-importable dir, but imports are explicit via `#imports`/`@/`)
  - `utils/api/` — backend contract types (hand-duplicated), fetch client, and
    `discovery.ts` (finds the backend's port and caches it in `storage.session`)
  - `utils/detection/` — pure detection pipeline: page signals → adapter or
    heuristics → confidence (threshold 0.7 gates auto-send)
  - `utils/message-handler.ts` — background business logic (entrypoint stays thin)
  - `utils/site-registration.ts` — runtime registration of the detector per granted origin
  - `utils/detection-log.ts` — last detection per tab (in-memory), feeds the popup diagnosis
  - `utils/outbox.ts` — readings the backend was not reachable for, in `storage.local`, until
    it is
  - `utils/detection-selectors.ts` — which selectors detection uses on a site: its
    calibration (cached for when the backend is away), else the curated rule
  - `utils/calibration.ts` — selector generation for the overlay (@medv/finder,
    round-trip validated)
  - covers — `detection/cover-hunt.ts` (hunt over the page), `cover-capture.ts` (byte fetch
    in the worker), `cover-pixels.ts` (screenshot + crop), `base-domain.ts` (permission is
    granted per base domain: cover CDNs live on sibling subdomains)
- `wxt.config.ts` — manifest definition (permissions, fixed `key` for the stable id)
- `.wxt/` — generated types (`wxt prepare`); never edit, gitignored
- `.output/` — build output; `chrome-mv3-dev/` (dev) and `chrome-mv3/` (build), gitignored.
  `wxt build` wipes this directory, so a stable copy is loaded unpacked instead: `bun run
  install:local` (`scripts/install-local.ts`) swaps the build into the `extension` folder
  beside the backend's data — `~/Library/Application Support/MangaTracker/` on macOS,
  `%APPDATA%\MangaTracker\` on Windows

## Commands
- Test: `bun run test` (vitest, not `bun test`) · Single test: `bunx vitest run <file>`
- Lint: `bun run lint` · Format: `bun run format` · Typecheck: `bun run typecheck`
- Dev: `bun run dev` (HMR into `.output/chrome-mv3-dev/`) · Build: `bun run build`

> `typescript@7` is the native compiler (tsgo) — there is no `tsserver.js`, which is why
> `typescript-lsp@claude-plugins-official` stays disabled in `.claude/settings.json`.

## Rules
- **Contract duplication**: `utils/api/types.ts` mirrors the API's Zod schemas by hand.
  A contract change in `manga-tracker-api` updates this file in the same commit.
- The background service worker is the only piece that does `fetch()` to the backend;
  popup and content scripts go through typed runtime messages (`utils/messages.ts`).
- Entrypoints stay thin (wiring only); logic lives in `utils/` where vitest can reach it;
  `utils/` never imports from `entrypoints/` (mirror of the API's routes/service split).
- The unpacked id must stay `cfjiinlnepkmlaafdclmlpjbmpofplop`: never remove or rotate
  `manifest.key` in `wxt.config.ts`. The private key (`extension-key.pem`) stays out of git.
  The **store** build is the one exception — `bun run zip:store` drops `key`, because the
  Web Store rejects a first upload that declares one ("key field not allowed in manifest")
  and assigns an id of its own. That is why the API's allowlist is a list (`EXTENSION_IDS`)
  and not a constant: the two ids coexist, **by decision** — a developer build and the store
  build installed side by side stay two extensions, which is what testing one against the
  other needs. See `docs/CHROME-WEB-STORE.md`.
- **The backend's port is discovered, never assumed.** The search is bounded by a contract
  with the installer: **ports 5150–5159** (`utils/api/ports.ts`), and a candidate only counts
  if `GET /health` returns `service: "manga-tracker-api"`. That name is mandatory on every
  port except 5150, where a bare `{status:"ok"}` is still accepted so a backend older than
  that field keeps working. `host_permissions` is generated from that same range — one
  `http://localhost:<port>/*` per port, since 0.1.4; it used to be `http://localhost/*`, every
  port on the machine. Widening the range means changing it in the installer too, and it is a
  new Web Store version.
- **A reading the backend was not there for is kept, not dropped** (`utils/outbox.ts`). The
  backend is a service so tracking works with the app closed, but it is dark for seconds at
  every login and during every update. Only a result that never reached a server
  (`neverReachedServer`: no HTTP status, including a request that hit the 10 s
  `REQUEST_TIMEOUT_MS`) is queued; one the backend answered is never retried. Drained oldest
  first by the `flush-reading-outbox` alarm, on startup, and whenever a reading gets through
  again; the backend dedupes a chapter it already has, so a replay is harmless. Each replay
  carries `readAt` (when it was queued), which a backend older than the field ignores.
- **Detection works with the backend away** (`utils/detection-selectors.ts`): a site's
  calibration is cached per domain as last seen, and a curated rule's selectors stand in
  when there is none. Without that, a calibrated site fell back to the heuristics that had
  failed there, and its readings never reached the outbox.
- Retrying a request on a rediscovered port is only safe when the fetch itself threw —
  nothing reached a server, so a reading event cannot be posted twice. An HTTP error is an
  answer and is never retried (`Attempt` in `utils/api/client.ts`).
- Manga-site host permissions are requested at runtime (`optional_host_permissions`),
  never added statically to the manifest. Tracking is opt-in per site: the popup requests
  the permission (user gesture) and the background registers the detector for that origin.
- Detection never auto-sends below the 0.7 confidence threshold, and a page without a
  chapter marker in its URL (catalog/home pages) is never reported.
- **What this extension knows about individual sites comes from the backend** (`utils/site-rules.ts`
  ← `GET /api/site-rules`), never compiled in. Publishing here costs a Chrome Web Store review,
  so a regex for one new site used to mean days of waiting; the backend ships with the desktop
  app and lands on the machine at its next update. Rules are cached for 6h and refreshed on
  `onInstalled`/`onStartup` — **a detection never waits on the network for them**, and with no
  cache at all everything degrades to the generic heuristics. A rule belongs in the backend's
  catalogue, not here.
- **The series identity has three sources, in this order: a curated rule from the backend, the
  page's own anchor (`seriesUrlFrom`), then the chapter path (`seriesUrlFromChapterPath`).**
  A rule that *composes* an identity rather than finding one carries `navigable: false`, and
  that URL is kept away from the cover hunt: it fetches the series page, and asking a site for
  an address it never published reads as "this manga has no cover". The anchor alone
  found almost nothing — measured, 1045 of 1047 stored events carried no series key — and
  without a key the only identity a series has is its title, so one bad title does not make
  one junk card: it merges every reading that arrives under the same wrong name. The path
  fallback returns `null` rather than guess (a reader at the site root, or a chapter id
  sitting before the series), because a key two different series share is worse than none.
- Never edit `.wxt/**` or `.output/**`; never commit `.env*` or `*.pem`.

## Architecture
- `utils/detection/*` is pure (no `browser.*`, no `#imports`) — that is what makes the
  pipeline testable; effects live in `background.ts` / `message-handler.ts`.
- Cover resolution degrades level by level (`og:image` → hunt over the page → byte fetch in
  the worker → screenshot + crop): every level returns `null` on failure and detection
  carries on unaffected.

## Engineering standards
- Every feature ships with its tests (vitest; fake-browser via `wxt/testing` for
  `browser.*` APIs). Run `bun run lint` + `bun run typecheck` + `bun run test` before
  declaring work done; report real results.
- Handle errors explicitly at boundaries: the API client returns
  `ApiResult<T> = { ok: true; data } | { ok: false; error }` — no thrown exceptions
  cross the messaging boundary.
- UI strings are Spanish; code, identifiers and comments are English.
