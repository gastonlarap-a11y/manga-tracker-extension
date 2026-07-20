import type {
  CreateAdapterBody,
  CreateEventBody,
  CreateEventResponse,
  HealthResponse,
  LibraryEntryDto,
  MangaDto,
  SiteAdapterDto,
} from "./types";

// Single place that knows where the backend lives (mirrors the API's rule
// that only config.ts reads the environment).
export const API_BASE_URL = "http://localhost:5150";

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
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, init);
  } catch (cause) {
    return {
      ok: false,
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
      ok: false,
      error: extractErrorMessage(body, response.status),
      status: response.status,
    };
  }
  // Cast justified: the API's OpenAPI schema is the contract and its types are
  // duplicated by hand in ./types.ts — this is the trust boundary with the
  // local backend.
  return { ok: true, data: body as T };
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
