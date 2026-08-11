# manga-tracker-extension

Browser extension (Manifest V3) that records which manga chapter you are reading and stores it
in an application running on your own computer.

It detects the series and chapter on sites **you** enable, one at a time, and reports them to
the companion app. There is no account, no sign-up and no server: the extension's only network
destination is `http://localhost` — your own machine.

> The app's interface is in Spanish. This document is in English so it can be followed without
> it; every button is quoted in both.

## ⚠️ It needs the companion app

This extension is the half that lives in the browser. The other half runs on your computer and
holds the library. **Without it, the popup says `desconectado` (disconnected) and nothing is
recorded. That is the expected behaviour, not a failure.**

You do **not** have to build anything to get it: there is an installer.

---

# Testing it end to end (about five minutes)

Nothing here needs a developer environment, a compiler or a terminal. Four of the five steps
are downloads and clicks.

## 1. Install the companion app

Download the latest installer:

**→ <https://github.com/gastonlarap-a11y/manga-tracker-desktop/releases/latest>**

| System | File | First run |
|---|---|---|
| **macOS** (Apple Silicon — M1 or newer) | `Manga-Tracker-macOS-AppleSilicon.dmg` | Open the disk image, drag **Manga Tracker** onto **Applications**. macOS will say it cannot verify the developer: System Settings → Privacy & Security → **Open Anyway**. Once per machine. |
| **Windows 10/11** (64-bit) | `Manga-Tracker-Windows-Setup.exe` | Run it. SmartScreen will say the same: **More info** → **Run anyway**. |

The app is not signed with a paid certificate — those are billed yearly and this is a personal
project. Intel Macs are not built; the database driver is per architecture and only Apple
Silicon is verified.

## 2. Open it — that is the whole setup

On first launch the app writes the server out, registers it with the system (launchd on macOS,
Task Scheduler on Windows) and waits until it answers. From then on it starts on its own at
every login, whether or not the app is open.

**There is nothing to configure and no account to create.** The library is a local SQLite file.
Syncing to a database of your own exists under the gear icon and is entirely optional — leave
it alone and everything works.

When the window shows the library (empty on a new install), the backend is up.

## 3. Put the extension in the browser

**From the Chrome Web Store** — open the app's gear icon ⚙ and press **Instalar en Chrome**
(*Install in Chrome*). It opens the listing in that specific browser, not the default one.

That is the normal way, and the one to use. Everything below is for running a copy of your
own — a development build, or a version the store has not published yet. The app already
carries a copy, so there is nothing to clone or build:

1. Gear icon ⚙ → **Cargar una copia local en vez de la publicada** (*Load a local copy instead
   of the published one*) → **mostrar en el Finder** (*show in Finder* / Explorer). A folder
   opens.
2. In the browser, go to `chrome://extensions` (Brave: `brave://extensions`, Edge:
   `edge://extensions`).
3. Turn on **Developer mode** and press **Load unpacked**, choosing that folder.

> The path the app shows is computed on the machine it is running on, so it is *your* folder,
> not anyone else's.

## 4. Check they found each other

Open the extension popup. It should say **Conectado** (*connected*) in green.

If it says `desconectado`, the backend is not answering — go back to step 2. The extension
looks for it on ports 5150-5159, so it keeps working when an installer had to pick a different
one.

## 5. Track a site and read a chapter

A site is only ever tracked because you asked for it. The extension ships with access to
**no** manga site.

1. Open a manga site. A good one to test with is **<https://mangadex.org>** — pick any series
   and open a chapter.
2. With the chapter open, open the popup and press **Trackear este sitio** (*track this site*).
   The browser will ask for permission for that one site. This is the only moment the
   extension gains access to it, and it is revocable from `chrome://extensions`.
3. Reload the chapter, or open the next one. The popup now reports what it saw:
   *"Detectado: Nombre de la serie — Cap. 107 (90 %) — guardado"*.
4. Open the app's window again — the series is in the library, with its chapter. Clicking it
   shows the reading history.

If a site's layout is unusual and detection misses, press **Calibrar detección** (*calibrate
detection*) and click first the title and then the chapter number on the page. The extension
learns that site's selectors and detects it from then on.

## What it does and does not do

- It sends **only** to `http://localhost` — the app on your own computer. There is no remote
  endpoint, no analytics, no telemetry.
- It reads the page's title, URL and cover image on sites you explicitly enabled.
- `host_permissions` is `http://localhost/*` only. Access to any manga site is requested at
  runtime, per site, by you.
- Nothing is uploaded anywhere unless *you* configure a database of your own in the app, which
  is off by default.

Full statement: [PRIVACY.md](PRIVACY.md).

---

# The repositories

Four repositories, and the installer above bundles the first three so a person testing it never
touches them.

| Repository | What it is | Needed to test? |
|---|---|---|
| [manga-tracker-desktop](https://github.com/gastonlarap-a11y/manga-tracker-desktop) | The installer and the window. Carries the other three inside it | **Yes — this is the download** |
| [manga-tracker-api](https://github.com/gastonlarap-a11y/manga-tracker-api) | The server and the library (Bun + Hono + SQLite) | Bundled |
| [manga-tracker-dashboard](https://github.com/gastonlarap-a11y/manga-tracker-dashboard) | The library UI, served by the API | Bundled |
| manga-tracker-extension (this one) | The browser half | Bundled, and on the Web Store |

## Running it from source instead

Only useful if you are changing the code. The prerequisite is [Bun](https://bun.sh) 1.3+.

**The server**

```sh
git clone https://github.com/gastonlarap-a11y/manga-tracker-api
cd manga-tracker-api
bun install
echo 'DATABASE_URL="file:./dev.db"' > .env
bun run db:generate     # the Prisma client is gitignored, so a fresh clone builds it
bun run dev             # serves on http://127.0.0.1:5150
```

It creates and migrates the database on its own. Check it with
`curl http://127.0.0.1:5150/health`, which answers
`{"status":"ok","service":"manga-tracker-api"}`.

**The extension**

```sh
git clone https://github.com/gastonlarap-a11y/manga-tracker-extension
cd manga-tracker-extension
bun install
bun run build
```

Then load `.output/chrome-mv3` unpacked — but read
[Loading the extension (unpacked)](#loading-the-extension-unpacked) first: WXT wipes that
directory on every build and the browser drops the extension.

**The dashboard** (optional — the API serves whatever is in its `public/`)

```sh
git clone https://github.com/gastonlarap-a11y/manga-tracker-dashboard
cd manga-tracker-dashboard
bun install
bun run dev
```

---

# Development

## Built with

[WXT](https://wxt.dev) + React 19, TypeScript and Bun. The backend is found by probing
`GET /health` on ports **5150-5159** (`utils/api/discovery.ts`), so an installed copy can listen
wherever a port was free.

## Setup

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

**Never load unpacked straight from `.output/`.** WXT wipes that directory (`rm -rf` +
recreate) at the start of every `wxt build` and every `wxt dev` startup, and there is no flag
to disable it. Chromium tracks unpacked extensions *by path* and does not watch their contents,
so a build that lands while the browser reads that path makes it drop the extension — it
disappears from the list and has to be loaded again by hand.

Load it from a stable directory instead:

1. Run `bun run install:local`. It builds and then syncs the output into
   `~/Library/Application Support/MangaTracker/extension/` (next to the backend's database).
   The sync uses `rsync --delete-after`, so that directory always holds a complete, loadable
   extension — it is never emptied, not even for an instant.
2. Open `chrome://extensions` (Chrome) or `brave://extensions` (Brave), enable **Developer
   mode**, click **Load unpacked** and pick that directory. You only do this once; afterwards
   `bun run install:local` + **Reload** on the extension card is enough.
3. The unpacked id is pinned to `cfjiinlnepkmlaafdclmlpjbmpofplop` by the fixed `key` in the
   manifest, so it does not depend on where the directory lives. The Web Store build has an id
   of its own (`acopmmaenbjdpcjcaiadcpdniomkikbd`) because the store refuses a first upload
   that declares a `key` — the backend's allowlist (`EXTENSION_IDS`) accepts both, so a store
   install and a local build can talk to it at the same time.
4. If Chrome asks for the **Local network access** permission on the first request to
   `localhost`, grant it once.

For iterative work `bun run dev` and `.output/chrome-mv3-dev/` are still fine: WXT's incremental
rebuilds do not wipe the directory (only the initial `wxt dev` startup does), and its own runner
handles reloading.

## Project structure

```
entrypoints/
├─ background.ts        → service worker: the only piece that talks to the backend
├─ detector.content.ts  → auto-detection; registered per tracked origin, SPA-aware
├─ calibration.content/ → two-click calibration overlay (Shadow DOM UI)
└─ popup/               → React popup: connection status, site tracking toggle, diagnosis
utils/
├─ api/types.ts         → contracts duplicated by hand from manga-tracker-api
├─ api/client.ts        → fetch wrapper for the backend (Result-style responses)
├─ api/discovery.ts     → finds the backend across ports 5150-5159
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
└─ site-rules.ts        → per-site rules fetched from the backend, cached for 6h
```

## Contract with the API

Types are **duplicated by hand** between repos (no shared package). When a request or response
shape changes in `manga-tracker-api`, update `utils/api/types.ts` in the same commit.
