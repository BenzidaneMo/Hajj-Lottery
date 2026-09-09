import type { AbandonmentReason } from '@hajj-lottery/shared'
import { Prisma, type DrawReserve, type PrismaClient, type WinnerAbandonment } from '@prisma/client'

import { ConflictError, NotFoundError } from '../lib/errors.js'
import { prisma as defaultPrisma } from '../lib/prisma.js'
import { auditService, AuditService, scopeOfCommune, type AuditActor } from './audit.service.js'
import type { CommuneDrawWithPlace } from './draw-configuration.service.js'

/** What an official recorded about a winner giving up their place. */
export interface AbandonmentInput {
  reason: AbandonmentReason
  explanation: string
}

/** A recorded abandonment, and the winner it concerns. */
export interface AbandonmentOutcome {
  abandonment: WinnerAbandonment
  selectionOrder: number
}

/** A reserve after the operation that moved it. */
export interface ReserveOutcome {
  reserve: DrawReserve
  /** The abandoned winner's original selection order, once one is assigned. */
  replacesSelectionOrder: number | null
}

/** A promotion: the reserve, and everything it made true. */
export interface PromotionOutcome extends ReserveOutcome {
  /** People who became lifetime winners: 1 for a single entry, 2 for a pair. */
  promotedParticipantCount: number
}

/**
 * The reserve lifecycle: abandonment, calling, refusal and promotion.
 *
 * Everything a concluded draw can still do. The lottery itself is over and
 * cannot be re-run, re-ordered or added to — what remains is a sequence of
 * administrative acts against an ordering that was fixed when the draw
 * concluded, and this service is the only thing that performs them.
 *
 * Four properties hold across all of it.
 *
 * **The original draw is never rewritten.** No method here touches a
 * `DrawWinner`, a `DrawSelectionEvent`, a `DrawResult` or a pool row, and the
 * database would refuse if one tried. A promoted reserve stays reserve #1 of
 * this draw forever and separately becomes a winner; nothing turns them into
 * "winner #4". The two facts are stored in two places precisely so that a
 * replacement cannot be mistaken, later, for what the lottery decided.
 *
 * **The order is enforced, never chosen.** Calling takes a position and refuses
 * unless it is the next waiting one. An administrator with a preference between
 * reserve #1 and reserve #7 is an administrator choosing a winner, which is the
 * thing the lottery exists to prevent — so the position in the request is a
 * confirmation of what the service already knows, not an instruction.
 *
 * **Two deliberate steps, not one.** Recording an abandonment does not promote
 * anybody, and promoting is not implied by anything. Somebody gave up a place
 * and somebody else was offered it: two decisions, two moments, two audit
 * records, each with a person's name against it.
 *
 * **Nothing is half-done.** Each operation is one transaction covering its
 * mutation *and* its audit record. A promotion that wrote a winner archive row
 * and failed to exclude the participant, or excluded them and failed to record
 * why, would be a state nobody could reconstruct — so none of them can exist.
 */
export class ReserveService {
  private readonly db: PrismaClient
  private readonly audit: AuditService

  constructor(db: PrismaClient = defaultPrisma, audit: AuditService = auditService) {
    this.db = db
    this.audit = audit
  }

  /**
   * Records that an original winner has given up their place.
   *
   * Writes one row and one audit record, and nothing else. In particular it
   * does **not** clear `has_won_hajj`, does not remove the winner archive row,
   * does not alter the application's `SELECTED` status, and does not promote
   * anybody. A place that was awarded and given up was still awarded: the
   * person remains a winner of this draw historically and remains excluded from
   * every future one, because reopening a lifetime eligibility on the strength
   * of an administrative note is not something this system does.
   *
   * A paired winning application is one entry and is abandoned whole. There is
   * no way to record half of one, and the next reserve replaces the entire
   * application rather than one of its two travellers.
   */
  async recordAbandonment(
    communeDraw: CommuneDrawWithPlace,
    selectionOrder: number,
    input: AbandonmentInput,
    actor: AuditActor,
  ): Promise<AbandonmentOutcome> {
    try {
      return await this.db.$transaction(async (tx) => {
        const winner = await this.findWinner(tx, communeDraw.id, selectionOrder)

        const abandonment = await tx.winnerAbandonment.create({
          data: {
            drawWinnerId: winner.id,
            reason: input.reason,
            explanation: input.explanation,
            recordedByUserId: actor.id,
          },
        })

        // The explanation is the audit reason, so the trail and the record
        // carry the same words rather than two accounts that could diverge.
        // Nothing identifying goes into the metadata: a selection order names a
        // place in a draw, not a person.
        await this.audit.record(
          {
            action: 'WINNER_ABANDONED',
            actor,
            targetType: 'DRAW_WINNER',
            targetId: winner.id,
            scope: scopeOfCommune(communeDraw.commune),
            reason: input.explanation,
            metadata: {
              communeDrawId: communeDraw.id,
              drawYear: communeDraw.drawYear.year,
              drawResultId: winner.drawResultId,
              selectionOrder: winner.selectionOrder,
              abandonmentReason: input.reason,
            },
          },
          tx,
        )

        return { abandonment, selectionOrder: winner.selectionOrder }
      })
    } catch (error) {
      // `UNIQUE(draw_winner_id)`: two administrators recording the same
      // abandonment, or one recording it twice. The first stands.
      if (isUniqueViolation(error)) {
        throw new ConflictError(
          'WINNER_ALREADY_ABANDONED',
          'This winner has already been recorded as having given up their place',
        )
      }
      throw error
    }
  }

  /**
   * Calls the next waiting reserve for a place a named winner gave up.
   *
   * `reservePosition` is checked rather than obeyed. It must be the position of
   * the first WAITING reserve, and a request naming any other is refused — so
   * the path reads as the operation an official is performing while the ordering
   * stays the lottery's. It doubles as a concurrency check: two administrators
   * working from the same list both name the same position, and only one of them
   * can claim it.
   *
   * The place must actually be vacant. A winner who has not been recorded as
   * having given theirs up cannot be replaced, and a place that already has an
   * undeclined reserve against it cannot be filled twice — the second is a
   * partial unique index rather than a check here, so two simultaneous calls for
   * the same place resolve in the database.
   */
  async callNextReserve(
    communeDraw: CommuneDrawWithPlace,
    reservePosition: number,
    winnerSelectionOrder: number,
    actor: AuditActor,
  ): Promise<ReserveOutcome> {
    try {
      return await this.db.$transaction(async (tx) => {
        const winner = await this.findWinner(tx, communeDraw.id, winnerSelectionOrder)

        if (!winner.abandonment) {
          throw new ConflictError(
            'WINNER_NOT_ABANDONED',
            'A place can only be offered to a reserve once its winner has been recorded as giving it up',
          )
        }

        // A declined reserve does not hold the place — that is the whole point
        // of declining — so it does not block the next one being called.
        const filled = await tx.drawReserve.findFirst({
          where: { replacesDrawWinnerId: winner.id, status: { not: 'DECLINED' } },
          select: { reservePosition: true },
        })
        if (filled) {
          throw new ConflictError(
            'PLACE_ALREADY_FILLED',
            `Reserve #${filled.reservePosition} has already been called for this place`,
          )
        }

        const next = await tx.drawReserve.findFirst({
          where: { drawResultId: winner.drawResultId, status: 'WAITING' },
          orderBy: { reservePosition: 'asc' },
        })
        if (!next) {
          throw new ConflictError(
            'NO_RESERVE_AVAILABLE',
            'Every reserve on this draw has already been called',
          )
        }

        // The order is not negotiable, and saying so plainly matters more than
        // being terse: an official who meant to call somebody else has made a
        // mistake worth naming.
        if (next.reservePosition !== reservePosition) {
          throw new ConflictError(
            'RESERVE_OUT_OF_ORDER',
            `Reserve #${next.reservePosition} is next and must be called before reserve #${reservePosition}`,
          )
        }

        // Conditional, so two administrators calling the same reserve serialize
        // on the row: the loser matches nothing rather than overwriting a call
        // that has already gone out.
        const claimed = await tx.drawReserve.updateMany({
          where: { id: next.id, status: 'WAITING' },
          data: { status: 'CALLED', replacesDrawWinnerId: winner.id, calledAt: new Date() },
        })
        if (claimed.count !== 1) {
          throw new ConflictError('RESERVE_NOT_WAITING', 'This reserve has already been called')
        }

        const reserve = await tx.drawReserve.findUniqueOrThrow({ where: { id: next.id } })

        await this.audit.record(
          {
            action: 'RESERVE_CALLED',
            actor,
            targetType: 'DRAW_RESERVE',
            targetId: reserve.id,
            scope: scopeOfCommune(communeDraw.commune),
            metadata: {
              communeDrawId: communeDraw.id,
              drawYear: communeDraw.drawYear.year,
              drawResultId: winner.drawResultId,
              reservePosition: reserve.reservePosition,
              selectionOrder: reserve.selectionOrder,
              replacesSelectionOrder: winner.selectionOrder,
            },
          },
          tx,
        )

        return { reserve, replacesSelectionOrder: winner.selectionOrder }
      })
    } catch (error) {
      // The partial unique index on the replacement: two calls for the same
      // vacated place, arriving together.
      if (isUniqueViolation(error)) {
        throw new ConflictError(
          'PLACE_ALREADY_FILLED',
          'Another reserve has already been called for this place',
        )
      }
      throw error
    }
  }

  /**
   * Records that a called reserve refused the place.
   *
   * Terminal for them: a reserve is asked once. The place goes back to being
   * vacant, so the next reserve may be called for the same abandoned winner —
   * which is why the partial unique index that governs replacements excludes
   * DECLINED rows rather than counting them.
   *
   * Silence is never recorded here. There is no expiry, no timeout and no
   * default: an administrator records the answer a citizen actually gave, or
   * records nothing at all.
   */
  async declineReserve(
    communeDraw: CommuneDrawWithPlace,
    reservePosition: number,
    explanation: string,
    actor: AuditActor,
  ): Promise<ReserveOutcome> {
    return this.db.$transaction(async (tx) => {
      const reserve = await this.findReserve(tx, communeDraw.id, reservePosition)

      const claimed = await tx.drawReserve.updateMany({
        where: { id: reserve.id, status: 'CALLED' },
        data: { status: 'DECLINED', decidedAt: new Date() },
      })
      if (claimed.count !== 1) throw notCalled(reserve.status)

      await this.audit.record(
        {
          action: 'RESERVE_DECLINED',
          actor,
          targetType: 'DRAW_RESERVE',
          targetId: reserve.id,
          scope: scopeOfCommune(communeDraw.commune),
          reason: explanation,
          metadata: {
            communeDrawId: communeDraw.id,
            drawYear: communeDraw.drawYear.year,
            drawResultId: reserve.drawResultId,
            reservePosition: reserve.reservePosition,
            replacesSelectionOrder: reserve.replacesDrawWinner?.selectionOrder ?? null,
          },
        },
        tx,
      )

      return {
        reserve: await tx.drawReserve.findUniqueOrThrow({ where: { id: reserve.id } }),
        replacesSelectionOrder: reserve.replacesDrawWinner?.selectionOrder ?? null,
      }
    })
  }

  /**
   * Records that a called reserve accepted, and makes them a winner.
   *
   * Accepting *is* the promotion — one transaction, because every intermediate
   * state is one somebody would have to resolve by hand against a person who had
   * just been told they were going to Mecca:
   *
   *   claim the reserve → verify nobody has already won → archive → exclude →
   *   finalize the application → correct the ledger → audit → recount
   *
   * What it does **not** do is as important. It writes no `DrawWinner` row, so
   * the original selection order is untouched and the published result still
   * says what the lottery did. It creates no second draw result. It does not
   * increase the number of places: a replacement fills one that was given up,
   * which is why the count of held places can only ever return to the
   * allocation, never exceed it.
   *
   * A paired reserve is promoted whole or not at all. Both travellers are
   * checked before either is written, so an entry with one already-excluded
   * member takes the whole transaction down rather than half-promoting a pair.
   */
  async promoteReserve(
    communeDraw: CommuneDrawWithPlace,
    reservePosition: number,
    actor: AuditActor,
  ): Promise<PromotionOutcome> {
    try {
      return await this.db.$transaction(async (tx) => {
        const reserve = await this.findReserve(tx, communeDraw.id, reservePosition)

        // The claim, and the whole concurrency story for a promotion: two
        // administrators accepting at once serialize on this row, and the loser
        // matches nothing rather than archiving the same people twice.
        const claimed = await tx.drawReserve.updateMany({
          where: { id: reserve.id, status: 'CALLED' },
          data: { status: 'ACCEPTED', decidedAt: new Date() },
        })
        if (claimed.count !== 1) throw notCalled(reserve.status)

        const participantIds = [reserve.primaryParticipantId, reserve.secondaryParticipantId].filter(
          (id): id is string => id !== null,
        )

        // A paired entry that lost one of its participants somewhere is a
        // corrupted record, not an entry to promote for whoever is left.
        if (reserve.drawPoolEntry.entryType === 'PAIRED' && participantIds.length !== 2) {
          throw new ConflictError(
            'INVALID_POOL_SNAPSHOT',
            'A paired reserve cannot be promoted without both of its applicants',
          )
        }

        // Checked before anything is written, and checked for *every*
        // participant. Nothing here repairs a conflict: somebody who already
        // holds a lifetime win cannot be given a second one, and which of the
        // two records is wrong is a question for the people who made them.
        const alreadyWon = await tx.winnerArchive.count({
          where: { participantId: { in: participantIds } },
        })
        if (alreadyWon > 0) throw alreadyAWinner()

        const result = await tx.drawResult.findUniqueOrThrow({
          where: { id: reserve.drawResultId },
          select: { completedAt: true },
        })

        // `drawnAt` is the draw's own moment, not this one. They were selected
        // by that lottery; being called is not a second selection. When the
        // promotion happened is on the reserve row.
        await tx.winnerArchive.createMany({
          data: participantIds.map((participantId) => ({
            participantId,
            drawYear: communeDraw.drawYear.year,
            communeId: communeDraw.communeId,
            drawResultId: reserve.drawResultId,
            drawPoolEntryId: reserve.drawPoolEntryId,
            drawnAt: result.completedAt,
            source: 'RESERVE_REPLACEMENT' as const,
          })),
        })

        // Lifetime exclusion, conditional on it not already being set. A count
        // that comes back short means somebody was excluded between the check
        // above and this write, and the whole promotion unwinds — the archive
        // row and the exclusion are written together or not at all.
        const excluded = await tx.participant.updateMany({
          where: { id: { in: participantIds }, hasWonHajj: false },
          data: { hasWonHajj: true },
        })
        if (excluded.count !== participantIds.length) throw alreadyAWinner()

        // The application's lottery outcome catches up with the facts: this
        // application now holds a place. Its `RESERVE` status said it had been
        // drawn into the contingency list, which was true until this moment.
        await tx.application.update({
          where: { id: reserve.applicationId },
          data: { status: 'SELECTED' },
        })

        // The ledger's existing row for this year is corrected, never
        // duplicated. They took part in this draw once — execution wrote that
        // when the pool was drawn — and what has changed is the outcome, not the
        // participation. A second row for the same year is exactly what
        // `UNIQUE(participant_id, draw_year)` exists to prevent, and creating
        // one would double-count the year for anybody reading the ledger.
        const corrected = await tx.participationHistory.updateMany({
          where: { participantId: { in: participantIds }, drawYear: communeDraw.drawYear.year },
          data: { won: true },
        })
        if (corrected.count !== participantIds.length) {
          throw new ConflictError(
            'INVALID_POOL_SNAPSHOT',
            'A promoted reserve has no participation record for this draw year',
          )
        }

        await this.audit.record(
          {
            action: 'RESERVE_PROMOTED',
            actor,
            targetType: 'DRAW_RESERVE',
            targetId: reserve.id,
            scope: scopeOfCommune(communeDraw.commune),
            metadata: {
              communeDrawId: communeDraw.id,
              drawYear: communeDraw.drawYear.year,
              drawResultId: reserve.drawResultId,
              reservePosition: reserve.reservePosition,
              selectionOrder: reserve.selectionOrder,
              replacesSelectionOrder: reserve.replacesDrawWinner?.selectionOrder ?? null,
              promotedParticipantCount: participantIds.length,
            },
          },
          tx,
        )

        await this.assertPlacesReconcile(tx, reserve.drawResultId)

        return {
          reserve: await tx.drawReserve.findUniqueOrThrow({ where: { id: reserve.id } }),
          replacesSelectionOrder: reserve.replacesDrawWinner?.selectionOrder ?? null,
          promotedParticipantCount: participantIds.length,
        }
      })
    } catch (error) {
      // `UNIQUE(participant_id)` on the archive: a promotion racing another
      // draw's execution, or a second promotion of the same people.
      if (isUniqueViolation(error)) throw alreadyAWinner()
      throw error
    }
  }

  /**
   * Confirms the draw still allocates what it allocated, before committing.
   *
   * A replacement fills a place, it does not add one, so the number held can
   * never exceed the number the commune was given. Counted from the rows
   * actually written rather than from what this method believes it wrote, while
   * a rollback is still possible.
   */
  private async assertPlacesReconcile(tx: Prisma.TransactionClient, drawResultId: string): Promise<void> {
    const [winners, abandoned, promoted] = await Promise.all([
      tx.drawWinner.count({ where: { drawResultId } }),
      tx.winnerAbandonment.count({ where: { drawWinner: { drawResultId } } }),
      tx.drawReserve.count({ where: { drawResultId, status: 'ACCEPTED' } }),
    ])

    if (winners - abandoned + promoted > winners) {
      throw new ConflictError(
        'PLACE_ALREADY_FILLED',
        'This promotion would award more places than the commune allocated',
      )
    }
  }

  /** One winning entry of this commune's draw, by its selection order. */
  private async findWinner(tx: Prisma.TransactionClient, communeDrawId: string, selectionOrder: number) {
    const winner = await tx.drawWinner.findFirst({
      where: { drawResult: { communeDrawId }, selectionOrder },
      include: { abandonment: { select: { id: true } } },
    })
    if (!winner) {
      throw new NotFoundError('DRAW_WINNER_NOT_FOUND', 'This draw has no winner at that selection order')
    }

    return winner
  }

  /** One reserve of this commune's draw, by its position in the call order. */
  private async findReserve(tx: Prisma.TransactionClient, communeDrawId: string, reservePosition: number) {
    const reserve = await tx.drawReserve.findFirst({
      where: { drawResult: { communeDrawId }, reservePosition },
      include: {
        drawPoolEntry: { select: { entryType: true } },
        replacesDrawWinner: { select: { selectionOrder: true } },
      },
    })
    if (!reserve) {
      throw new NotFoundError('RESERVE_NOT_FOUND', 'This draw has no reserve at that position')
    }

    return reserve
  }
}

/**
 * The refusal for an operation that needs a reserve who has been asked.
 *
 * Names the state it found, because the two ways to reach it — not yet called,
 * and already answered — are different mistakes with different remedies, and
 * neither reveals anything a scoped administrator may not already see.
 */
function notCalled(status: DrawReserve['status']): ConflictError {
  return new ConflictError(
    'RESERVE_NOT_CALLED',
    `An answer can only be recorded for a reserve who has been called, and this one is ${status}`,
  )
}

/**
 * The refusal that protects the strongest invariant in the model.
 *
 * One win per person, for life. A promotion that would give somebody a second is
 * blocked and nothing is modified — not the reserve, not the archive, not the
 * ledger. Which of the two records is the mistake is a question for the people
 * who made them, and answering it automatically would destroy the evidence.
 */
function alreadyAWinner(): ConflictError {
  return new ConflictError(
    'PARTICIPANT_ALREADY_WON',
    'This reserve cannot be promoted: one of its applicants is already recorded as a Hajj winner',
  )
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

export const reserveService = new ReserveService()
