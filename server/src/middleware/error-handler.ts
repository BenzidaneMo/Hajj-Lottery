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

  // A unique constraint that slipped past the service layer's own check.
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    console.error('Unhandled unique constraint violation:', error.meta)
    res.status(409).json({ error: 'Resource already exists', code: 'INTERNAL_ERROR' })
    return
  }

  console.error('Unhandled error:', error)
  res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' })
}
