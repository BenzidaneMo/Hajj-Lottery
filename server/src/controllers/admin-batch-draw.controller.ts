import type { BatchExecutionResultDto, BatchValidationDto } from '@hajj-lottery/shared'
import type { RequestHandler } from 'express'

import { BadRequestError } from '../lib/errors.js'
import { getAuthenticatedUser } from '../middleware/require-authenticated-user.js'
import { auditActor } from '../services/audit.service.js'
import { batchDrawExecutionService } from '../services/batch-draw-execution.service.js'
import { batchExecuteSchema, batchValidateSchema } from '../validation/batch-draw-execution.js'

/**
 * Batch draw execution, over HTTP. Both routes are SUPER_ADMIN-only, gated
 * at the route (see routes/admin.ts) — the same authority that runs one
 * commune's draw, extended to running every ready one in a year.
 */

/** POST /api/admin/commune-draws/batch/validate — a preview, changes nothing. */
export const validateBatchDraw: RequestHandler = async (req, res) => {
  const parsed = batchValidateSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new BadRequestError(
      'VALIDATION_FAILED',
      'Please check the requested draw year',
      parsed.error.flatten().fieldErrors,
    )
  }

  const result: BatchValidationDto = await batchDrawExecutionService.validate(
    getAuthenticatedUser(req),
    parsed.data.drawYearId,
  )

  res.json(result)
}

/**
 * POST /api/admin/commune-draws/batch/execute
 *
 * Runs exactly the commune draws named in the request — never a freshly
 * discovered set — one independent `execute()` call at a time.
 */
export const executeBatchDraw: RequestHandler = async (req, res) => {
  const parsed = batchExecuteSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new BadRequestError(
      'VALIDATION_FAILED',
      'Please check the requested batch',
      parsed.error.flatten().fieldErrors,
    )
  }

  const user = getAuthenticatedUser(req)
  const result: BatchExecutionResultDto = await batchDrawExecutionService.executeBatch(
    user,
    parsed.data.drawYearId,
    parsed.data.communeDrawIds,
    auditActor(user),
  )

  res.json(result)
}
