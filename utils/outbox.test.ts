import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import type { ApiResult } from "./api/client";
import type { CreateEventBody, CreateEventResponse } from "./api/types";
import {
  enqueue,
  FLUSH_ALARM,
  flushOutbox,
  OUTBOX_LIMIT,
  queuedReadings,
  type SendReading,
} from "./outbox";

function reading(chapter: number): CreateEventBody {
  return {
    mangaName: "One Piece",
    chapterLabel: `Cap. ${chapter}`,
    sourceUrl: `https://example.com/one-piece/capitulo/${chapter}`,
  };
}

const created = {
  ok: true,
  data: { manga: { id: "m1" }, event: { id: "e1" } },
} as unknown as ApiResult<CreateEventResponse>;

// What request() returns when no backend answered on any port: no status.
const away: ApiResult<CreateEventResponse> = {
  ok: false,
  error: "No se encontró Manga Tracker en ningún puerto local (5150-5159).",
};

beforeEach(() => {
  fakeBrowser.reset();
});

describe("enqueue", () => {
  it("keeps the reading and arms the alarm that will retry it", async () => {
    await enqueue(reading(1));

    expect((await queuedReadings()).map((entry) => entry.payload)).toEqual([
      reading(1),
    ]);
    expect(await fakeBrowser.alarms.get(FLUSH_ALARM)).toBeDefined();
  });

  it("keeps one copy of a page reported twice", async () => {
    // A reload, or a title that settled late, reports the same page again.
    await enqueue(reading(1), new Date("2026-09-30T10:00:00Z"));
    await enqueue(reading(1), new Date("2026-09-30T10:01:00Z"));

    const queue = await queuedReadings();
    expect(queue).toHaveLength(1);
    expect(queue[0]?.queuedAt).toBe("2026-09-30T10:01:00.000Z");
  });

  it("keeps both of two readings queued at the same moment", async () => {
    // Two tabs whose detections land together: interleaved read-modify-writes
    // would keep only one of them.
    await Promise.all([enqueue(reading(1)), enqueue(reading(2))]);

    expect(await queuedReadings()).toHaveLength(2);
  });

  it("drops the oldest once the queue is full, never the newest", async () => {
    for (let chapter = 1; chapter <= OUTBOX_LIMIT + 1; chapter += 1) {
      await enqueue(reading(chapter));
    }

    const queue = await queuedReadings();
    expect(queue).toHaveLength(OUTBOX_LIMIT);
    expect(queue[0]?.payload).toEqual(reading(2));
    expect(queue.at(-1)?.payload).toEqual(reading(OUTBOX_LIMIT + 1));
  });
});

describe("flushOutbox", () => {
  it("sends everything oldest first and disarms the alarm", async () => {
    await enqueue(reading(1));
    await enqueue(reading(2));
    const send = vi.fn<SendReading>().mockResolvedValue(created);

    const result = await flushOutbox(send);

    expect(
      send.mock.calls.map(([{ readAt: _readAt, ...payload }]) => payload),
    ).toEqual([reading(1), reading(2)]);
    expect(result).toEqual({ sent: 2, refused: 0, remaining: 0 });
    expect(await queuedReadings()).toEqual([]);
    expect(await fakeBrowser.alarms.get(FLUSH_ALARM)).toBeUndefined();
  });

  it("sends each reading with the time it was read, not the time it arrives", async () => {
    // Queued the moment it failed to go out, which is when it was read. A
    // backend that only learned the time on arrival would sort an outage's
    // chapters above everything read after it.
    await enqueue(reading(1), new Date("2026-09-30T08:15:00Z"));
    const send = vi.fn<SendReading>().mockResolvedValue(created);

    await flushOutbox(send);

    expect(send.mock.calls[0]?.[0].readAt).toBe("2026-09-30T08:15:00.000Z");
  });

  it("stops at the first reading that still cannot get through", async () => {
    await enqueue(reading(1));
    await enqueue(reading(2));
    const send = vi.fn<SendReading>().mockResolvedValue(away);

    const result = await flushOutbox(send);

    expect(send).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ sent: 0, refused: 0, remaining: 2 });
    expect(await fakeBrowser.alarms.get(FLUSH_ALARM)).toBeDefined();
  });

  it("drops a reading the backend answered with an error, and moves on", async () => {
    // An answer is never retried: it would be refused the same way forever,
    // and hold every reading behind it hostage.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await enqueue(reading(1));
    await enqueue(reading(2));
    const send = vi
      .fn<SendReading>()
      .mockResolvedValueOnce({ ok: false, error: "invalid", status: 400 })
      .mockResolvedValueOnce(created);

    const result = await flushOutbox(send);

    expect(result).toEqual({ sent: 1, refused: 1, remaining: 0 });
    expect(await queuedReadings()).toEqual([]);
  });

  it("runs one drain at a time", async () => {
    // The alarm and a reading that got through can ask at the same moment;
    // sending the queue twice would be harmless to the backend and noisy here.
    await enqueue(reading(1));
    const send = vi.fn<SendReading>().mockResolvedValue(created);

    await Promise.all([flushOutbox(send), flushOutbox(send)]);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it("keeps a copy of the page queued again while the first was in flight", async () => {
    await enqueue(reading(1), new Date("2026-09-30T10:00:00Z"));
    const send = vi.fn<SendReading>().mockImplementationOnce(async () => {
      await enqueue(reading(1), new Date("2026-09-30T10:05:00Z"));
      return away;
    });

    await flushOutbox(send);

    const queue = await queuedReadings();
    expect(queue.map((entry) => entry.queuedAt)).toEqual([
      "2026-09-30T10:05:00.000Z",
    ]);
  });
});
