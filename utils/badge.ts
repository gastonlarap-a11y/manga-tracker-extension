/**
 * The toolbar icon's badge: what happened on this tab, readable without
 * opening the popup. A reader who finishes a chapter wants one glance —
 * saved, waiting, or not — and the popup was the only place that said.
 *
 * `action.setBadgeText` and friends need no permission, which is why this
 * costs the extension nothing at review.
 */
import { browser } from "#imports";
import type { DetectionEntry } from "./detection-log";

export interface Badge {
  text: string;
  /** Background colour; ignored when the text is empty. */
  color: string;
  /** The icon's tooltip. */
  title: string;
}

const NAME = "Manga Tracker";

// The dashboard's palette in sRGB: badge colours take no oklch.
const GOOD = "#2f9e6b";
const WARM = "#c98a1b";
const ACCENT = "#7c6cf0";
const BAD = "#d1495b";
const QUIET = "#6b6f80";

const NOTHING: Badge = { text: "", color: QUIET, title: NAME };

/** The badge for a tab, from its last detection and the global pause. */
export function badgeFor(entry: DetectionEntry | null, paused: boolean): Badge {
  if (entry === null) {
    return paused ? pausedBadge() : NOTHING;
  }
  const { detection, delivery } = entry;
  if (!detection.detected) {
    return paused ? pausedBadge() : NOTHING;
  }
  const what = `${detection.mangaName} · ${detection.chapterLabel}`;
  switch (delivery?.status) {
    case undefined:
      return { text: "…", color: ACCENT, title: `${NAME} — guardando ${what}` };
    case "sent":
      return { text: "✓", color: GOOD, title: `${NAME} — guardado: ${what}` };
    case "queued":
      return {
        text: "↑",
        color: WARM,
        title: `${NAME} — ${what} queda en espera hasta que vuelva la app`,
      };
    case "waiting":
      return {
        text: "…",
        color: ACCENT,
        title: `${NAME} — se guarda cuando termines de leer ${what}`,
      };
    case "below-threshold":
      return {
        text: "?",
        color: QUIET,
        title: `${NAME} — no estoy seguro de ${what}; calibrá el sitio`,
      };
    case "held":
      return delivery.reason === "paused"
        ? pausedBadge()
        : {
            text: "",
            color: QUIET,
            title: `${NAME} — ventana privada: no se guarda nada`,
          };
    case "failed":
      return {
        text: "!",
        color: BAD,
        title: `${NAME} — no se pudo guardar ${what}`,
      };
  }
}

function pausedBadge(): Badge {
  return { text: "‖", color: QUIET, title: `${NAME} — en pausa` };
}

/**
 * Paints a tab's badge. A tab that closed in the meantime makes these calls
 * reject; there is nothing to paint then, so that is not an error.
 */
export async function paintBadge(tabId: number, badge: Badge): Promise<void> {
  try {
    await browser.action.setBadgeText({ tabId, text: badge.text });
    if (badge.text) {
      await browser.action.setBadgeBackgroundColor({
        tabId,
        color: badge.color,
      });
    }
    await browser.action.setTitle({ tabId, title: badge.title });
  } catch {
    // The tab is gone.
  }
}

/** The badge every tab shows unless its own says otherwise. */
export async function paintGlobalBadge(paused: boolean): Promise<void> {
  const badge = paused ? pausedBadge() : NOTHING;
  await browser.action.setBadgeText({ text: badge.text });
  await browser.action.setBadgeBackgroundColor({ color: badge.color });
  await browser.action.setTitle({ title: badge.title });
}
