# manga-tracker-extension

Browser extension (MV3) of the local-first manga tracker. Talks only to
`manga-tracker-api`, on whichever loopback port that backend was installed on
(`utils/api/discovery.ts`; 5150 by default).
Sibling repo: `../manga-tracker-api` (its PLAN.md is the roadmap for both repos).

## Layout
- `entrypoints/` — WXT file-based entrypoints: `background.ts` (service worker),
  `content.ts` (page-info probe), `detector.content.ts` (auto-detection) and
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
  - `utils/calibration.ts` — selector generation for the overlay (@medv/finder,
    round-trip validated)
  - covers — `detection/cover-hunt.ts` (hunt over the page), `cover-capture.ts` (byte fetch
    in the worker), `cover-pixels.ts` (screenshot + crop), `base-domain.ts` (permission is
    granted per base domain: cover CDNs live on sibling subdomains)
- `wxt.config.ts` — manifest definition (permissions, fixed `key` for the stable id)
- `.wxt/` — generated types (`wxt prepare`); never edit, gitignored
- `.output/` — build output; `chrome-mv3-dev/` (dev) and `chrome-mv3/` (build), gitignored.
  `wxt build` wipes this directory, so the browser never loads from here: `bun run
  install:local` syncs it into `~/Library/Application Support/MangaTracker/extension/`,
  which is the path loaded unpacked

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
  and not a constant: the two ids coexist until the store's public key is pasted back here.
  See `docs/CHROME-WEB-STORE.md`.
- **The backend's port is discovered, never assumed.** `host_permissions` is
  `http://localhost/*` — a match pattern with no port matches every port, which is what an
  installed backend needs. The search is bounded by a contract with the installer: **ports
  5150–5159**, and a candidate only counts if `GET /health` returns
  `service: "manga-tracker-api"`. That name is mandatory on every port except 5150, where a
  bare `{status:"ok"}` is still accepted so a backend older than that field keeps working.
  Widening the range means changing it in the installer too.
- Retrying a request on a rediscovered port is only safe when the fetch itself threw —
  nothing reached a server, so a reading event cannot be posted twice. An HTTP error is an
  answer and is never retried (`Attempt` in `utils/api/client.ts`).
- Manga-site host permissions are requested at runtime (`optional_host_permissions`),
  never added statically to the manifest. Tracking is opt-in per site: the popup requests
  the permission (user gesture) and the background registers the detector for that origin.
- Detection never auto-sends below the 0.7 confidence threshold, and a page without a
  chapter marker in its URL (catalog/home pages) is never reported.
- **The series identity has two sources, in this order: the page's own anchor
  (`seriesUrlFrom`), then the chapter path (`seriesUrlFromChapterPath`).** The anchor alone
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
