/**
 * What the popup says, decided without rendering anything: every sentence a
 * reader sees about a page, and the small derivations the popup needs. Kept
 * apart from the components so it is tested as plain functions.
 */
import {
  cleanMangaName,
  type Detection,
  extractChapterFromTitle,
} from "./detection/heuristics";
import type { DeliveryStatus, DetectionEntry } from "./detection-log";

export type Tone = "good" | "accent" | "warm" | "bad" | "quiet";

export interface Verdict {
  tone: Tone;
  /** One short line, under the manga's name. */
  headline: string;
  /** What to do about it, when there is something to do. */
  hint: string | null;
}

/** What became of a page the detector recognised. */
export function verdictFor(entry: DetectionEntry): Verdict {
  const { detection } = entry;
  if (!detection.detected) {
    return missVerdict(detection.reason);
  }
  return deliveryVerdict(entry.delivery);
}

function deliveryVerdict(delivery: DeliveryStatus | undefined): Verdict {
  switch (delivery?.status) {
    case undefined:
      return { tone: "accent", headline: "Guardando…", hint: null };
    case "sent":
      return { tone: "good", headline: "Guardado", hint: null };
    case "queued":
      return {
        tone: "warm",
        headline: "En espera",
        hint: "Manga Tracker no respondió. Queda guardado acá y se envía solo cuando vuelva.",
      };
    case "failed":
      return {
        tone: "bad",
        headline: "No se pudo guardar",
        hint: delivery.error,
      };
    case "below-threshold":
      return {
        tone: "quiet",
        headline: "No estoy seguro de que sea un capítulo",
        hint: "Si lo es, guardalo a mano o calibrá el sitio para la próxima.",
      };
    case "waiting":
      return {
        tone: "accent",
        headline: "Se guarda cuando lo termines",
        hint: readingHint(delivery.minSeconds, delivery.minScrollPercent),
      };
    case "held":
      return delivery.reason === "paused"
        ? {
            tone: "quiet",
            headline: "En pausa: no se guardó",
            hint: "Reanudá el tracking para que vuelva a guardar.",
          }
        : {
            tone: "quiet",
            headline: "Ventana privada: no se guarda",
            hint: "Se puede cambiar en Ajustes.",
          };
  }
}

function readingHint(minSeconds: number, minScrollPercent: number): string {
  const parts: string[] = [];
  if (minSeconds > 0) {
    parts.push(`${minSeconds} s en la página`);
  }
  if (minScrollPercent > 0) {
    parts.push(`bajar hasta el ${minScrollPercent} %`);
  }
  return `Lectura real: ${parts.join(" y ")}.`;
}

function missVerdict(
  reason: Extract<Detection, { detected: false }>["reason"],
): Verdict {
  switch (reason) {
    case "no-chapter-in-url":
      return {
        tone: "quiet",
        headline: "Esta página no parece un capítulo",
        hint: "Las portadas y los catálogos no se guardan.",
      };
    case "ignored-path":
      return {
        tone: "quiet",
        headline: "Esta página no se guarda",
        hint: "El sitio la usa para listar capítulos, no para leerlos.",
      };
    case "no-chapter-in-title":
      return {
        tone: "warm",
        headline: "No encuentro el número de capítulo",
        hint: "Guardalo a mano, o calibrá el sitio para que lo aprenda.",
      };
    case "no-title":
      return {
        tone: "warm",
        headline: "No encuentro el nombre del manga",
        hint: "Guardalo a mano, o calibrá el sitio para que lo aprenda.",
      };
  }
}

export interface TrackedSite {
  /** The base domain, as the person granted it. */
  host: string;
  /** Every granted pattern for it: both schemes, and a legacy exact one. */
  patterns: string[];
}

/**
 * The sites this extension may run on, from `permissions.getAll()`. The
 * backend's own localhost ports are permissions too, and are not sites.
 */
export function trackedSites(origins: readonly string[]): TrackedSite[] {
  const byHost = new Map<string, string[]>();
  for (const origin of origins) {
    const match = /^https?:\/\/(?:\*\.)?([^/:*]+)(?::\d+)?\/\*$/.exec(origin);
    const host = match?.[1]?.replace(/^www\./, "");
    if (!host || host === "localhost" || host === "127.0.0.1") {
      continue;
    }
    byHost.set(host, [...(byHost.get(host) ?? []), origin]);
  }
  return [...byHost.entries()]
    .map(([host, patterns]) => ({ host, patterns }))
    .sort((a, b) => a.host.localeCompare(b.host));
}

/** The backend-served cover, cache-busted on every change to it. */
export function coverSrc(
  baseUrl: string,
  mangaId: string,
  coverVersion: number,
): string {
  return `${baseUrl}/api/mangas/${encodeURIComponent(mangaId)}/cover?v=${coverVersion}`;
}

/** The dashboard's page for one manga. */
export function mangaPageUrl(baseUrl: string, mangaId: string): string {
  return `${baseUrl}/manga/${encodeURIComponent(mangaId)}`;
}

/**
 * What the manual form starts from: the detection when there is one, else
 * the best the tab's title gives — a draft to correct, not an answer.
 */
export function manualDraftFrom(
  entry: DetectionEntry | null,
  tabTitle: string,
): { mangaName: string; chapterLabel: string } {
  if (entry?.detection.detected) {
    return {
      mangaName: entry.detection.mangaName,
      chapterLabel: entry.detection.chapterLabel,
    };
  }
  const title = tabTitle.trim();
  const chapter = extractChapterFromTitle(title);
  if (chapter === null) {
    return {
      mangaName: title.split(/\s[|–—-]\s/)[0]?.trim() ?? "",
      chapterLabel: "",
    };
  }
  return {
    mangaName: cleanMangaName(title, chapter, null),
    chapterLabel: `Cap. ${chapter}`,
  };
}
