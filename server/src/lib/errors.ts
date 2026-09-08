/**
 * API error vocabulary. Handlers throw these; the error middleware turns them
 * into the single response shape `{ error, code, details? }`. Nothing that
 * reveals the database or the stack ever reaches the client.
 */

export type ApiErrorCode =
  | 'VALIDATION_FAILED'
  | 'INVALID_NATIONAL_ID'
  | 'DUPLICATE_NATIONAL_ID'
  | 'PARTICIPANT_NOT_FOUND'
  | 'USER_NOT_FOUND'
  | 'WILAYA_NOT_FOUND'
  | 'COMMUNE_NOT_FOUND'
  | 'APPLICATION_NOT_FOUND'
  | 'HISTORY_NOT_FOUND'
  | 'DUPLICATE_HISTORY_YEAR'
  | 'INVALID_DRAW_YEAR'
  | 'APPLICATION_INELIGIBLE'
  | 'DRAW_YEAR_NOT_FOUND'
  | 'COMMUNE_DRAW_NOT_FOUND'
  | 'DUPLICATE_DRAW_YEAR'
  | 'DUPLICATE_COMMUNE_DRAW'
  | 'REGISTRATION_ALREADY_OPEN'
  | 'INVALID_STATUS_TRANSITION'
  | 'DRAW_CONFIGURATION_LOCKED'
  | 'COMMUNE_DRAW_NOT_CONFIGURED'
  | 'POOL_NOT_READY'
  | 'POOL_NOT_FOUND'
  | 'DRAW_NOT_LOCKED'
  | 'INSUFFICIENT_DRAW_ENTRIES'
  | 'INVALID_POOL_SNAPSHOT'
  | 'ROUTE_NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN_ROLE'
  | 'FORBIDDEN_SCOPE'
  | 'INVALID_SCOPE_ASSIGNMENT'
  | 'LAST_SUPER_ADMIN'
  | 'FORBIDDEN_ORIGIN'
  | 'TOO_MANY_ATTEMPTS'
  | 'INVALID_COMMUNE'
  | 'ALREADY_APPLIED'
  | 'APPLICANT_NOT_ELIGIBLE'
  | 'REGISTRATION_CLOSED'
  | 'PAYLOAD_TOO_LARGE'
  | 'NOT_CONFIGURED'
  | 'INTERNAL_ERROR'

export class ApiError extends Error {
  readonly status: number
  readonly code: ApiErrorCode
  readonly details: unknown

  constructor(status: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

/** 400 — the request body/params did not satisfy the schema. */
export class BadRequestError extends ApiError {
  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(400, code, message, details)
    this.name = 'BadRequestError'
  }
}

/** 401 — caller did not present valid credentials for a protected route. */
export class UnauthorizedError extends ApiError {
  constructor(message = 'Unauthorized') {
    super(401, 'UNAUTHORIZED', message)
    this.name = 'UnauthorizedError'
  }
}

/**
 * 403 — the caller is authenticated but not permitted.
 *
 * Used for role failures, where the endpoint's existence is not a secret and
 * the caller already knows their own role. Resources outside an
 * administrator's *geographic* scope return 404 instead, so that out-of-scope
 * and nonexistent are indistinguishable — see docs/authorization.md.
 */
export class ForbiddenError extends ApiError {
  constructor(code: ApiErrorCode, message: string) {
    super(403, code, message)
    this.name = 'ForbiddenError'
  }
}

/** 404 — the addressed resource does not exist. */
export class NotFoundError extends ApiError {
  constructor(code: ApiErrorCode, message: string) {
    super(404, code, message)
    this.name = 'NotFoundError'
  }
}

/** 409 — the request conflicts with a record that already exists. */
export class ConflictError extends ApiError {
  constructor(code: ApiErrorCode, message: string) {
    super(409, code, message)
    this.name = 'ConflictError'
  }
}

/** 503 — the route is unavailable because the server is missing config. */
export class NotConfiguredError extends ApiError {
  constructor(message: string) {
    super(503, 'NOT_CONFIGURED', message)
    this.name = 'NotConfiguredError'
  }
}
