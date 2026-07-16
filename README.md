# manga-tracker-extension

Browser extension (Manifest V3) for the local-first personal manga reading tracker. It detects
what manga/chapter is being read and reports it to
[`manga-tracker-api`](../manga-tracker-api) running on `http://localhost:5150`. Built with
[WXT](https://wxt.dev) + React 19, TypeScript, and Bun.

Current state: **phases 4-5** of the project plan — popup connected to the backend plus a
manual "test event" button that validates the whole pipeline (popup → service worker →
content script → API → SQLite). Automatic detection heuristics and the calibration overlay
come next.

## Prerequisites

- [Bun](https://bun.sh) 1.3+
- The backend running locally on port 5150 (see `manga-tracker-api`)

## Setup

```sh
bun install   # also runs `wxt prepare` (generates .wxt/ types)
```

## Commands

| Command | What it does |
|---|---|
| `bun run dev` | Dev mode with HMR; outputs to `.output/chrome-mv3-dev/` |
| `bun run build` | Production build into `.output/chrome-mv3/` |
| `bun run zip` | Production build packed as a zip |
| `bun run test` | Run the test suite (vitest + WXT fake-browser) |
| `bun run lint` | Lint and check formatting with Biome |
| `bun run format` | Fix lint issues and format with Biome |
| `bun run typecheck` | Type-check with `tsc --noEmit` |

## Loading the extension (unpacked)

1. Run `bun run dev` (or `bun run build` for the production output).
2. Open `chrome://extensions` (Chrome) or `brave://extensions` (Brave), enable
   **Developer mode**, click **Load unpacked** and pick `.output/chrome-mv3-dev/`
   (dev) or `.output/chrome-mv3/` (build).
3. The extension id is pinned to `cfjiinlnepkmlaafdclmlpjbmpofplop` via the fixed
   `key` in the manifest — the backend's CORS allowlist depends on it staying stable.
4. If Chrome asks for the **Local network access** permission on the first request
   to `localhost`, grant it once.

## Project structure

```
entrypoints/
├─ background.ts     → service worker: the only piece that talks to the backend
├─ content.ts        → injected on demand; returns the page's {title, url}
└─ popup/            → React popup: connection status + test event button
utils/
├─ api/types.ts      → contracts duplicated by hand from manga-tracker-api
├─ api/client.ts     → fetch wrapper for the backend (Result-style responses)
├─ messages.ts       → typed runtime messages (popup ↔ background)
├─ message-handler.ts→ background business logic (routes/service split)
├─ page-info.ts      → PageInfo type + guard shared by content/background
└─ test-event.ts     → builds the phase-5 test event payload
```

## Contract with the API

Types are **duplicated by hand** between repos (no shared package). When a request or
response shape changes in `manga-tracker-api`, update `utils/api/types.ts` in the same
commit.
