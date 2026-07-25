---
name: verify
description: Verify an extension change end-to-end (tests, build, reload in the browser, live detection check). Use before declaring work done.
---

# Verify

1. Run the suite: `bun run test` (vitest) — the whole suite must come back green.
   Runs fine inside the harness sandbox: `sandbox.network.allowLocalBinding` in
   `.claude/settings.json` covers the dev-server port WXT reserves while resolving
   its config (a `GetPortError` here means that setting was removed).
2. Install: `bun run install:local` → builds and syncs into
   `~/Library/Application Support/MangaTracker/extension/`, the stable directory the browser
   loads. Never point the browser at `.output/**`: `wxt build` wipes it, and Chromium drops
   an unpacked extension whose path it cannot read.
   Needs `dangerouslyDisableSandbox` — the harness sandbox does not allow writes under
   `~/Library`.
3. Backend up: `curl http://localhost:5150/health` → expect HTTP 200. If it is down,
   detection events cannot be verified; say so instead of skipping silently.
4. Manual reload: the user hits **Reload** on the extension card in `chrome://extensions`
   (id `cfjiinlnepkmlaafdclmlpjbmpofplop` — pinned by `manifest.key`, independent of the
   directory). Reloading wipes runtime-registered detectors; the background re-registers
   them and reinjects into open tabs on startup.
5. Live check (when the session has claude-in-chrome available): navigate to a tracked
   manga page, open the popup, and confirm the per-tab diagnosis shows the expected
   detection (title, chapter, confidence). Otherwise ask the user to do this step.
6. Report what was actually observed — including anything that could not be verified.
