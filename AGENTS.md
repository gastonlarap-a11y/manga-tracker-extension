# manga-tracker-extension

Browser extension (MV3) of the local-first manga tracker. WXT + React 19 + TypeScript,
Bun as package manager. Talks only to `manga-tracker-api` on `http://localhost:5150`.
Sibling repo: `../manga-tracker-api` (its PLAN.md is the roadmap for both repos).

## Layout
- `entrypoints/` — WXT file-based entrypoints: `background.ts` (service worker),
  `content.ts` (on-demand content script, `registration: "runtime"`), `popup/` (React)
- `utils/` — shared logic (auto-importable dir, but imports are explicit via `#imports`/`@/`)
  - `utils/api/` — backend contract types (hand-duplicated) + fetch client
  - `utils/message-handler.ts` — background business logic (entrypoint stays thin)
- `wxt.config.ts` — manifest definition (permissions, fixed `key` for the stable id)
- `.wxt/` — generated types (`wxt prepare`); never edit, gitignored
- `.output/` — build output; `chrome-mv3-dev/` (dev) and `chrome-mv3/` (build), gitignored

## Commands
- Dev: `bun run dev` · Build: `bun run build` · Test: `bun run test` (vitest, not `bun test`)
- Single test: `bunx vitest run <file>`
- Lint: `bun run lint` · Format: `bun run format` · Typecheck: `bun run typecheck`

## Rules
- **Contract duplication**: `utils/api/types.ts` mirrors the API's Zod schemas by hand.
  A contract change in `manga-tracker-api` updates this file in the same commit.
- The background service worker is the only piece that does `fetch()` to the backend;
  popup and content scripts go through typed runtime messages (`utils/messages.ts`).
- Entrypoints stay thin (wiring only); logic lives in `utils/` where vitest can reach it
  (mirror of the API's routes/service split).
- The extension id must stay `cfjiinlnepkmlaafdclmlpjbmpofplop`: never remove or rotate
  `manifest.key` in `wxt.config.ts` (the API's CORS allowlist depends on it).
  The private key (`extension-key.pem`) stays out of git.
- Manga-site host permissions are requested at runtime (`optional_host_permissions`),
  never added statically to the manifest.
- Never edit `.wxt/**` or `.output/**`; never commit `.env*` or `*.pem`.

## Engineering standards
- Every feature ships with its tests (vitest; fake-browser via `wxt/testing` for
  `browser.*` APIs). Run `bun run lint` + `bun run typecheck` + `bun run test` before
  declaring work done; report real results.
- Handle errors explicitly at boundaries: the API client returns
  `ApiResult<T> = { ok: true; data } | { ok: false; error }` — no thrown exceptions
  cross the messaging boundary.
- UI strings are Spanish; code, identifiers and comments are English.
