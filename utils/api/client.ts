import type {
  CreateEventBody,
  CreateEventResponse,
  HealthResponse,
} from "./types";

// Single place that knows where the backend lives (mirrors the API's rule
// that only config.ts reads the environment).
export const API_BASE_URL = "http://localhost:5150";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

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
    return { ok: false, error: extractErrorMessage(body, response.status) };
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
