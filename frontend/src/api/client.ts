/**
 * Same-origin REST client (port of web/viewer-api.js).
 *
 * - Every request has a timeout (default 20 s) combined with the caller's signal.
 * - Failures are classified into `ApiErrorKind`; the user-facing text comes from the
 *   i18n key in `error.messageKey`, never from server text (`error.detail` keeps the
 *   server message for classification/logging only).
 * - Nothing is retried automatically. In particular a POST that creates a simulation
 *   must never be repeated by this layer: the caller keeps a stable `request_id`.
 */
import type { TranslationKey, TranslationParams } from '../i18n';

export type ApiErrorKind =
  | 'timeout'
  | 'network'
  | 'invalid'
  | 'not-found'
  | 'conflict'
  | 'permission'
  | 'server'
  | 'validation';

/** An error whose user-facing text is an i18n key. Throw this from app code too. */
export class AppError extends Error {
  readonly messageKey: TranslationKey;
  readonly params?: TranslationParams;
  constructor(messageKey: TranslationKey, params?: TranslationParams) {
    super(messageKey);
    this.name = 'AppError';
    this.messageKey = messageKey;
    this.params = params;
  }
}

const KIND_KEYS: Record<ApiErrorKind, TranslationKey> = {
  timeout: 'errors.api.timeout',
  network: 'errors.api.network',
  invalid: 'errors.api.invalid',
  'not-found': 'errors.api.notFound',
  conflict: 'errors.api.conflict',
  permission: 'errors.api.permission',
  server: 'errors.api.server',
  validation: 'errors.api.validation',
};

export class ApiError extends AppError {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  /** Raw server message, for classification only. Do not render it. */
  detail = '';
  constructor(kind: ApiErrorKind, status?: number) {
    super(KIND_KEYS[kind]);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
  }
}

/** i18n key + params for any thrown value. */
export function errorMessage(error: unknown): { key: TranslationKey; params?: TranslationParams } {
  if (error instanceof AppError) return { key: error.messageKey, params: error.params };
  return { key: 'errors.unknown' };
}

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export interface RequestOptions extends RequestInit {
  timeoutMs?: number;
  responseType?: 'json' | 'text';
}

function classify(status: number): ApiErrorKind {
  if (status === 404) return 'not-found';
  if (status === 409) return 'conflict';
  if (status === 401 || status === 403) return 'permission';
  if (status >= 500) return 'server';
  return 'validation';
}

export async function request<T = unknown>(fetcher: Fetcher, url: string, options: RequestOptions = {}): Promise<T> {
  const { timeoutMs = 20000, responseType = 'json', ...init } = options;
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      signal,
      headers: { 'Content-Type': 'application/json', ...(init.headers as Record<string, string> | undefined) },
    });
  } catch {
    throw new ApiError(timeout.aborted ? 'timeout' : 'network');
  }
  let payload: unknown;
  try {
    payload = response.ok && responseType === 'text' ? await response.text() : await response.json();
  } catch {
    throw new ApiError('invalid', response.status);
  }
  if (!response.ok) {
    const raw = (payload as { message?: unknown } | null)?.message;
    const message = Array.isArray(raw) ? raw.join('; ') : raw;
    const error = new ApiError(classify(response.status), response.status);
    error.detail = typeof message === 'string' ? message : '';
    throw error;
  }
  return payload as T;
}

/** `api('/runs')` → GET `/api/runs` with the global fetch. */
export function api<T = unknown>(path: string, options?: RequestOptions): Promise<T> {
  return request<T>((input, init) => fetch(input, init), `/api${path}`, options);
}
