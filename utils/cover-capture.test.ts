import { describe, expect, it } from "vitest";
import {
  decodeBase64ToBytes,
  encodeBytesToBase64,
  fetchCoverImageBytes,
  MAX_COVER_IMAGE_BYTES,
} from "./cover-capture";

const COVER_URL = "https://zai.manhwa-latino.com/wp-content/uploads/thumb.webp";

function buffer(...values: number[]): ArrayBuffer {
  const body = new ArrayBuffer(values.length);
  new Uint8Array(body).set(values);
  return body;
}

function imageResponse(
  bytes: ArrayBuffer,
  contentType = "image/webp",
): Response {
  return new Response(bytes, {
    status: 200,
    headers: { "content-type": contentType },
  });
}

describe("fetchCoverImageBytes", () => {
  it("returns the bytes and content type, fetching with credentials", async () => {
    const body = buffer(1, 2, 3);
    const calls: {
      url: string;
      credentials: RequestCredentials | undefined;
    }[] = [];
    const fetchFn = async (url: string, init?: RequestInit) => {
      calls.push({ url, credentials: init?.credentials });
      return imageResponse(body);
    };

    const image = await fetchCoverImageBytes(COVER_URL, fetchFn);

    expect(calls).toEqual([{ url: COVER_URL, credentials: "include" }]);
    expect(image?.contentType).toBe("image/webp");
    expect(new Uint8Array(image?.bytes ?? new ArrayBuffer(0))).toEqual(
      new Uint8Array(body),
    );
  });

  it("returns null on a non-2xx response", async () => {
    const fetchFn = async () => new Response("blocked", { status: 403 });

    expect(await fetchCoverImageBytes(COVER_URL, fetchFn)).toBeNull();
  });

  it("returns null when the body is not an image", async () => {
    const fetchFn = async () =>
      new Response("<html>Just a moment...</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });

    expect(await fetchCoverImageBytes(COVER_URL, fetchFn)).toBeNull();
  });

  it("returns null for an empty or oversized body", async () => {
    const empty = async () => imageResponse(new ArrayBuffer(0));
    expect(await fetchCoverImageBytes(COVER_URL, empty)).toBeNull();

    const oversized = async () =>
      imageResponse(new ArrayBuffer(MAX_COVER_IMAGE_BYTES + 1));
    expect(await fetchCoverImageBytes(COVER_URL, oversized)).toBeNull();
  });

  it("returns null when the fetch itself throws", async () => {
    const fetchFn = async (): Promise<Response> => {
      throw new Error("no host permission");
    };

    expect(await fetchCoverImageBytes(COVER_URL, fetchFn)).toBeNull();
  });

  it("passes the requested credentials mode through", async () => {
    const modes: (RequestCredentials | undefined)[] = [];
    const fetchFn = async (_url: string, init?: RequestInit) => {
      modes.push(init?.credentials);
      return imageResponse(buffer(1));
    };

    await fetchCoverImageBytes(COVER_URL, fetchFn, "omit");

    expect(modes).toEqual(["omit"]);
  });
});

describe("base64 round-trip", () => {
  it("encodes and decodes bytes losslessly", () => {
    const original = buffer(0, 1, 127, 128, 255, 66);

    const decoded = decodeBase64ToBytes(encodeBytesToBase64(original));

    expect(decoded).not.toBeNull();
    expect(new Uint8Array(decoded ?? new ArrayBuffer(0))).toEqual(
      new Uint8Array(original),
    );
  });

  it("returns null for a string that is not base64", () => {
    expect(decodeBase64ToBytes("no-es-base64!!")).toBeNull();
  });
});
