---
name: verify
description: Verify an extension change end-to-end (tests, build, reload in the browser, live detection check). Use before declaring work done.
---

# Verify

1. Run the suite: `bun run test` (vitest; ~141 tests as of phase 8 + covers).
   Under the harness sandbox this fails with `GetPortError` — WXT reserves a dev-server
   port while resolving its config. Run it outside the sandbox (or manage an exception
   via `/sandbox`); the failure is not a test failure.
2. Build: `bun run build` → must produce `.output/chrome-mv3/` with no errors.
3. Backend up: `curl http://localhost:5150/health` → expect HTTP 200. If it is down,
   detection events cannot be verified; say so instead of skipping silently.
4. Manual reload: the user reloads the extension in `chrome://extensions` (id
   `cfjiinlnepkmlaafdclmlpjbmpofplop`, loaded unpacked from `.output/chrome-mv3/` or the
   dev output). Reloading wipes runtime-registered detectors; the background re-registers
   them and reinjects into open tabs on startup.
5. Live check (when the session has claude-in-chrome available): navigate to a tracked
   manga page, open the popup, and confirm the per-tab diagnosis shows the expected
   detection (title, chapter, confidence). Otherwise ask the user to do this step.
6. Report what was actually observed — including anything that could not be verified.
