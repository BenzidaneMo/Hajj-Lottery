import type { DrawPoolSummaryDto, PoolEntryDto, PoolValidationDto } from '@hajj-lottery/shared'
import type { DrawPool } from '@prisma/client'
import type { RequestHandler } from 'express'

import { NotFoundError } from '../lib/errors.js'
import { getAuthenticatedUser } from '../middleware/require-authenticated-user.js'
import { auditActor } from '../services/audit.service.js'
import { authorizationService } from '../services/authorization.service.js'
import type { CommuneDrawWithPlace } from '../services/draw-configuration.service.js'
import { drawPoolService } from '../services/draw-pool.service.js'

/**
 * Draw pool inspection and freezing.
 *
 * Every route resolves the commune draw through the caller's own scope first,
 * so a pool in another territory is not found rather than refused — the same
 * answer an id that was never issued gets. Nothing here is public: a frozen
 * pool is the weighted input to a lottery, and publishing it would let anyone
 * work out who is likely to be selected.
 */

/**
 * Reaches the commune draw, or 404s.
 *
 * Doing this before anything else means the pool's existence is never
 * disclosed outside the caller's territory, including through the shape of an
 * error.
 */
async function scopedCommuneDraw(req: Parameters<RequestHandler>[0]): Promise<CommuneDrawWithPlace> {
  const communeDraw = await authorizationService.findCommuneDraw(
    getAuthenticatedUser(req),
    req.params.id ?? '',
  )
  if (!communeDraw) throw new NotFoundError('COMMUNE_DRAW_NOT_FOUND', 'Commune draw not found')

  return communeDraw
}

/**
 * POST /api/admin/commune-draws/:id/validate-pool
 *
 * A dry run. Reports everything blocking a freeze rather than only the first
 * problem, and changes nothing — despite being a POST, which it is because
 * reconciling every application is real work, not a cacheable read.
 *
 * Open to any administrator within scope: seeing why your own commune cannot
 * be frozen is not a privileged act.
 */
export const validatePool: RequestHandler = async (req, res) => {
  const communeDraw = await scopedCommuneDraw(req)
  const validation = await drawPoolService.validate(communeDraw.id)

  const body: PoolValidationDto = {
    ready: validation.ready,
    drawYear: communeDraw.drawYear.year,
    communeCode: communeDraw.commune.code,
    allocatedSpots: communeDraw.allocatedSpots,
    applicationCount: validation.entries.length,
    totalWeight: validation.totalWeight,
    blockers: validation.blockers,
    validatedAt: new Date().toISOString(),
  }

  res.json(body)
}

/**
 * POST /api/admin/commune-draws/:id/freeze-pool — SUPER_ADMIN only.
 *
 * The point of no return: the pool becomes permanent and the commune draw
 * locks, together or not at all. Restricted to national authority because it
 * fixes the terms of a lottery, and nobody should be able to close the input
 * to a draw they themselves are subject to.
 *
 * Returns the existing pool if one was already frozen, rather than failing —
 * a retried request should learn the outcome, not an error.
 */
export const freezePool: RequestHandler = async (req, res) => {
  const communeDraw = await scopedCommuneDraw(req)
  const result = await drawPoolService.freeze(communeDraw.id, auditActor(getAuthenticatedUser(req)))

  // `result.event` is the structured record a future audit log will persist:
  // who froze what, and the aggregates and hash that identify it. Nothing
  // writes it yet, and it is deliberately not logged — a pool's contents must
  // not reach any log, and a fabricated audit row would be worse than none.

  res.status(result.alreadyFrozen ? 200 : 201).json(toSummary(result.pool, communeDraw, result.alreadyFrozen))
}

/** GET /api/admin/commune-draws/:id/pool — the frozen entries. */
export const getPool: RequestHandler = async (req, res) => {
  const communeDraw = await scopedCommuneDraw(req)
  const pool = await drawPoolService.findPool(communeDraw.id)
  if (!pool) throw new NotFoundError('POOL_NOT_FOUND', 'This commune draw has no frozen pool')

  const entries: PoolEntryDto[] = pool.entries.map((entry) => ({
    applicationReference: entry.applicationReference,
    entryType: entry.entryType,
    weight: entry.weight,
  }))

  res.json({ summary: toSummary(pool, communeDraw, true), entries })
}

/** GET /api/admin/commune-draws/:id/pool/summary — aggregates and hash only. */
export const getPoolSummary: RequestHandler = async (req, res) => {
  const communeDraw = await scopedCommuneDraw(req)
  const pool = await drawPoolService.findPoolSummary(communeDraw.id)
  if (!pool) throw new NotFoundError('POOL_NOT_FOUND', 'This commune draw has no frozen pool')

  res.json(toSummary(pool, communeDraw, true))
}

function toSummary(
  pool: DrawPool,
  communeDraw: CommuneDrawWithPlace,
  alreadyFrozen: boolean,
): DrawPoolSummaryDto {
  return {
    id: pool.id,
    drawYear: communeDraw.drawYear.year,
    communeCode: communeDraw.commune.code,
    entryCount: pool.entryCount,
    totalWeight: pool.totalWeight,
    allocatedSpots: pool.allocatedSpots,
    snapshotHash: pool.snapshotHash,
    snapshotVersion: pool.snapshotVersion,
    frozenAt: pool.createdAt.toISOString(),
    alreadyFrozen,
  }
}
