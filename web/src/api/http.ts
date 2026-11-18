import { t, errorText } from '../i18n/runtime.ts'
export class ApiError extends Error {
  status: number
  code: string
  retryAfter?: number

  constructor(status: number, code: string, message: string, retryAfter?: number) {
    super(message)
    this.status = status
    this.code = code
    this.retryAfter = retryAfter
  }
}

const BASE = '/api'

/** Turns any failed response into an ApiError using the backend's `{ error: { code, message } }` envelope. */
export async function toApiError(res: Response): Promise<ApiError> {
  let code = 'http_' + res.status
  let message = t("Request failed ({0})", res.status)
  let retryAfter: number | undefined
  try {
    const body = await res.json()
    if (body?.error) {
      code = body.error.code ?? code
      message = body.error.message ?? message
      retryAfter = body.error.retryAfter
    }
  } catch {
    /* non-JSON body */
  }
  const fallback = res.status === 401 ? 'Your session expired. Please sign in again.' : res.status === 429 ? 'Too many requests, slow down' : res.status >= 500 ? 'The service is temporarily unavailable. Please try again later.' : 'Invalid request. Please check your input.'
  return new ApiError(res.status, code, errorText(message, fallback), retryAfter)
}

/**
 * Same-origin JSON request (cookie session). A 2xx that is not JSON means no backend is behind `/api`
 * (e.g. a dev server falling back to index.html), which is reported as a `network` error.
 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && typeof init.body === 'string' && !headers.has('content-type')) headers.set('content-type', 'application/json')
  let res: Response
  try {
    res = await fetch(BASE + path, { credentials: 'include', ...init, headers })
  } catch (err) {
    throw new ApiError(0, 'network', err instanceof Error ? errorText(err.message, 'Network error') : t('Network error'))
  }
  if (!res.ok) throw await toApiError(res)
  if (res.status === 204) return undefined as T
  if (!(res.headers.get('content-type') ?? '').includes('json')) throw new ApiError(0, 'network', t("Backend not reachable"))
  return (await res.json()) as T
}

export const jsonBody = (v: unknown) => JSON.stringify(v)

/** keepalive requests share a ~64 KB in-flight body budget per document; stay clearly below it */
export const KEEPALIVE_BUDGET = 56 * 1024

const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null
export const bodyBytes = (s: string) => (encoder ? encoder.encode(s).length : s.length * 3)

const keepaliveOk = typeof Request !== 'undefined' && 'keepalive' in Request.prototype

/**
 * Fire-and-forget write that the browser keeps alive while the page unloads (reload / tab close / navigation).
 * `fetch(..., { keepalive: true })` supports every method the API uses; `navigator.sendBeacon` is POST-only, so it is only
 * the fallback for creates on browsers without keepalive. Both are same-origin, carry the session cookie and the same-origin
 * `Origin` header the Worker's CSRF check requires. Returns false when nothing could be sent.
 */
export function sendKeepalive(method: string, path: string, body?: string): boolean {
  const url = BASE + path
  if (keepaliveOk) {
    try {
      void fetch(url, {
        method,
        credentials: 'include',
        keepalive: true,
        headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
        body,
      }).catch(() => undefined)
      return true
    } catch {
      return false
    }
  }
  if (method === 'POST' && body !== undefined && typeof navigator !== 'undefined' && navigator.sendBeacon) {
    return navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))
  }
  return false
}
