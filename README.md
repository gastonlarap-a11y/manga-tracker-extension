# manga-tracker-extension

Browser extension (Manifest V3) that records which manga chapter you are reading and stores
it in an application running on your own computer.

It detects the series and chapter on sites **you** enable, one at a time, and reports them
to the companion app. There is no account, no sign-up and no server: the extension's only
network destination is `http://localhost` — your own machine.

## ⚠️ It needs the companion app

This extension is the half that lives in the browser. The other half is
**[manga-tracker-api](https://github.com/gastonlarap-a11y/manga-tracker-api)**, which runs on
your computer and holds the library.

**Without it running, the popup says `desconectado` (disconnected) and nothing is recorded.
That is the expected behaviour, not a failure.**

## Try it in five minutes

Everything below runs on your own machine. The only prerequisite is
[Bun](https://bun.sh) 1.3+.

**1. Start the companion app**

```sh
git clone https://github.com/gastonlarap-a11y/manga-tracker-api
cd manga-tracker-api
bun install
echo 'DATABASE_URL="file:./dev.db"' > .env
bun run db:generate     # the Prisma client is gitignored, so a fresh clone builds it
bun run dev             # serves on http://127.0.0.1:5150
```

It creates and migrates the database on its own — there is no separate migration step.
Check it with `curl http://127.0.0.1:5150/health`, which answers
`{"status":"ok","service":"manga-tracker-api"}`.

**2. Get the extension into the browser**

Already installed it from the Chrome Web Store? Then skip this step — step 1 is all that
was missing.

Otherwise, load it unpacked:

```sh
git clone https://github.com/gastonlarap-a11y/manga-tracker-extension
cd manga-tracker-extension
bun install
bun run build
```

Open `chrome://extensions` (or `brave://extensions`), turn on **Developer mode**, click
**Load unpacked** and pick `.output/chrome-mv3`.

> For one-off use that is fine. If you are going to rebuild repeatedly, read
> [Loading the extension (unpacked)](#loading-the-extension-unpacked) first — WXT wipes that
> directory on every build and the browser drops the extension.

**3. See it work**

1. Open the extension popup. It should say **Conectado**.
2. Open any manga site and press **Trackear este sitio**. The browser asks for permission
   for that one site — this is the only moment the extension gains access to it.
3. Open a chapter. The popup reports the detected title and chapter, for example
   *"Detectado: … — Cap. 37 (90 %) — guardado"*.
4. Open <http://127.0.0.1:5150/> to see it in the library.

If detection misses on a site with an unusual layout, press **Calibrar detección** and click
the title and then the chapter number: the extension learns that site's selectors.

## Built with

[WXT](https://wxt.dev) + React 19, TypeScript and Bun. The backend is found by probing
`GET /health` on ports **5150-5159** (`utils/api/discovery.ts`), so an installed copy can
listen wherever a port was free.

## Setup for development

```sh
bun install   # also runs `wxt prepare` (generates .wxt/ types)
```

## Commands

| Command | What it does |
|---|---|
| `bun run dev` | Dev mode with HMR; outputs to `.output/chrome-mv3-dev/` |
| `bun run build` | Production build into `.output/chrome-mv3/` |
| `bun run zip` | Production build packed as a zip (keeps `manifest.key`, so the id stays the local one) |
| `bun run zip:store` | Zip for the Chrome Web Store: same build **without** `manifest.key`, which the store rejects on a first upload. See [`docs/CHROME-WEB-STORE.md`](docs/CHROME-WEB-STORE.md) |
| `bun run test` | Run the test suite (vitest + WXT fake-browser) |
| `bun run lint` | Lint and check formatting with Biome |
| `bun run format` | Fix lint issues and format with Biome |
| `bun run typecheck` | Type-check with `tsc --noEmit` |
| `bun run install:local` | Build, then sync it into the stable install directory the browser loads |
| `bun run dev:firefox` / `build:firefox` / `zip:firefox` | Same three, targeting Firefox (`-b firefox`) |

## Loading the extension (unpacked)

**Never load unpacked straight from `.output/`.** WXT wipes that directory
(`rm -rf` + recreate) at the start of every `wxt build` and every `wxt dev` startup, and
there is no flag to disable it. Chromium tracks unpacked extensions *by path* and does not
watch their contents, so a build that lands while the browser reads that path makes it drop
the extension — it disappears from the list and has to be loaded again by hand.

Load it from a stable directory instead:

1. Run `bun run install:local`. It builds and then syncs the output into
   `~/Library/Application Support/MangaTracker/extension/` (next to the backend's database).
   The sync uses `rsync --delete-after`, so that directory always holds a complete,
   loadable extension — it is never emptied, not even for an instant.
2. Open `chrome://extensions` (Chrome) or `brave://extensions` (Brave), enable
   **Developer mode**, click **Load unpacked** and pick that directory. You only do this
   once; afterwards `bun run install:local` + **Reload** on the extension card is enough.
3. The unpacked id is pinned to `cfjiinlnepkmlaafdclmlpjbmpofplop` by the fixed `key` in
   the manifest, so it does not depend on where the directory lives. The Web Store build
   has an id of its own (`acopmmaenbjdpcjcaiadcpdniomkikbd`) because the store refuses a
   first upload that declares a `key` — the backend's allowlist (`EXTENSION_IDS`) accepts
   both, so a store install and a local build can talk to it at the same time.
4. If Chrome asks for the **Local network access** permission on the first request
   to `localhost`, grant it once.

For iterative work `bun run dev` and `.output/chrome-mv3-dev/` are still fine: WXT's
incremental rebuilds do not wipe the directory (only the initial `wxt dev` startup does),
and its own runner handles reloading.

## Project structure

```
entrypoints/
├─ background.ts        → service worker: the only piece that talks to the backend
├─ content.ts           → injected on demand; returns the page's {title, url}
├─ detector.content.ts  → auto-detection; registered per tracked origin, SPA-aware
├─ calibration.content/ → two-click calibration overlay (Shadow DOM UI)
└─ popup/               → React popup: connection status, site tracking toggle, test button
utils/
├─ api/types.ts         → contracts duplicated by hand from manga-tracker-api
├─ api/client.ts        → fetch wrapper for the backend (Result-style responses)
├─ detection/           → pure pipeline: page signals → adapter/heuristics → confidence
├─ detection/cover-hunt.ts → three-level hunt for the real manga cover on series pages
├─ calibration.ts       → selector generation for the overlay (round-trip validated)
├─ base-domain.ts       → base-domain wildcard patterns for per-site permissions
├─ cover-capture.ts     → cover byte download in the browser (Cloudflare-walled CDNs)
├─ cover-pixels.ts      → screenshot-crop fallback when even the browser fetch is blocked
├─ detection-log.ts     → last detection per tab (in-memory); feeds the popup diagnosis
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
