import type {
  BatchCandidateDto,
  BatchExecutionOutcomeDto,
  BatchExecutionResultDto,
  BatchNotReadyReason,
  BatchValidationDto,
} from '@hajj-lottery/shared'
import type { Commune, CommuneDraw, DrawPool, DrawResult, PrismaClient, User, Wilaya } from '@prisma/client'

import { ApiError } from '../lib/errors.js'
import { prisma as defaultPrisma } from '../lib/prisma.js'
import { communeScopeFilter } from '../lib/scope.js'
import { auditService, AuditService, type AuditActor } from './audit.service.js'
import { authorizationService, AuthorizationService } from './authorization.service.js'
import { drawExecutionService, DrawExecutionService } from './draw-execution.service.js'

/**
 * Batch draw execution: running every ready commune's draw for one year in
 * one operator action.
 *
 * This is orchestration only. Selection, weighting and eligibility are
 * unchanged — `DrawExecutionService.execute` remains the one thing that runs
 * a lottery, called here once per commune, each call its own atomic
 * transaction exactly as it always has been. Nothing here reads
 * `Math.random`, combines pools, or derives a seed from the batch; a commune
 * that fails or was never ready keeps whatever state it already had.
 */

type CommuneDrawCandidate = CommuneDraw & {
  commune: Commune & { wilaya: Wilaya }
  pool: DrawPool | null
  result: DrawResult | null
}

export class BatchDrawExecutionService {
  private readonly db: PrismaClient
  private readonly authorization: AuthorizationService
  private readonly execution: DrawExecutionService
  private readonly audit: AuditService

  /**
   * Communes currently mid-execution in *this* process. A UX short-circuit
   * for an obvious double click — the real safety guarantee is unchanged:
   * each `execute()` call's own conditional `LOCKED -> COMPLETED` claim,
   * which is what actually serializes concurrent attempts (including from a
   * second process, which this set knows nothing about).
   */
  private readonly inFlight = new Set<string>()

  constructor(
    db: PrismaClient = defaultPrisma,
    authorization: AuthorizationService = authorizationService,
    execution: DrawExecutionService = drawExecutionService,
    audit: AuditService = auditService,
  ) {
    this.db = db
    this.authorization = authorization
    this.execution = execution
    this.audit = audit
  }

  /**
   * Discovers which commune draws in one year are ready for a batch run.
   *
   * A coarse, cheap check — locked, a pool exists, and the pool holds at
   * least twice the allocation. It deliberately does not re-verify the pool's
   * hash or aggregates: that is `execute()`'s job, and duplicating it here
   * would be a second verification engine the two could disagree about.
   * "Ready" here is a preview; execution is still the final word.
   */
  async validate(user: User, drawYearId: string): Promise<BatchValidationDto> {
    const candidates = await this.candidatesForYear(user, drawYearId)

    const ready: BatchCandidateDto[] = []
    const notReady: (BatchCandidateDto & { reason: BatchNotReadyReason })[] = []
    const alreadyCompleted: BatchCandidateDto[] = []

    for (const draw of candidates) {
      const candidate = toCandidateDto(draw)

      if (draw.status === 'COMPLETED') {
        alreadyCompleted.push(candidate)
        continue
      }
      if (draw.status !== 'LOCKED') {
        notReady.push({ ...candidate, reason: 'NOT_LOCKED' })
        continue
      }
      if (!draw.pool) {
        notReady.push({ ...candidate, reason: 'NO_POOL' })
        continue
      }
      if (draw.pool.entryCount < 2 * draw.allocatedSpots) {
        notReady.push({ ...candidate, reason: 'INSUFFICIENT_ENTRIES' })
        continue
      }

      ready.push(candidate)
    }

    return { drawYearId, ready, notReady, alreadyCompleted, total: candidates.length }
  }

  /**
   * Runs every named commune draw, one independent `execute()` call at a
   * time — never one shared transaction across communes, so a failure on one
   * cannot roll back another's already-committed result.
   *
   * The caller (the controller) re-sends exactly the ids the validation step
   * reported ready; nothing here re-discovers or widens that set. A commune
   * that stopped being ready between the two calls simply fails through
   * `execute()`'s own existing error, reported honestly rather than skipped
   * without a reason.
   */
  async executeBatch(
    user: User,
    drawYearId: string,
    communeDrawIds: string[],
    actor: AuditActor,
  ): Promise<BatchExecutionResultDto> {
    const scoped = await this.candidatesForYear(user, drawYearId)
    const byId = new Map(scoped.map((draw) => [draw.id, draw]))

    const outcomes: BatchExecutionOutcomeDto[] = []

    for (const communeDrawId of communeDrawIds) {
      const draw = byId.get(communeDrawId)
      // Not found or out of the caller's scope — refused the same way a
      // single execute() would be, never silently dropped from the report.
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
        outcomes.push({ ...candidate, status: 'skipped', code: 'DRAW_ALREADY_COMPLETED' })
        continue
      }

      this.inFlight.add(communeDrawId)
      try {
        await this.execution.execute(communeDrawId, actor)
        outcomes.push({ ...candidate, status: 'completed' })
      } catch (error) {
        const code = error instanceof ApiError ? error.code : 'INTERNAL_ERROR'
        outcomes.push({
          ...candidate,
          status: code === 'DRAW_ALREADY_COMPLETED' ? 'skipped' : 'failed',
          code,
        })
      } finally {
        this.inFlight.delete(communeDrawId)
      }
    }

    const succeeded = outcomes.filter((outcome) => outcome.status === 'completed').length
    const failed = outcomes.filter((outcome) => outcome.status === 'failed')
    const skipped = outcomes.filter((outcome) => outcome.status === 'skipped')

    await this.audit.record({
      action: 'COMMUNE_DRAW_BATCH_EXECUTED',
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

  private async candidatesForYear(user: User, drawYearId: string): Promise<CommuneDrawCandidate[]> {
    const ceiling = communeScopeFilter(this.authorization.scopeFor(user))

    return this.db.communeDraw.findMany({
      where: { drawYearId, commune: ceiling },
      include: { commune: { include: { wilaya: true } }, pool: true, result: true },
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

export const batchDrawExecutionService = new BatchDrawExecutionService()
