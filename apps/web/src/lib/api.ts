/**
 * Typed fetch client for the Aurial API.
 *
 * - Envelope-aware: success `{ data, meta? }`, error `{ error: { code, message, details? } }`.
 * - Auto `Authorization: Bearer <Firebase ID token>` (Firebase SDK caches tokens).
 * - Throws `ApiError { code, message, status, details }` on any failure,
 *   including network errors (status 0).
 */
import type { ApiErrorBody } from '@aurial/shared';
import { getIdToken } from '@/lib/firebase';

const BASE_URL = (import.meta.env.VITE_API_URL ?? '/api/v1').replace(/\/$/, '');

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** Unwrapped success envelope. */
export interface ApiResult<T, M = unknown> {
  data: T;
  meta?: M;
}

export type QueryValue = string | number | boolean | null | undefined;

/** `{ q: 'a b', limit: 10, cursor: undefined }` → `?q=a%20b&limit=10` */
export function buildQuery(params?: Record<string, QueryValue>): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
  signal?: AbortSignal;
  /** Skip the Authorization header (public endpoints). */
  anonymous?: boolean;
  headers?: Record<string, string>;
}

async function request<T, M = unknown>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  options: RequestOptions = {},
): Promise<ApiResult<T, M>> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  if (!options.anonymous) {
    try {
      const token = await getIdToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    } catch {
      // Token retrieval failure must not block public requests.
    }
  }

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}${buildQuery(options.query)}`, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError('NETWORK_ERROR', 'Não foi possível conectar ao servidor.', 0, cause);
  }

  if (response.status === 204) {
    return { data: undefined as T };
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON body — handled below by status check.
  }

  if (!response.ok) {
    const errorBody = payload as Partial<ApiErrorBody> | null;
    throw new ApiError(
      errorBody?.error?.code ?? 'UNKNOWN_ERROR',
      errorBody?.error?.message ?? `Erro inesperado (${response.status}).`,
      response.status,
      errorBody?.error?.details,
    );
  }

  const envelope = payload as { data?: T; meta?: M } | null;
  if (!envelope || !('data' in envelope)) {
    throw new ApiError('BAD_ENVELOPE', 'Resposta inesperada do servidor.', response.status);
  }
  return { data: envelope.data as T, meta: envelope.meta };
}

export const api = {
  get: <T, M = unknown>(path: string, options?: RequestOptions) =>
    request<T, M>('GET', path, options),
  post: <T, M = unknown>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T, M>('POST', path, { ...options, body }),
  patch: <T, M = unknown>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T, M>('PATCH', path, { ...options, body }),
  put: <T, M = unknown>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T, M>('PUT', path, { ...options, body }),
  del: <T = void, M = unknown>(path: string, options?: RequestOptions) =>
    request<T, M>('DELETE', path, options),
};

/** The origin the Aurial API is served from. */
export function apiOrigin(): string {
  try {
    return new URL(BASE_URL, window.location.origin).origin;
  } catch {
    return window.location.origin;
  }
}

/**
 * True when `url` targets our own API origin — the only place the Firebase ID
 * token may be sent. Third-party URLs (e.g. the Audius CDN) must never receive
 * it: doing so leaks the token AND triggers a CORS preflight they reject.
 */
export function isFirstPartyUrl(url: string): boolean {
  try {
    return new URL(url, window.location.origin).origin === apiOrigin();
  } catch {
    return false;
  }
}

/** Resolve a possibly-relative stream/media URL against the API origin. */
export function resolveMediaUrl(url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  try {
    return new URL(url, apiOrigin()).toString();
  } catch {
    return url;
  }
}
