import { forgetBaseUrl, resolveBaseUrl } from "./discovery";
import type {
  CreateAdapterBody,
  CreateEventBody,
  CreateEventResponse,
  HealthResponse,
  LibraryEntryDto,
  MangaDto,
  SiteAdapterDto,
} from "./types";

// Where the backend lives is no longer a constant: an installed copy listens on
// whichever port was free on that machine. `discovery.ts` is the single place
// that knows how to find it.

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number };

export function pingHealth(): Promise<ApiResult<HealthResponse>> {
  return request<HealthResponse>("/health");
}

export function createReadingEvent(
  body: CreateEventBody,
): Promise<ApiResult<CreateEventResponse>> {
  return request<CreateEventResponse>("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function getLibrary(): Promise<ApiResult<LibraryEntryDto[]>> {
  return request<LibraryEntryDto[]>("/api/library");
}

// Used by the opportunistic cover capture on rendered series pages; only
// called for mangas that have no cover yet.
export function setMangaCover(
  mangaId: string,
  coverUrl: string,
): Promise<ApiResult<MangaDto>> {
  return request<MangaDto>(`/api/mangas/${encodeURIComponent(mangaId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ coverUrl }),
  });
}

// Cover bytes captured in the browser (the only client Cloudflare-walled
// CDNs admit); the backend stores them and serves /cover from local bytes.
export function uploadMangaCoverImage(
  mangaId: string,
  bytes: ArrayBuffer,
  contentType: string,
): Promise<ApiResult<MangaDto>> {
  return request<MangaDto>(
    `/api/mangas/${encodeURIComponent(mangaId)}/cover-image`,
    {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: bytes,
    },
  );
}

// Upsert by domain: recalibrating a site replaces its stored adapter.
export function createAdapter(
  body: CreateAdapterBody,
): Promise<ApiResult<SiteAdapterDto>> {
  return request<SiteAdapterDto>("/api/adapters", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// 404 means "no adapter calibrated yet" — a normal outcome, not a failure.
export async function getAdapter(
  domain: string,
): Promise<ApiResult<SiteAdapterDto | null>> {
  const result = await request<SiteAdapterDto>(
    `/api/adapters/${encodeURIComponent(domain)}`,
  );
  if (!result.ok && result.status === 404) {
    return { ok: true, data: null };
  }
  return result;
}

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  const baseUrl = await resolveBaseUrl();
  if (baseUrl === null) {
    return {
      ok: false,
      error: "No se encontró Manga Tracker en ningún puerto local (5150-5159).",
    };
  }

  const first = await send<T>(baseUrl, path, init);
  if (first.reached) {
    return first.result;
  }

  // Nothing reached the server — the fetch itself threw, so no request was
  // processed and repeating it cannot duplicate a reading event. The usual
  // cause is a backend that moved to another port after a reinstall, so drop
  // the cached URL and look again before giving up.
  await forgetBaseUrl();
  const rediscovered = await resolveBaseUrl();
  if (rediscovered === null || rediscovered === baseUrl) {
    return { ok: false, error: first.error };
  }
  const second = await send<T>(rediscovered, path, init);
  return second.reached ? second.result : { ok: false, error: second.error };
}

/**
 * The distinction the retry hangs on: `reached: false` means the request never
 * made it to a server, and is the only case where trying another port is safe.
 * An HTTP error is `reached: true` — the backend answered, and its answer is
 * the outcome, however bad.
 */
type Attempt<T> =
  | { readonly reached: true; readonly result: ApiResult<T> }
  | { readonly reached: false; readonly error: string };

async function send<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<Attempt<T>> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, init);
  } catch (cause) {
    return {
      reached: false,
      error: cause instanceof Error ? cause.message : "Network request failed",
    };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON body (empty response, proxy error page); handled below by status.
  }

  if (!response.ok) {
    return {
      reached: true,
      result: {
        ok: false,
        error: extractErrorMessage(body, response.status),
        status: response.status,
      },
    };
  }
  // Cast justified: the API's OpenAPI schema is the contract and its types are
  // duplicated by hand in ./types.ts — this is the trust boundary with the
  // local backend.
  return { reached: true, result: { ok: true, data: body as T } };
}

function extractErrorMessage(body: unknown, status: number): string {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "string"
  ) {
    return body.error;
  }
  return `HTTP ${status}`;
}
