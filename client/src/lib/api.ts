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
  if (!response.ok) throw await toApiError(response, path)
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
