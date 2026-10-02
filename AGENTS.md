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
  - `utils/detection/` — pure detection pipeline: `detect.ts` (`readPage`: calibration or
    curated selectors → heuristics fed the site's rule and theme), `config.ts` (the
    heuristic's vocabulary and thresholds, compiled defaults plus the backend's additions),
    `themes.ts` (Madara, MangaThemesia… recognised by markup), `page-signals.ts`,
    `heuristics.ts`, `site-rule.ts` (reading one rule; aliases)
  - `utils/remote-config.ts` — the backend's extension config (tuning, themes, notices,
    reading settings), cached and validated field by field
  - `utils/tracking-prefs.ts` — pause, private windows, dismissed notices (`storage.local`)
  - `utils/badge.ts` — the toolbar badge per tab, from the detection log
  - `utils/reading-gate.ts` — "lectura real": when a page counts as read
  - `utils/popup-model.ts` — every sentence the popup says, as plain functions
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
- Live sites: `bun run check:sites [--backend http://127.0.0.1:<port>] [--only <host>]
  [--url <chapter url>]` — the real pipeline over `scripts/sites.json` (home pages only;
  someone's reading history never goes in the repo). Network, so never in CI: run it before a
  release and when a site stops tracking. "bloqueado" is a bot challenge the script cannot
  pass, not a detection failure; SPA sites (manhwaweb) render their title in JavaScript and
  read nothing here

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
- `calibration.css` is web-accessible **without** `use_dynamic_url`, by decision (see the
  comment in `wxt.config.ts`): the only gain is that a site cannot probe for the file, and a
  failure would be an unstyled overlay that WXT reports nowhere. Revisit only with a manual
  check of the calibration overlay in Chrome and Brave before the store upload.
- Manga-site host permissions are requested at runtime (`optional_host_permissions`),
  never added statically to the manifest. Tracking is opt-in per site: the popup requests
  the permission (user gesture) and the background registers the detector for that origin.
- Detection never auto-sends below the confidence threshold (0.7 compiled; the backend may
  move it, globally or per site), and a page without a chapter marker in its URL
  (catalog/home pages) is never reported — unless a site theme's reader marker is on it:
  MangaThemesia carries the chapter mid-segment (`/<slug>-capitulo-12/`), where no URL
  pattern looks.
- **The heuristic is tunable from the backend, by addition only** (`utils/detection/config.ts`
  ← `GET /api/extension-config`). Words, URL patterns, section names and prefixes from the
  backend are added to the compiled ones; numbers replace theirs within bounds; anything
  malformed is dropped on its own. A remote edit can teach, never remove — "capítulo" taken
  away would stop every site at once. Everything remote is data the compiled code interprets,
  never code: MV3 forbids it and the Web Store reviews for it.
- **Precedence on a page: calibration > the site's curated selectors > its theme > the
  generic heuristic.** A theme or rule only *hints* (`PageHints`): a heading, a series link,
  a reader marker; the heuristic still decides. The chapter and the name may come from
  different places: a hinted series link names the manga (a chapter heading abbreviates it on
  some sites), and a heading that is the chapter alone ("Capitulo 48", Madara) gives the
  number and leaves the name to the next source.
- **A series link is a parent of the chapter, the one a theme or rule points at, or a sibling
  the page title vouches for** (heavenmanga: `/manga/leer/<id>` links to `/manga/<slug>`). A
  sibling needs the chapter's first path segment and a title that names it followed by where
  a name ends — so "Solo Leveling" in a sidebar cannot claim "Solo Leveling Ragnarok Capítulo
  5". A link to a section (`/manga/`) is never a series.
- **Pause and private windows hold a reading in the background**, where every reading passes,
  so a detector loaded before the pause obeys it too. Private windows do not record unless
  the person turns it on; a held reading is not queued either.
- **"Lectura real" is off by default** and comes with the extension config (edited in the
  dashboard's Extensión page): visible time and scroll, both, either dropped at 0. A page
  that cannot scroll is read to the bottom by definition.
- **The calibration overlay must never take the pointer.** WXT's `position: "modal"` pins
  its container over the viewport, and that container used to be the target of every click,
  which the overlay then discarded as its own — calibrating did nothing. The container is
  `pointer-events: none` (only the bar opts back in), the pick is made from
  `document.elementsFromPoint` skipping whatever covers the viewport (manga sites lay a
  transparent ad layer over the page) and any empty element laid over a card or a row to
  make it clickable (lectorxd: `<a class="absolute inset-0">` over every chapter row), and a
  rejected click says why on screen. **A pick is checked before it can be saved**
  (`checkPick`): a name that also holds the chapter (lectorxd's `<h1>` is both, glued) or a
  chapter with no number is refused — a calibration replays with full confidence on every
  chapter, so a bad one records wrong readings until someone removes it from the
  dashboard's Extensión page.
- **Never the whole library.** At thousands of series it is megabytes per request. The cover
  capture on a series page asks for that site's cards once per visit
  (`get-library-for-site` → `/api/library?domain=`), the pixel capture asks for the one manga
  (`/api/mangas/{id}/history`), and the startup backfill walks `/api/library/page`. The full
  list is only the "Seguir leyendo" fallback for a backend older than the paged library.
  The backend stores whatever cover bytes it is sent: the check that a stored cover is not
  replaced by a screenshot lives here, in `captureCoverPixels`.
- What tracking a site means is said in the popup before the person agrees (the Web Store's
  prominent-disclosure rule, in force since 2026-08-01): what is read, and that it stays on
  this computer.
- **What this extension knows about individual sites comes from the backend** (`utils/site-rules.ts`
  ← `GET /api/site-rules`), never compiled in. Publishing here costs a Chrome Web Store review,
  so a regex for one new site used to mean days of waiting; the backend ships with the desktop
  app and lands on the machine at its next update. Rules are cached for 6h and refreshed on
  `onInstalled`/`onStartup` — **a detection never waits on the network for them**, and with no
  cache at all everything degrades to the generic heuristics. A rule belongs in the backend's
  catalogue, not here.
- **The series identity has three sources, in this order: a curated rule from the backend, the
  page's own anchor (`seriesUrlFrom`), then the chapter path (`seriesUrlFromChapterPath`).**
  A rule matched through an alias reads the URL as if it were on the rule's domain, so a site
  moving does not split its series into a card per domain.
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
- Every feature ships with its tests (vitest; fake-browser via `wxt/testing/fake-browser`
  for `browser.*` APIs). Run `bun run lint` + `bun run typecheck` + `bun run test` before
  declaring work done; report real results.
- Handle errors explicitly at boundaries: the API client returns
  `ApiResult<T> = { ok: true; data } | { ok: false; error }` — no thrown exceptions
  cross the messaging boundary.
- UI strings are Spanish; code, identifiers and comments are English.
