import type { BatchFreezeResultDto, BatchFreezeValidationDto } from '@hajj-lottery/shared'
import type { RequestHandler } from 'express'

import { BadRequestError } from '../lib/errors.js'
import { getAuthenticatedUser } from '../middleware/require-authenticated-user.js'
import { auditActor } from '../services/audit.service.js'
import { batchPoolFreezeService } from '../services/batch-pool-freeze.service.js'
import { batchExecuteSchema, batchValidateSchema } from '../validation/batch-draw-execution.js'

/**
 * Batch pool freezing, over HTTP. Both routes are SUPER_ADMIN-only, gated at
 * the route (see routes/admin.ts) — the same authority that freezes one
 * commune's pool, extended to freezing every ready one in a year. Reuses the
 * batch draw execution request schemas verbatim: `{ drawYearId }` and
 * `{ drawYearId, communeDrawIds }` are exactly the shapes this needs too.
 */

/** POST /api/admin/commune-draws/batch/freeze/validate — a preview, changes nothing. */
export const validateBatchPoolFreeze: RequestHandler = async (req, res) => {
  const parsed = batchValidateSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new BadRequestError(
      'VALIDATION_FAILED',
      'Please check the requested draw year',
      parsed.error.flatten().fieldErrors,
    )
  }

  const result: BatchFreezeValidationDto = await batchPoolFreezeService.validate(
    getAuthenticatedUser(req),
    parsed.data.drawYearId,
  )

  res.json(result)
}

/**
 * POST /api/admin/commune-draws/batch/freeze/execute
 *
 * Freezes exactly the commune draws named in the request — never a freshly
 * discovered set — one independent `freeze()` call at a time.
 */
export const freezeBatchPools: RequestHandler = async (req, res) => {
  const parsed = batchExecuteSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new BadRequestError(
      'VALIDATION_FAILED',
      'Please check the requested batch',
      parsed.error.flatten().fieldErrors,
    )
  }

  const user = getAuthenticatedUser(req)
  const result: BatchFreezeResultDto = await batchPoolFreezeService.freezeBatch(
    user,
    parsed.data.drawYearId,
    parsed.data.communeDrawIds,
    auditActor(user),
  )

  res.json(result)
}
