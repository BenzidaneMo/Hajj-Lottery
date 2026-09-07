import { Prisma } from '@prisma/client'
import type { ErrorRequestHandler, RequestHandler } from 'express'

import { ApiError } from '../lib/errors.js'

/**
 * Express 4 does not catch rejections from async handlers — an unhandled one
 * leaves the request hanging until it times out. Wrap every async handler.
 */
export function asyncHandler(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(handler(req, res, next)).catch(next)
  }
}

/** 404 for any /api route that matched no handler. */
export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'Route not found', code: 'ROUTE_NOT_FOUND' })
}

/**
 * Single exit point for errors. Known `ApiError`s keep their status and code;
 * everything else becomes an opaque 500 so database internals and stack
 * traces stay server-side.
 */
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ApiError) {
    res.status(error.status).json({
      error: error.message,
      code: error.code,
      ...(error.details === undefined ? {} : { details: error.details }),
    })
    return
  }

  // Raised by express.json() before any handler runs, so it cannot be caught
  // where the route is defined.
  if (isBodyParserError(error)) {
    const tooLarge = error.type === 'entity.too.large'
    res.status(tooLarge ? 413 : 400).json({
      error: tooLarge ? 'Request body is too large' : 'Request body is not valid JSON',
      code: tooLarge ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION_FAILED',
    })
    return
  }

  // A unique constraint that slipped past the service layer's own check.
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    console.error('Unhandled unique constraint violation:', error.meta)
    res.status(409).json({ error: 'Resource already exists', code: 'INTERNAL_ERROR' })
    return
  }

  console.error('Unhandled error:', error)
  res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' })
}

interface BodyParserError extends Error {
  type: string
  status?: number
}

/**
 * body-parser tags its failures with a `type`. Detected structurally rather
 * than by message so the check does not depend on wording.
 */
function isBodyParserError(error: unknown): error is BodyParserError {
  return (
    error instanceof Error &&
    typeof (error as BodyParserError).type === 'string' &&
    (error as BodyParserError).type.startsWith('entity.')
  )
}
