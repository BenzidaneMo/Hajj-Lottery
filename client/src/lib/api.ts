const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:4000'

export class ApiError extends Error {
  readonly status: number
  /** Machine-readable code from the API, when it supplied one. */
  readonly code: string | undefined

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }

  /** No usable session — the caller should be sent back to sign in. */
  get isUnauthenticated(): boolean {
    return this.status === 401
  }

  /** Signed in, but not permitted. Re-authenticating would not help. */
  get isForbidden(): boolean {
    return this.status === 403
  }
}

type UnauthenticatedHandler = () => void

let onUnauthenticated: UnauthenticatedHandler | undefined

/**
 * Registered by AuthProvider so that a session expiring mid-visit is noticed
 * on the next request, rather than leaving the UI showing an admin shell the
 * server will refuse to serve.
 */
export function setUnauthenticatedHandler(handler: UnauthenticatedHandler | undefined): void {
  onUnauthenticated = handler
}

interface ApiErrorBody {
  error?: string
  code?: string
}

async function toApiError(response: Response, path: string): Promise<ApiError> {
  let body: ApiErrorBody = {}
  try {
    body = (await response.json()) as ApiErrorBody
  } catch {
    // A non-JSON error body (proxy error page, network appliance) is not
    // worth surfacing verbatim; fall back to the status.
  }
  return new ApiError(
    body.error ?? `Request to ${path} failed with status ${response.status}`,
    response.status,
    body.code,
  )
}

/**
 * `credentials: 'include'` is what carries the HttpOnly session cookie. The
 * token is never read by JavaScript and never stored in localStorage — the
 * browser attaches it, and only to the API origin.
 */
async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, { credentials: 'include', ...init })

  if (!response.ok) {
    const error = await toApiError(response, path)
    // `/api/auth/me` is how the provider *asks* whether a session exists, so
    // its 401 is an answer rather than an expiry.
    if (error.isUnauthenticated && path !== '/api/auth/me') onUnauthenticated?.()
    throw error
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export function apiGet<T>(path: string): Promise<T> {
  return apiRequest<T>(path)
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
