import type {
  BatchCandidateDto,
  BatchFreezeNotReadyCandidateDto,
  BatchFreezeOutcomeDto,
  BatchFreezeResultDto,
  BatchFreezeValidationDto,
} from '@hajj-lottery/shared'
import type { Commune, CommuneDraw, DrawPool, PrismaClient, User, Wilaya } from '@prisma/client'

import { ApiError } from '../lib/errors.js'
import { prisma as defaultPrisma } from '../lib/prisma.js'
import { communeScopeFilter } from '../lib/scope.js'
import { auditService, AuditService, type AuditActor } from './audit.service.js'
import { authorizationService, AuthorizationService } from './authorization.service.js'
import { drawPoolService, DrawPoolService, isResolvableByFreezing } from './draw-pool.service.js'

/**
 * Batch pool freezing: freezing every freezable commune's draw pool for one
 * year in one operator action.
 *
 * Orchestration only, exactly like `BatchDrawExecutionService` beside it.
 * `DrawPoolService.freeze` remains the one thing that freezes a pool, called
 * here once per commune, each call its own independent attempt — never one
 * shared transaction across communes, so one commune's blocker cannot affect
 * another's already-frozen pool. Nothing here recomputes a weight, evaluates
 * eligibility itself, or decides which applications enter a pool; those are
 * settled by `DrawPoolService.validate`, called once per candidate.
 */

type CommuneDrawCandidate = CommuneDraw & {
  commune: Commune & { wilaya: Wilaya }
  pool: DrawPool | null
}

export class BatchPoolFreezeService {
  private readonly db: PrismaClient
  private readonly authorization: AuthorizationService
  private readonly pool: DrawPoolService
  private readonly audit: AuditService

  /**
   * Communes currently mid-freeze in *this* process. A UX short-circuit for
   * an obvious double click — the real safety guarantee is unchanged: the
   * unique constraint on `draw_pools.commune_draw_id`, which is what actually
   * serializes concurrent freezes (including from a second process, which
   * this set knows nothing about).
   */
  private readonly inFlight = new Set<string>()

  constructor(
    db: PrismaClient = defaultPrisma,
    authorization: AuthorizationService = authorizationService,
    pool: DrawPoolService = drawPoolService,
    audit: AuditService = auditService,
  ) {
    this.db = db
    this.authorization = authorization
    this.pool = pool
    this.audit = audit
  }

  /**
   * Discovers which commune draws in one year can freeze right now.
   *
   * Unlike batch execution's coarse, cheap preview, there is no cheap proxy
   * here: whether a commune can freeze depends on every candidate
   * application's current weight and eligibility, so this calls
   * `DrawPoolService.validate` once per commune without a pool — the same
   * check the single-commune Validate button runs. A commune reported ready
   * here can still fail to freeze if something changed in between; this is a
   * preview, not a lock.
   *
   * A commune blocked only by `MISSING_WEIGHT` is reported `ready`, not
   * `notReady` — `freeze()` resolves that blocker itself (see
   * `isResolvableByFreezing`), so reporting it as blocked would understate
   * what a batch freeze can actually do.
   */
  async validate(user: User, drawYearId: string): Promise<BatchFreezeValidationDto> {
    const candidates = await this.candidatesForYear(user, drawYearId)

    const ready: BatchCandidateDto[] = []
    const notReady: BatchFreezeNotReadyCandidateDto[] = []
    const alreadyFrozen: BatchCandidateDto[] = []

    for (const draw of candidates) {
      const candidate = toCandidateDto(draw)

      if (draw.pool) {
        alreadyFrozen.push(candidate)
        continue
      }

      const validation = await this.pool.validate(draw.id)
      if (validation.ready || isResolvableByFreezing(validation.blockers)) {
        ready.push(candidate)
      } else {
        const blockers = [...new Set(validation.blockers.map((blocker) => blocker.code))]
        notReady.push({ ...candidate, blockers })
      }
    }

    return { drawYearId, ready, notReady, alreadyFrozen, total: candidates.length }
  }

  /**
   * Freezes every named commune draw, one independent `freeze()` call at a
   * time — never one shared transaction, so a failure on one cannot roll
   * back another's already-frozen pool.
   *
   * The caller (the controller) re-sends exactly the ids the validation step
   * reported ready; nothing here re-discovers or widens that set. A commune
   * that stopped being freezable between the two calls simply fails through
   * `freeze()`'s own existing error, reported honestly rather than skipped
   * without a reason.
   */
  async freezeBatch(
    user: User,
    drawYearId: string,
    communeDrawIds: string[],
    actor: AuditActor,
  ): Promise<BatchFreezeResultDto> {
    const scoped = await this.candidatesForYear(user, drawYearId)
    const byId = new Map(scoped.map((draw) => [draw.id, draw]))

    const outcomes: BatchFreezeOutcomeDto[] = []

    for (const communeDrawId of communeDrawIds) {
      const draw = byId.get(communeDrawId)
      // Not found or out of the caller's scope — refused the same way a
      // single freeze() would be, never silently dropped from the report.
      if (!draw) {
        outcomes.push({
          communeDrawId,
          commune: EMPTY_PLACE,
          wilaya: EMPTY_PLACE,
          allocatedSpots: 0,
          status: 'failed',
          code: 'COMMUNE_DRAW_NOT_FOUND',
        })
        continue
      }

      const candidate = toCandidateDto(draw)

      if (this.inFlight.has(communeDrawId)) {
        outcomes.push({ ...candidate, status: 'skipped', code: 'POOL_ALREADY_EXISTS' })
        continue
      }

      this.inFlight.add(communeDrawId)
      try {
        const result = await this.pool.freeze(communeDrawId, actor)
        outcomes.push({
          ...candidate,
          status: result.alreadyFrozen ? 'skipped' : 'completed',
          ...(result.alreadyFrozen ? { code: 'POOL_ALREADY_EXISTS' } : {}),
        })
      } catch (error) {
        const code = error instanceof ApiError ? error.code : 'INTERNAL_ERROR'
        outcomes.push({ ...candidate, status: 'failed', code })
      } finally {
        this.inFlight.delete(communeDrawId)
      }
    }

    const succeeded = outcomes.filter((outcome) => outcome.status === 'completed').length
    const failed = outcomes.filter((outcome) => outcome.status === 'failed')
    const skipped = outcomes.filter((outcome) => outcome.status === 'skipped')

    await this.audit.record({
      action: 'COMMUNE_DRAW_BATCH_POOL_FROZEN',
      actor,
      targetType: 'DRAW_YEAR',
      targetId: drawYearId,
      metadata: {
        targeted: communeDrawIds.length,
        succeeded,
        failed: failed.length,
        skipped: skipped.length,
        failedCommuneDrawIds: failed.map((outcome) => outcome.communeDrawId),
      },
    })

    return {
      drawYearId,
      targeted: communeDrawIds.length,
      succeeded,
      failed: failed.length,
      skipped: skipped.length,
      outcomes,
    }
  }

  /** Every commune draw in the year the caller may see, any status — the
   *  bucketing in `validate` is what decides readiness, not this query. */
  private async candidatesForYear(user: User, drawYearId: string): Promise<CommuneDrawCandidate[]> {
    const ceiling = communeScopeFilter(this.authorization.scopeFor(user))

    return this.db.communeDraw.findMany({
      where: { drawYearId, commune: ceiling },
      include: { commune: { include: { wilaya: true } }, pool: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
  }
}

const EMPTY_PLACE = { id: '', code: '', nameAr: '', nameFr: '', nameEn: '' }

function toCandidateDto(draw: CommuneDrawCandidate): BatchCandidateDto {
  const { commune } = draw

  return {
    communeDrawId: draw.id,
    allocatedSpots: draw.allocatedSpots,
    commune: {
      id: commune.id,
      code: commune.code,
      nameAr: commune.nameAr,
      nameFr: commune.nameFr,
      nameEn: commune.nameEn,
    },
    wilaya: {
      id: commune.wilaya.id,
      code: commune.wilaya.code,
      nameAr: commune.wilaya.nameAr,
      nameFr: commune.wilaya.nameFr,
      nameEn: commune.wilaya.nameEn,
    },
  }
}

export const batchPoolFreezeService = new BatchPoolFreezeService()
