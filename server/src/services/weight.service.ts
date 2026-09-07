import type { WeightRule } from '@hajj-lottery/shared'
import type { Application, PrismaClient } from '@prisma/client'

import { ApiError, NotFoundError } from '../lib/errors.js'
import { combineWeights, individualWeight } from '../lib/weight-rules.js'
import { prisma as defaultPrisma } from '../lib/prisma.js'
import { eligibilityService, EligibilityService } from './eligibility.service.js'
import { participationHistoryService, ParticipationHistoryService } from './participation-history.service.js'

/**
 * One calculation, with the pieces it was built from.
 *
 * The component weights are kept because a bare number is not reviewable: an
 * administrator asking why a paired application weighs 5 needs to see that one
 * applicant brought 5 and the other 3, not to take it on trust.
 */
export interface WeightCalculation {
  applicationId: string
  applicationReference: string
  drawYear: number
  entryType: 'SINGLE' | 'PAIRED'
  primaryWeight: number
  /** Null for a SINGLE application. */
  secondaryWeight: number | null
  calculatedWeight: number
  rule: WeightRule
  /** What is currently stored, or null if this application was never frozen. */
  frozenWeight: number | null
}

/**
 * The authoritative priority/weight engine.
 *
 * Turns participation history into an application's lottery weight, and
 * nothing else. It does not decide who may take part — that is
 * EligibilityService, which it defers to — and it does not decide who wins,
 * which does not exist yet.
 *
 * Calculating never writes. `freezeApplicationWeight` is the only operation
 * that touches the database, and it says so in its name: a snapshot is a
 * deliberate act, not a side effect of looking.
 */
export class WeightService {
  private readonly db: PrismaClient
  private readonly eligibility: EligibilityService
  private readonly history: ParticipationHistoryService

  constructor(
    db: PrismaClient = defaultPrisma,
    eligibility: EligibilityService = eligibilityService,
    history: ParticipationHistoryService = participationHistoryService,
  ) {
    this.db = db
    this.eligibility = eligibility
    this.history = history
  }

  /**
   * What this application would weigh, calculated fresh. Reads only.
   *
   * Refuses an ineligible application outright rather than returning zero.
   * Zero is a weight — a legitimate one, if the domain ever wanted
   * never-selected-but-still-entered — and using it to mean "not allowed"
   * would collapse two different answers into one number.
   */
  async calculateApplicationWeight(applicationId: string): Promise<WeightCalculation> {
    const application = await this.db.application.findUnique({
      where: { id: applicationId },
      select: {
        id: true,
        applicationReference: true,
        drawYear: true,
        entryType: true,
        calculatedWeight: true,
        primaryParticipantId: true,
        secondaryParticipantId: true,
      },
    })
    if (!application) throw new NotFoundError('APPLICATION_NOT_FOUND', 'Application not found')

    const verdict = await this.eligibility.evaluateApplication(applicationId)
    if (!verdict?.eligible) {
      throw new ApiError(
        409,
        'APPLICATION_INELIGIBLE',
        'Only an eligible application can be given a lottery weight',
      )
    }

    // A PAIRED application whose partner is missing would weigh itself on one
    // person. Eligibility already refuses that shape, so reaching here would
    // mean the two disagree — worth failing loudly rather than quietly
    // halving the pair's claim.
    if (application.entryType === 'PAIRED' && !application.secondaryParticipantId) {
      throw new ApiError(409, 'APPLICATION_INELIGIBLE', 'A paired application needs both applicants')
    }

    const primaryWeight = await this.participantWeight(application.primaryParticipantId, application.drawYear)
    const secondaryWeight = application.secondaryParticipantId
      ? await this.participantWeight(application.secondaryParticipantId, application.drawYear)
      : null

    const { calculatedWeight, rule } = combineWeights(primaryWeight, secondaryWeight)

    return {
      applicationId: application.id,
      applicationReference: application.applicationReference,
      drawYear: application.drawYear,
      entryType: application.entryType,
      primaryWeight,
      secondaryWeight,
      calculatedWeight,
      rule,
      frozenWeight: application.calculatedWeight,
    }
  }

  /**
   * One person's weight for a draw year, from their verified history.
   *
   * The streak calculation from the participation ledger is authoritative and
   * is reused rather than reimplemented — two copies of "which years count"
   * would eventually disagree, and the ledger's copy is the one with the tests
   * about missing years.
   */
  async participantWeight(participantId: string, targetDrawYear: number): Promise<number> {
    const streak = await this.history.calculateConsecutiveNonWinningYears(participantId, targetDrawYear)

    return individualWeight(streak.consecutiveNonWinningYears)
  }

  /**
   * Calculates and stores the weight, once.
   *
   * An application that already carries a frozen weight keeps it, and the
   * stored value is returned untouched. That is the point of a snapshot: if a
   * legacy record is verified next month and the streak it feeds grows, an
   * application already frozen at 4 does not quietly become a 5. Re-freezing
   * deliberately is a pre-draw recalculation workflow, which belongs with the
   * draw lifecycle and does not exist yet.
   *
   * The write is a compare-and-set on `calculated_weight IS NULL`, so two
   * simultaneous freezes cannot produce two different stored values: the
   * second finds nothing to update and reads back what the first wrote.
   */
  async freezeApplicationWeight(applicationId: string): Promise<WeightCalculation> {
    const calculation = await this.calculateApplicationWeight(applicationId)

    if (calculation.frozenWeight !== null) return calculation

    const claimed = await this.db.application.updateMany({
      where: { id: applicationId, calculatedWeight: null },
      data: { calculatedWeight: calculation.calculatedWeight },
    })

    if (claimed.count === 1) {
      return { ...calculation, frozenWeight: calculation.calculatedWeight }
    }

    // Lost the race. Whatever the winner stored is the authoritative snapshot,
    // even in the impossible case that it differs from what was just computed.
    const stored = await this.db.application.findUnique({
      where: { id: applicationId },
      select: { calculatedWeight: true },
    })

    return { ...calculation, frozenWeight: stored?.calculatedWeight ?? null }
  }

  /** The stored snapshot, without recalculating anything. */
  async frozenWeight(applicationId: string): Promise<Application['calculatedWeight']> {
    const application = await this.db.application.findUnique({
      where: { id: applicationId },
      select: { calculatedWeight: true },
    })

    return application?.calculatedWeight ?? null
  }
}

export const weightService = new WeightService()
