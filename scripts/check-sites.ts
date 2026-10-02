/**
 * Runs the real detection pipeline against live sites, from the command line.
 *
 * The unit tests prove the heuristic against pages someone wrote down; this
 * proves it against what sites serve today, which is what changes. Each entry
 * in sites.json is a chapter URL or a site's home page — for a home page the
 * first link that looks like a chapter is followed and that page is read. The
 * list holds addresses only, never page content.
 *
 * Network, so never in CI: run it by hand before a release, and whenever a
 * site stops tracking, to see what detection makes of the page now.
 *
 *   bun run check:sites                        compiled defaults only
 *   bun run check:sites --backend http://127.0.0.1:5150
 *                                              plus that backend's rules and
 *                                              themes (what a reader gets)
 *   bun run check:sites --only heavenmanga     one site
 *   bun run check:sites --url <chapter url>    one page, not in the list —
 *                                              someone's own reading history
 *                                              has no business in the repo
 *
 * What it cannot see: pages a site renders in JavaScript (manhwaweb, Olympus
 * — the HTML holds no title yet), and sites behind a bot challenge, which say
 * so as "bloqueado".
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import type {
  ExtensionConfigDto,
  SiteRuleDto,
  SiteThemeDto,
} from "../utils/api/types";
import { compileDetectionConfig } from "../utils/detection/config";
import {
  type DetectionContext,
  readPage,
  thresholdFor,
} from "../utils/detection/detect";
import { seriesUrlFromChapterPath } from "../utils/detection/heuristics";
import { ruleForHost, seriesFromRule } from "../utils/detection/site-rule";

interface SiteEntry {
  url: string;
  note?: string;
}

interface Row {
  site: string;
  verdict: string;
  theme: string;
  name: string;
  chapter: string;
  confidence: string;
  series: string;
  url: string;
}

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const TIMEOUT_MS = 20_000;
// Links a home page lists its latest chapters with.
const CHAPTER_LINK = /cap[ií]tulo|chapter|\/cap[-/]|\/ch[-/]|\/leer\//i;

const args = process.argv.slice(2);
const backend = optionAfter("--backend");
const only = optionAfter("--only");
const urls = args.flatMap((arg, index) =>
  args[index - 1] === "--url" ? [arg] : [],
);

function optionAfter(flag: string): string | null {
  const index = args.indexOf(flag);
  return index === -1 ? null : (args[index + 1] ?? null);
}

async function loadContext(): Promise<{
  rules: SiteRuleDto[];
  themes: SiteThemeDto[];
  config: DetectionContext["config"];
}> {
  if (backend === null) {
    return { rules: [], themes: [], config: compileDetectionConfig(null) };
  }
  // Cast justified: a development tool reading the backend it was pointed
  // at; the extension's own parsing is tested in utils/remote-config.test.ts.
  const rules = (await (
    await fetch(`${backend}/api/site-rules`)
  ).json()) as SiteRuleDto[];
  const response = await fetch(`${backend}/api/extension-config`);
  const remote = response.ok
    ? ((await response.json()) as ExtensionConfigDto)
    : null;
  return {
    rules,
    themes: remote?.themes ?? [],
    config: compileDetectionConfig(remote?.detection),
  };
}

type Fetched =
  | { ok: true; html: string; url: string }
  | { ok: false; reason: string };

async function fetchPage(url: string): Promise<Fetched> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "es-ES,es;q=0.9",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (cause) {
    return {
      ok: false,
      reason: `sin respuesta (${cause instanceof Error ? cause.message : String(cause)})`,
    };
  }
  const html = await response.text();
  if (
    [403, 429, 503].includes(response.status) ||
    /Just a moment|cf-browser-verification|challenge-platform/i.test(html)
  ) {
    return { ok: false, reason: `bloqueado (HTTP ${response.status})` };
  }
  if (!response.ok) {
    return { ok: false, reason: `HTTP ${response.status}` };
  }
  return { ok: true, html, url: response.url || url };
}

function parse(html: string, url: string): Document {
  const window = new Window({
    url,
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableIframePageLoading: true,
    },
  });
  // Cast justified: happy-dom's Document implements the DOM the detection
  // code reads; its own type is a separate declaration of the same API.
  return new window.DOMParser().parseFromString(
    html,
    "text/html",
  ) as unknown as Document;
}

function firstChapterLink(doc: Document, url: string): string | null {
  const host = new URL(url).hostname;
  for (const anchor of doc.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href");
    if (!href) {
      continue;
    }
    try {
      const target = new URL(href, url);
      if (target.hostname === host && CHAPTER_LINK.test(target.pathname)) {
        return target.href;
      }
    } catch {
      // Not a URL; next.
    }
  }
  return null;
}

async function check(
  entry: SiteEntry,
  context: Awaited<ReturnType<typeof loadContext>>,
): Promise<Row> {
  const site = new URL(entry.url).hostname.replace(/^www\./, "");
  const failed = (verdict: string, url = entry.url): Row => ({
    site,
    verdict,
    theme: "",
    name: "",
    chapter: "",
    confidence: "",
    series: "",
    url,
  });

  let page = await fetchPage(entry.url);
  if (!page.ok) {
    return failed(page.reason);
  }
  let doc = parse(page.html, page.url);
  const rule = ruleForHost(context.rules, site);
  const detectionContext: DetectionContext = {
    config: context.config,
    themes: context.themes,
    rule,
  };
  const selectors =
    rule?.titleSelector != null
      ? {
          titleSelector: rule.titleSelector,
          chapterSelector: rule.chapterSelector,
          chapterUrlRegex: rule.chapterUrlRegex,
        }
      : null;

  let reading = readPage(doc, page.url, selectors, detectionContext);
  if (
    !reading.detection.detected &&
    reading.detection.reason === "no-chapter-in-url"
  ) {
    const chapterUrl = firstChapterLink(doc, page.url);
    if (chapterUrl === null) {
      return failed("portada sin links a capítulos");
    }
    page = await fetchPage(chapterUrl);
    if (!page.ok) {
      return failed(page.reason, chapterUrl);
    }
    doc = parse(page.html, page.url);
    reading = readPage(doc, page.url, selectors, detectionContext);
  }

  const { detection } = reading;
  if (!detection.detected) {
    return {
      ...failed(detection.reason, page.url),
      theme: reading.theme ?? "",
    };
  }
  const ruled = rule === null ? null : seriesFromRule(rule, page.url);
  const series =
    ruled?.url ??
    reading.seriesLinkUrl ??
    seriesUrlFromChapterPath(page.url, context.config);
  const passes = detection.confidence >= thresholdFor(rule, context.config);
  return {
    site,
    verdict: passes ? "ok" : "bajo umbral",
    theme: reading.theme ?? "",
    name: detection.mangaName,
    chapter: detection.chapterLabel,
    confidence: detection.confidence.toFixed(2),
    series: series === null ? "—" : new URL(series).pathname,
    url: page.url,
  };
}

const listPath = fileURLToPath(new URL("./sites.json", import.meta.url));
const entries: SiteEntry[] =
  urls.length > 0
    ? urls.map((url) => ({ url }))
    : (JSON.parse(await readFile(listPath, "utf8")) as SiteEntry[]).filter(
        (entry) => only === null || entry.url.includes(only),
      );
const context = await loadContext();

console.log(
  `${entries.length} sitios · ${backend ? `backend ${backend}: ${context.rules.length} reglas, ${context.themes.length} temas` : "solo valores compilados"}\n`,
);

const rows: Row[] = [];
// Sequential and polite: one site at a time, a real browser's headers.
for (const entry of entries) {
  const row = await check(entry, context);
  rows.push(row);
  console.log(
    [
      row.verdict.padEnd(12),
      row.site.padEnd(30),
      row.theme.padEnd(14),
      `${row.name} · ${row.chapter}`.padEnd(60),
      row.confidence.padEnd(5),
      row.series,
    ].join(" "),
  );
  if (row.verdict !== "ok") {
    console.log(`${"".padEnd(13)}${row.url}`);
  }
}

const ok = rows.filter((row) => row.verdict === "ok").length;
console.log(`\n${ok}/${rows.length} detectados por encima del umbral.`);
