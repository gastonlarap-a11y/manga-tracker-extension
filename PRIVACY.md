# Privacy Policy — Manga Tracker

_Last updated: 30 September 2026_

## Summary

**Manga Tracker does not collect, transmit, sell or share any user data.** Everything the
extension produces stays on the computer it runs on.

The extension has no server. Everything it records goes to one address — `http://localhost`,
the loopback interface of the same machine — where the user has installed the companion
application, [`manga-tracker-api`](https://github.com/gastonlarap-a11y/manga-tracker-api)
(set up by [Manga Tracker for desktop](https://github.com/gastonlarap-a11y/manga-tracker-desktop)).
That application stores the reading history in a SQLite file inside the user's own profile
directory. There is no account, no login, no telemetry, no analytics and no third-party
service of any kind.

The only other requests it makes are downloads from the manga sites the user enabled: a
series' page and its cover image, to show the cover in the library. Those requests carry
nothing the extension collected — see below.

## What the extension reads, and why

When the user explicitly enables tracking for a site, the extension reads, **from that site
only**:

- the page title and a small number of DOM elements, to work out the manga title and the
  chapter number being read;
- the page URL, to identify the series and the chapter;
- the URL of the cover image, and — when the site blocks direct downloads — the pixels of
  the cover already displayed on screen.

That information is sent to the local application over `http://localhost` and is written to
the local database. It never leaves the machine.

## What the extension never does

- It never sends data to a remote server, including any server owned by the author. The
  cover downloads described above are plain requests for a page or an image, sent to the
  site that serves them, and include nothing the extension read or recorded.
- It never reads pages of sites the user has not enabled. Access to manga sites is
  requested at runtime, one site at a time, through an explicit user action
  (`optional_host_permissions`); a site that was never enabled is never touched.
- It does not set, read or store cookies, and uses no tracking pixels or fingerprinting.
  When it downloads a cover from a site the user enabled, the browser attaches that site's
  own cookies to the request, exactly as it does when the page itself shows the image —
  many image servers refuse the request otherwise. The extension never sees those cookies.
- It does not read passwords, form fields, payment details, browsing history, bookmarks or
  the content of tabs other than the tracked page.

## Permissions

| Permission | Why it is needed |
|---|---|
| `storage` | Remembers which local port the companion application is listening on, so the extension does not have to search for it on every request; keeps a copy of the site rules the companion application serves; and holds readings made while the companion application was not answering, until they are delivered to it. All of it stays in the browser, on this machine. |
| `alarms` | Retries delivering those held readings, once a minute, only while there are any. |
| `activeTab` | Reads the title and chapter markers of the tab the user is looking at, when the user acts on it. |
| `scripting` | Injects the detection script into the sites the user enabled, and the two-click calibration overlay when the user calibrates a site by hand. |
| `http://localhost/*` | The only place readings are sent: the companion application on the user's own machine. The port is not fixed because the installer picks one that is free, so the pattern covers any port on `localhost`. It grants no access to the internet. |
| `https://*/*`, `http://*/*` (optional) | Requested at runtime, per site, only when the user turns on tracking for that site. Never granted in advance. Lets the extension read the tracked pages of that site and download a series' cover from it. |

## Optional synchronisation

The companion application can optionally replicate the library to a database the user
owns, to keep two of their own computers in sync. That feature is **off unless the user
enters their own credentials**, it lives entirely in the companion application, and the
extension takes no part in it. The author operates no shared infrastructure for other
users.

## Source code

Both the extension and the companion application are open source. Anything stated here can
be verified in the code:

- Extension: https://github.com/gastonlarap-a11y/manga-tracker-extension
- Companion application: https://github.com/gastonlarap-a11y/manga-tracker-api

## Contact

Questions about this policy: gaston.lara.p@gmail.com
