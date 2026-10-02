/**
 * What this browser remembers about how it tracks, set from the popup.
 *
 * Browser-local on purpose (`storage.local`, never the backend): pausing is
 * about this browser right now — someone lending their laptop, reading
 * something they would rather not keep — and has nothing to say to another
 * browser on the same machine, let alone to a synced library.
 */
import { storage } from "#imports";

/** While true, nothing is recorded anywhere; detection still runs and says so. */
export const pausedItem = storage.defineItem<boolean>("local:trackingPaused", {
  fallback: false,
});

/**
 * Whether a private window records readings. Off: "private" is what someone
 * means by opening one, and an extension allowed into incognito by a habit
 * click should not quietly undo it.
 */
export const recordIncognitoItem = storage.defineItem<boolean>(
  "local:recordIncognito",
  { fallback: false },
);

/** Notices the reader closed, by id, so the popup does not show them again. */
export const dismissedNoticesItem = storage.defineItem<string[]>(
  "local:dismissedNotices",
  { fallback: [] },
);

/** Why a reading was held back rather than recorded, or null to record it. */
export type HoldReason = "paused" | "incognito";

export async function holdReason(
  incognito: boolean,
): Promise<HoldReason | null> {
  if (await pausedItem.getValue()) {
    return "paused";
  }
  if (incognito && !(await recordIncognitoItem.getValue())) {
    return "incognito";
  }
  return null;
}

export async function dismissNotice(id: string): Promise<void> {
  const dismissed = await dismissedNoticesItem.getValue();
  if (!dismissed.includes(id)) {
    await dismissedNoticesItem.setValue([...dismissed, id]);
  }
}
