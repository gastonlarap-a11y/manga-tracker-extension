# manga-tracker-extension

Browser extension (Manifest V3) for the local-first personal manga reading tracker. It detects
what manga/chapter is being read and reports it to
[`manga-tracker-api`](../manga-tracker-api) running on `http://localhost:5150`. Built with
[WXT](https://wxt.dev) + React 19, TypeScript, and Bun.

Current state: **phases 4-6 + SPA detection (8)** of the project plan — popup connected to
the backend, opt-in per-site tracking (host permission requested at runtime), automatic
chapter detection (calibrated adapter or heuristics with a 0.7 confidence threshold; catalog
pages are never reported) and SPA navigation support with a 2s settle debounce. The
calibration overlay (phase 7) comes next.

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
├─ background.ts        → service worker: the only piece that talks to the backend
├─ content.ts           → injected on demand; returns the page's {title, url}
├─ detector.content.ts  → auto-detection; registered per tracked origin, SPA-aware
└─ popup/               → React popup: connection status, site tracking toggle, test button
utils/
├─ api/types.ts         → contracts duplicated by hand from manga-tracker-api
├─ api/client.ts        → fetch wrapper for the backend (Result-style responses)
├─ detection/           → pure pipeline: page signals → adapter/heuristics → confidence
├─ messages.ts          → typed runtime messages (popup/content ↔ background)
├─ message-handler.ts   → background business logic (routes/service split)
├─ site-registration.ts → runtime content-script registration per granted origin
├─ page-info.ts         → PageInfo type + guard shared by content/background
└─ test-event.ts        → builds the phase-5 test event payload
```

## Contract with the API

Types are **duplicated by hand** between repos (no shared package). When a request or
response shape changes in `manga-tracker-api`, update `utils/api/types.ts` in the same
commit.
