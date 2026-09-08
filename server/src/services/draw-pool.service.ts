import type { PoolBlocker, PoolBlockerCode } from '@hajj-lottery/shared'
import { Prisma, type DrawPool, type PrismaClient } from '@prisma/client'

import { ApiError, ConflictError } from '../lib/errors.js'
import { hashPool, SNAPSHOT_VERSION, type HashableEntry } from '../lib/draw-pool-hash.js'
import { prisma as defaultPrisma } from '../lib/prisma.js'
import { drawConfigurationService, type CommuneDrawWithPlace } from './draw-configuration.service.js'
import { eligibilityService, EligibilityService } from './eligibility.service.js'
import { weightService, WeightService } from './weight.service.js'

/** The applications a pool would be built from, with what freezing needs. */
const CANDIDATE_FIELDS = {
  id: true,
  applicationReference: true,
  drawYear: true,
  communeId: true,
  entryType: true,
  status: true,
  calculatedWeight: true,
  primaryParticipantId: true,
  secondaryParticipantId: true,
} as const

/** A dry run's verdict. Nothing is written to reach it. */
export interface PoolValidation {
  ready: boolean
  communeDraw: CommuneDrawWithPlace
  entries: HashableEntry[]
  totalWeight: number
  blockers: PoolBlocker[]
  /** An existing pool, when one has already been frozen. */
  existingPool: DrawPool | null
}

/**
 * The record of a freeze, shaped for the audit log that does not exist yet.
 *
 * Aggregates, identifiers and a hash — never the pool's contents. Whatever
 * eventually persists this can do so without reshaping anything, and until
 * then nothing writes a fabricated audit row.
 */
export interface PoolFreezeEvent {
  event: 'draw_pool.frozen'
  actingAdministratorId: string | null
  communeDrawId: string
  drawPoolId: string
  entryCount: number
  totalWeight: number
  snapshotHash: string
  alreadyFrozen: boolean
  at: string
}

/** What a freeze produced, and whether this call is what produced it. */
export interface PoolFreezeResult {
  pool: DrawPool
  communeDraw: CommuneDrawWithPlace
  alreadyFrozen: boolean
  event: PoolFreezeEvent
}

/**
 * The boundary between mutable application data and the fixed input a lottery
 * is run against.
 *
 * Two operations, deliberately distinct. `validate` answers "could this be
 * frozen?" and writes nothing. `freeze` does it, exactly once, in a single
 * transaction that either produces a complete pool and a locked commune draw
 * or leaves the world exactly as it found it.
 *
 * Nothing here repairs anything. A stale weight, an application that no longer
 * evaluates as eligible, a participant who has since been recorded as a
 * winner — each blocks the freeze and is reported. Silently fixing any of them
 * would mean the pool no longer matched the records it was built from, which
 * is precisely the situation freezing exists to prevent.
 */
export class DrawPoolService {
  private readonly db: PrismaClient
  private readonly eligibility: EligibilityService
  private readonly weights: WeightService

  constructor(
    db: PrismaClient = defaultPrisma,
    eligibility: EligibilityService = eligibilityService,
    weights: WeightService = weightService,
  ) {
    this.db = db
    this.eligibility = eligibility
    this.weights = weights
  }

  /**
   * Checks whether a commune draw could be frozen, and says what is stopping
   * it if not.
   *
   * Every application is reconciled against the current facts, not merely read:
   * the weight it carries is recomputed and compared, and its eligibility is
   * re-evaluated. Data has been moving since those values were written —
   * verifying a legacy record changes a streak — and a pool built from stale
   * numbers would be a lottery run on figures nobody could reproduce.
   */
  async validate(communeDrawId: string): Promise<PoolValidation> {
    const communeDraw = await drawConfigurationService.findCommuneDraw(communeDrawId)
    if (!communeDraw) throw new ApiError(404, 'COMMUNE_DRAW_NOT_FOUND', 'Commune draw not found')

    const blockers: PoolBlocker[] = []
    const add = (code: PoolBlockerCode, applicationReference: string | null = null) => {
      blockers.push({ code, applicationReference })
    }

    const existingPool = await this.db.drawPool.findUnique({ where: { communeDrawId } })
    if (existingPool) add('POOL_ALREADY_EXISTS')

    // Freezing is the step after intake, so intake must be over. A commune
    // cannot fix its input while applications are still arriving into it.
    if (communeDraw.drawYear.status !== 'REGISTRATION_CLOSED') add('REGISTRATION_STILL_OPEN')

    // READY, not DRAFT: the administrator has to have declared the
    // configuration settled before it can be made permanent.
    if (communeDraw.status !== 'READY') add('COMMUNE_DRAW_NOT_READY')

    const candidates = await this.db.application.findMany({
      where: {
        communeId: communeDraw.communeId,
        drawYear: communeDraw.drawYear.year,
        status: 'ELIGIBLE',
      },
      select: CANDIDATE_FIELDS,
      orderBy: { id: 'asc' },
    })

    if (candidates.length === 0) add('NO_ELIGIBLE_APPLICATIONS')

    const entries: HashableEntry[] = []

    for (const application of candidates) {
      const reference = application.applicationReference
      let usable = true

      // Defensive: the query already filters on both. Asserted anyway because
      // an application in the wrong commune or year silently entering a pool
      // would be undetectable afterwards.
      if (application.communeId !== communeDraw.communeId) {
        add('WRONG_COMMUNE', reference)
        usable = false
      }
      if (application.drawYear !== communeDraw.drawYear.year) {
        add('WRONG_DRAW_YEAR', reference)
        usable = false
      }

      if (application.entryType === 'PAIRED' && !application.secondaryParticipantId) {
        add('INVALID_APPLICATION_STRUCTURE', reference)
        usable = false
      }
      if (application.entryType === 'SINGLE' && application.secondaryParticipantId) {
        add('INVALID_APPLICATION_STRUCTURE', reference)
        usable = false
      }

      if (application.calculatedWeight === null) {
        add('MISSING_WEIGHT', reference)
        usable = false
      } else if (!Number.isSafeInteger(application.calculatedWeight) || application.calculatedWeight < 1) {
        add('INVALID_WEIGHT', reference)
        usable = false
      }

      // Reconciliation. The stored status says this application was accepted;
      // the live evaluation says whether that is still true today.
      const verdict = await this.eligibility.evaluateApplication(application.id)
      if (!verdict?.eligible) {
        const wonSince = verdict?.reasons.some((reason) => reason.endsWith('HAS_ALREADY_WON')) ?? false
        add(wonSince ? 'PARTICIPANT_STATE_CONFLICT' : 'APPLICATION_NOT_ELIGIBLE', reference)
        usable = false
      }

      if (application.calculatedWeight !== null && verdict?.eligible) {
        const current = await this.weights.calculateApplicationWeight(application.id)
        if (current.calculatedWeight !== application.calculatedWeight) {
          // Reported, never corrected. Overwriting the frozen weight here
          // would rewrite the claim an application entered with, and doing it
          // as a side effect of freezing would hide it entirely.
          add('STALE_WEIGHT', reference)
          usable = false
        }
      }

      if (!usable || application.calculatedWeight === null) continue

      entries.push({
        applicationId: application.id,
        applicationReference: reference,
        entryType: application.entryType,
        primaryParticipantId: application.primaryParticipantId,
        secondaryParticipantId: application.secondaryParticipantId,
        weight: application.calculatedWeight,
      })
    }

    const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0)

    return {
      ready: blockers.length === 0,
      communeDraw,
      entries,
      totalWeight,
      blockers,
      existingPool,
    }
  }

  /**
   * Freezes the pool and locks the commune draw, atomically.
   *
   * Either both happen or neither does. A locked commune draw with no pool
   * would be a draw whose input nobody can inspect; a pool with an unlocked
   * commune draw would be a snapshot of terms that can still change. Both are
   * impossible here because the whole thing is one transaction.
   *
   * Calling it again after success returns the existing pool rather than
   * building a second one — the snapshot is the authoritative input, and there
   * can only be one.
   */
  async freeze(
    communeDrawId: string,
    actingAdministratorId: string | null = null,
  ): Promise<PoolFreezeResult> {
    const validation = await this.validate(communeDrawId)
    const settled = (pool: DrawPool, alreadyFrozen: boolean): PoolFreezeResult => ({
      pool,
      communeDraw: validation.communeDraw,
      alreadyFrozen,
      event: {
        event: 'draw_pool.frozen',
        actingAdministratorId,
        communeDrawId,
        drawPoolId: pool.id,
        entryCount: pool.entryCount,
        totalWeight: pool.totalWeight,
        snapshotHash: pool.snapshotHash,
        alreadyFrozen,
        at: new Date().toISOString(),
      },
    })

    // Already done. Not an error: an administrator retrying a request that
    // succeeded should be told the outcome, not handed a failure.
    if (validation.existingPool) return settled(validation.existingPool, true)

    if (!validation.ready) {
      throw new ConflictError(
        'POOL_NOT_READY',
        'This commune draw cannot be frozen yet. Validate it to see what is blocking.',
      )
    }

    const { communeDraw, entries, totalWeight } = validation

    const snapshotHash = hashPool({
      communeDrawId: communeDraw.id,
      communeId: communeDraw.communeId,
      drawYear: communeDraw.drawYear.year,
      allocatedSpots: communeDraw.allocatedSpots,
      entries,
    })

    try {
      const pool = await this.db.$transaction(async (tx) => {
        // The lock is claimed by a conditional update rather than a prior
        // read: if another transaction has already moved this commune draw out
        // of READY, no row matches and this one gives up.
        const locked = await tx.communeDraw.updateMany({
          where: { id: communeDraw.id, status: 'READY' },
          data: { status: 'LOCKED' },
        })
        if (locked.count !== 1) {
          throw new ConflictError('POOL_NOT_READY', 'This commune draw is no longer ready to freeze')
        }

        // The unique constraint on commune_draw_id is the real serialization
        // point: two transactions reaching here concurrently, only one commits.
        const created = await tx.drawPool.create({
          data: {
            communeDrawId: communeDraw.id,
            entryCount: entries.length,
            totalWeight,
            allocatedSpots: communeDraw.allocatedSpots,
            snapshotHash,
            snapshotVersion: SNAPSHOT_VERSION,
          },
        })

        await tx.drawPoolEntry.createMany({
          data: entries.map((entry) => ({
            drawPoolId: created.id,
            applicationId: entry.applicationId,
            applicationReference: entry.applicationReference,
            entryType: entry.entryType as 'SINGLE' | 'PAIRED',
            primaryParticipantId: entry.primaryParticipantId,
            secondaryParticipantId: entry.secondaryParticipantId,
            weight: entry.weight,
          })),
        })

        // The stored aggregates must describe the rows that were actually
        // written, not the array they came from. Nothing can repair them
        // afterwards, so they are checked while a rollback is still possible.
        const written = await tx.drawPoolEntry.aggregate({
          where: { drawPoolId: created.id },
          _count: { _all: true },
          _sum: { weight: true },
        })

        if (
          written._count._all !== created.entryCount ||
          (written._sum.weight ?? 0) !== created.totalWeight
        ) {
          throw new ApiError(500, 'INTERNAL_ERROR', 'Draw pool totals did not match its entries')
        }

        return created
      })

      return settled(pool, false)
    } catch (error) {
      // Lost the race to another freeze. The winner's pool is authoritative,
      // and this caller is told what exists rather than that they failed.
      if (isUniqueViolation(error)) {
        const existing = await this.db.drawPool.findUnique({ where: { communeDrawId } })
        if (existing) return settled(existing, true)
      }
      throw error
    }
  }

  /** A frozen pool with its entries, for administrative inspection. */
  async findPool(communeDrawId: string) {
    return this.db.drawPool.findUnique({
      where: { communeDrawId },
      include: {
        entries: {
          select: { applicationReference: true, entryType: true, weight: true },
          orderBy: { applicationId: 'asc' },
        },
      },
    })
  }

  /** The pool without its entries. */
  async findPoolSummary(communeDrawId: string): Promise<DrawPool | null> {
    return this.db.drawPool.findUnique({ where: { communeDrawId } })
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

export const drawPoolService = new DrawPoolService()
