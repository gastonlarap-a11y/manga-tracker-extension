---
name: new-detection-signal
description: Add a new page signal to the detection pipeline (page-signals → heuristics → confidence) with its colocated test. Use when a manga site is detected wrongly or not at all and a new hint from the page is needed.
---

# New detection signal

The recurring unit of work in this repo: a site stops being detected correctly, and the fix
is a new signal collected from the page and weighed by the heuristics. Follow the shape the
existing signals already have (`seriesLinkTitle` in `page-signals.ts` is the best exemplar).

1. **Reproduce first.** Fetch the failing page and confirm what the DOM actually carries
   (`og:title`, `<h1>`, breadcrumbs, JSON-LD, anchors back to the series page). Never design
   the signal from what the site *should* expose.

2. **Collect it** in `utils/detection/page-signals.ts`: one new field on the `PageSignals`
   interface plus its extraction in `collectPageSignals`. Extraction helpers stay private to
   the module unless a test needs them. The whole file is pure — `doc` and `url` in, plain
   data out, no `browser.*` and no `#imports`.

3. **Weigh it** in `utils/detection/heuristics.ts` (`detectFromHeuristics`), or in
   `adapter.ts` if the signal only makes sense for a calibrated site. Confidence math:
   `CONFIDENCE_THRESHOLD` is 0.7 and nothing below it is ever auto-sent; a page with no
   chapter marker in its URL stays undetected no matter how strong the title signal is.
   Accent/case-insensitive comparisons go through `utils/detection/text.ts`, not new ad-hoc
   normalizers.

4. **Test it** in the colocated `*.test.ts`. Use the `signals()` helper in
   `heuristics.test.ts` (builds a `PageSignals` from a `Partial<>` override) and `it.each`
   tables of real URLs/titles from the site that motivated the change. Add at least one
   negative case: the signal must not fire where it previously did nothing.

5. **Run** `bunx vitest run utils/detection/<file>.test.ts` while iterating, then
   `bun run lint` + `bun run typecheck` + `bun run test` before declaring it done, and use
   the `verify` skill for the live check on the real site.

6. If the site was already producing events under a different name or domain, check the
   migration path in `heuristics.ts` (`extractSeriesSlug`, prefix cleanup) before adding
   anything: the slug is the identity that keeps history from splitting.
