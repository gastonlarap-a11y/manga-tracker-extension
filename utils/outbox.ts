/**
 * Readings the backend was not there to receive, kept until it is.
 *
 * The backend is a system service precisely so that tracking works with the
 * desktop app closed — but a service is not always listening. It is dark for
 * several seconds at every login while its launcher reads the keystore, and
 * again during every update, and a chapter read in that window used to be
 * dropped with nothing but a console line. Those are ordinary moments to be
 * reading in.
 *
 * Only readings that never reached a server are kept (`neverReachedServer`),
 * so sending one again cannot record it twice. One the backend answered — even
 * with an error — is an answer and is never retried, the same rule
 * `utils/api/client.ts` holds for its own retry. Replaying is safe on the other
 * side as well: the backend returns the stored event for a chapter it has.
 *
 * Drained oldest first, by an alarm while anything is waiting and whenever a
 * reading gets through again. Each one carries `readAt`, the moment it was
 * queued, so a chapter read during an outage is recorded at the time it was
 * read rather than when the backend came back. A backend older than that field
 * ignores it and stamps the arrival instead — draining in order still keeps the
 * order of what was read.
 */
import { browser, storage } from "#imports";
import {
  type ApiResult,
  createReadingEvent,
  neverReachedServer,
} from "./api/client";
import type { CreateEventBody, CreateEventResponse } from "./api/types";

const OUTBOX_KEY = "local:readingOutbox" as const;

/** The alarm that drains the queue while it holds anything. */
export const FLUSH_ALARM = "flush-reading-outbox";

/**
 * How many readings are kept. Bounded so a backend gone for good cannot grow
 * storage without end; a few hundred bytes each keeps this far below the
 * quota, and it is more chapters than anyone reads during an outage. Past it
 * the oldest go first: the newest readings are the ones that move a card.
 */
export const OUTBOX_LIMIT = 500;

export interface QueuedReading {
  readonly payload: CreateEventBody;
  /** When it was queued, ISO 8601. Identifies the entry; the API never sees it. */
  readonly queuedAt: string;
}

export interface FlushResult {
  readonly sent: number;
  /** Answered with an error by the backend: dropped, never retried. */
  readonly refused: number;
  readonly remaining: number;
}

export type SendReading = (
  payload: CreateEventBody,
) => Promise<ApiResult<CreateEventResponse>>;

// Every read-modify-write of the queue runs through this chain: neither WXT nor
// Chrome makes one atomic, and interleaving two would drop a reading. The
// service worker is the only writer, so an in-memory chain is enough. The
// chain itself never rejects — each caller still gets its own rejection.
let chain: Promise<unknown> = Promise.resolve();

function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const run = chain.then(operation);
  chain = run.catch(() => undefined);
  return run;
}

async function read(): Promise<QueuedReading[]> {
  return (await storage.getItem<QueuedReading[]>(OUTBOX_KEY)) ?? [];
}

/** What is waiting, oldest first. */
export function queuedReadings(): Promise<QueuedReading[]> {
  return read();
}

/**
 * Keeps a reading the backend could not be reached for, and makes sure
 * something will try again.
 */
export function enqueue(
  payload: CreateEventBody,
  now: Date = new Date(),
): Promise<void> {
  return serialized(async () => {
    // The same page reported again — a reload, a title that settled late —
    // replaces its earlier copy instead of queueing twice.
    const kept = (await read()).filter(
      (entry) => entry.payload.sourceUrl !== payload.sourceUrl,
    );
    kept.push({ payload, queuedAt: now.toISOString() });
    await storage.setItem(OUTBOX_KEY, kept.slice(-OUTBOX_LIMIT));
    // Created only when missing: re-creating resets the schedule, and a steady
    // stream of readings during an outage would keep pushing it back forever.
    if ((await browser.alarms.get(FLUSH_ALARM)) === undefined) {
      await browser.alarms.create(FLUSH_ALARM, { periodInMinutes: 1 });
    }
  });
}

let flushing: Promise<FlushResult> | null = null;

/**
 * Sends what is waiting, oldest first, until the queue is empty or the backend
 * turns out to be away still.
 *
 * One drain at a time: a call that arrives while one runs gets that one, so an
 * alarm firing next to a reading that got through does not send everything
 * twice.
 */
export function flushOutbox(
  send: SendReading = createReadingEvent,
): Promise<FlushResult> {
  if (flushing === null) {
    flushing = drain(send).finally(() => {
      flushing = null;
    });
  }
  return flushing;
}

async function drain(send: SendReading): Promise<FlushResult> {
  let sent = 0;
  let refused = 0;
  for (;;) {
    const [head] = await read();
    if (head === undefined) {
      await browser.alarms.clear(FLUSH_ALARM);
      return { sent, refused, remaining: 0 };
    }

    // Queued at the moment the reading failed to go out, which is when it was
    // read — so that is the time it is recorded with.
    const result = await send({ ...head.payload, readAt: head.queuedAt });
    if (neverReachedServer(result)) {
      // Still away. Everything stays, head included, for the next attempt.
      return { sent, refused, remaining: (await read()).length };
    }
    if (result.ok) {
      sent += 1;
    } else {
      refused += 1;
      console.warn(
        "[manga-tracker] the backend refused a queued reading; dropped",
        head.payload.sourceUrl,
        result.error,
      );
    }

    // By identity rather than position: the same page may have been queued
    // again while this one was in flight, and that newer copy has to stay.
    await serialized(async () => {
      const queue = await read();
      await storage.setItem(
        OUTBOX_KEY,
        queue.filter(
          (entry) =>
            entry.payload.sourceUrl !== head.payload.sourceUrl ||
            entry.queuedAt !== head.queuedAt,
        ),
      );
    });
  }
}
