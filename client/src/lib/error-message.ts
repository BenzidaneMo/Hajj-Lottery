import { ApiError } from './api'

/**
 * The translation key for a failed request.
 *
 * The server's own message is never shown. It is written for a developer, it is
 * not translated, and on a 500 it may describe the inside of the system — so the
 * status is mapped to one of a fixed set of sentences instead, and an
 * unrecognised failure falls back to the generic one rather than leaking
 * whatever came back.
 *
 * Separate from the component that renders it so a form can reuse the wording
 * inline, beside the field, instead of only in a banner.
 */
export function errorMessageKey(error: unknown): string {
  if (!(error instanceof ApiError)) return 'admin.errors.network'

  switch (error.status) {
    case 401:
      return 'admin.errors.unauthenticated'
    case 403:
      return 'admin.errors.forbidden'
    case 404:
      // Out of scope and never issued are the same answer by design, so the
      // wording has to cover both without implying which.
      return 'admin.errors.notFound'
    case 409:
      return 'admin.errors.conflict'
    case 422:
      return 'admin.errors.invalid'
    case 429:
      return 'admin.errors.rateLimited'
    default:
      return error.status >= 500 ? 'admin.errors.server' : 'admin.errors.request'
  }
}
