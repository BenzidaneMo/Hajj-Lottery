import type { EntryType, PrismaClient } from '@prisma/client'

import { hashPool, SNAPSHOT_VERSION } from '../lib/draw-pool-hash.js'
import { ApiError, ConflictError, NotFoundError } from '../lib/errors.js'
import {
  weightedSampleWithoutReplacement,
  type RandomIntSource,
  type SelectionEvent,
} from '../lib/lottery.js'
import { cryptoRandomIntSource } from '../lib/lottery-random.js'
import { prisma as defaultPrisma } from '../lib/prisma.js'
import { drawConfigurationService, type CommuneDrawWithPlace } from './draw-configuration.service.js'

/** What the pool needs to expose for a draw. Identity is deliberately absent. */
const ENTRY_FIELDS = {
  id: true,
  applicationId: true,
  applicationReference: true,
  entryType: true,
  primaryParticipantId: true,
  secondaryParticipantId: true,
  weight: true,
} as const

/** One selected entry, and where in the order it came. */
export interface SelectedEntry {
  drawPoolEntryId: string
  applicationId: string
  applicationReference: string
  entryType: EntryType
  weight: number
  /** 1-based position in the order the entries were drawn. */
  selectionOrder: number
}

/**
 * A completed selection.
 *
 * Everything needed to reproduce it: which frozen pool was drawn from (by id
 * and by hash), what the terms were, which entries came out and in what order,
 * and the random value behind every one of those choices. Nothing here is
 * persisted, and no winner exists yet — this is the answer to a question, not a
 * result the system has adopted.
 */
export interface DrawSelection {
  communeDrawId: string
  drawPoolId: string
  drawYear: number
  communeCode: string
  /** The pool's frozen fingerprint, re-verified before the draw ran. */
  snapshotHash: string
  entryCount: number
  totalWeight: number
  /** The number of places, and therefore the number of entries selected. */
  allocatedSpots: number
  selected: SelectedEntry[]
  events: SelectionEvent[]
  selectedAt: string
}

/**
 * The lottery engine's one consumer of the frozen draw pool.
 *
 * It reads a `LOCKED` commune draw's immutable pool, draws from it with a
 * cryptographically secure random source, and returns the selected entries in
 * order. That is all it does. It writes nothing: no winners, no `has_won_hajj`,
 * no lifecycle change, no audit row, not even a log line. `COMPLETED` does not
 * exist on the commune draw lifecycle, and a selection this service produces
 * has not concluded anything.
 *
 * Everything it draws on is the snapshot. It does not read
 * `Application.calculated_weight`, does not recompute a weight, does not
 * re-evaluate eligibility, and never touches participation history — those
 * questions were settled and frozen when the pool was created, and asking them
 * again here would make the draw depend on data that has moved since. The pool
 * is the authoritative input, and the only one.
 *
 * **Deliberately not reachable over HTTP.** Without somewhere to record that a
 * draw has been run, two calls would produce two different, equally
 * authoritative sets of winners for the same commune — and an endpoint would let
 * an administrator re-roll until they liked the outcome. A repeat-execution
 * guard needs the draw-results record that winner processing will introduce, so
 * until then this stays a service with no route, the way
 * `ParticipationHistoryService.correct()` waits for its approval workflow.
 * See docs/lottery-engine.md.
 */
export class LotteryService {
  private readonly db: PrismaClient
  private readonly random: RandomIntSource

  /**
   * The random source is a constructor dependency so a test can supply a fixed
   * sequence and assert an exact outcome. The default is the CSPRNG — a seeded
   * PRNG never becomes the production source to make testing easier.
   */
  constructor(db: PrismaClient = defaultPrisma, random: RandomIntSource = cryptoRandomIntSource) {
    this.db = db
    this.random = random
  }

  /**
   * Draws this commune draw's allocated number of places from its frozen pool.
   *
   * Reads only. Every refusal happens before a single random number is drawn,
   * so a draw either runs against a complete, verified snapshot or does not run
   * at all.
   */
  async selectFromPool(communeDrawId: string): Promise<DrawSelection> {
    const communeDraw = await drawConfigurationService.findCommuneDraw(communeDrawId)
    if (!communeDraw) throw new NotFoundError('COMMUNE_DRAW_NOT_FOUND', 'Commune draw not found')

    // LOCKED is the only state whose input cannot still change. A DRAFT or
    // READY commune draw is still accepting applications and can still be
    // reallocated; a CANCELLED one is not holding a lottery at all.
    if (communeDraw.status !== 'LOCKED') {
      throw new ConflictError(
        'DRAW_NOT_LOCKED',
        `A draw can only be run against a locked commune draw, and this one is ${communeDraw.status}`,
      )
    }

    const pool = await this.db.drawPool.findUnique({
      where: { communeDrawId },
      include: {
        entries: {
          select: ENTRY_FIELDS,
          // An explicit, stable order. Database row order is arbitrary and must
          // never be part of a draw — randomness decides who is selected, not
          // the query planner. Application id is the same order the snapshot
          // hash was computed in, so the draw reads the pool exactly as it was
          // fingerprinted.
          orderBy: { applicationId: 'asc' },
        },
      },
    })
    if (!pool) throw new NotFoundError('POOL_NOT_FOUND', 'This commune draw has no frozen pool')

    this.assertSnapshotIntact(communeDraw, pool)

    const winnerCount = pool.allocatedSpots

    // A pool smaller than the allocation is refused, never truncated. Freezing
    // allows it on purpose — 100 places with 20 applicants is a valid pool —
    // so whether such a draw selects everybody is a policy decision the domain
    // has not made, and this engine will not make it silently.
    if (pool.entryCount < winnerCount) {
      throw new ConflictError(
        'INSUFFICIENT_DRAW_ENTRIES',
        `This pool holds ${pool.entryCount} entries for ${winnerCount} allocated places`,
      )
    }

    // The pool rows already carry `id` and `weight`, so the algorithm sees each
    // entry through the two fields it is allowed to choose on and hands the
    // whole row back.
    const selection = weightedSampleWithoutReplacement(pool.entries, winnerCount, this.random)

    return {
      communeDrawId: communeDraw.id,
      drawPoolId: pool.id,
      drawYear: communeDraw.drawYear.year,
      communeCode: communeDraw.commune.code,
      snapshotHash: pool.snapshotHash,
      entryCount: pool.entryCount,
      totalWeight: pool.totalWeight,
      allocatedSpots: pool.allocatedSpots,
      selected: selection.selected.map((entry, index) => ({
        drawPoolEntryId: entry.id,
        applicationId: entry.applicationId,
        applicationReference: entry.applicationReference,
        entryType: entry.entryType,
        weight: entry.weight,
        selectionOrder: index + 1,
      })),
      events: selection.events,
      selectedAt: new Date().toISOString(),
    }
  }

  /**
   * Verifies the snapshot still says what it said when it was frozen, before
   * anything is drawn from it.
   *
   * The stored aggregates are checked against the rows actually loaded, and the
   * fingerprint is recomputed from those rows and compared. Database triggers
   * already make the pool immutable, so this cannot fail through any supported
   * path — which is the point of checking: a draw run against a pool that had
   * been altered by some route nobody anticipated would be indistinguishable
   * from a legitimate one afterwards.
   *
   * Recomputing the hash is **verification, never seeding.** The value is
   * compared and then plays no part in choosing anybody; deriving randomness
   * from the input would make the outcome a function of who entered.
   */
  private assertSnapshotIntact(
    communeDraw: CommuneDrawWithPlace,
    pool: {
      id: string
      entryCount: number
      totalWeight: number
      allocatedSpots: number
      snapshotHash: string
      snapshotVersion: number
      entries: {
        applicationId: string
        applicationReference: string
        entryType: EntryType
        primaryParticipantId: string
        secondaryParticipantId: string | null
        weight: number
      }[]
    },
  ): void {
    const refuse = (reason: string): never => {
      throw new ConflictError('INVALID_POOL_SNAPSHOT', `This draw pool cannot be drawn from: ${reason}`)
    }

    // A pool written under a canonical form this build does not know cannot be
    // verified, and an unverifiable snapshot is not a snapshot.
    if (pool.snapshotVersion !== SNAPSHOT_VERSION) {
      refuse(`it was written under snapshot version ${pool.snapshotVersion}`)
    }

    // Structurally impossible: allocated_spots is CHECK-constrained to 1-100000.
    // A zero would mean drawing nobody, which is not a draw.
    if (!Number.isSafeInteger(pool.allocatedSpots) || pool.allocatedSpots < 1) {
      throw new ApiError(500, 'INTERNAL_ERROR', 'Draw pool allocates no places')
    }

    if (pool.entries.length !== pool.entryCount) {
      refuse(`it records ${pool.entryCount} entries but holds ${pool.entries.length}`)
    }

    const loadedWeight = pool.entries.reduce((sum, entry) => sum + entry.weight, 0)
    if (loadedWeight !== pool.totalWeight) {
      refuse(`its entries weigh ${loadedWeight}, not the recorded ${pool.totalWeight}`)
    }

    const recomputed = hashPool({
      communeDrawId: communeDraw.id,
      communeId: communeDraw.communeId,
      drawYear: communeDraw.drawYear.year,
      // The allocation as frozen into the pool, not as the commune draw reads
      // it now — the snapshot is the authority on the terms it was built under.
      allocatedSpots: pool.allocatedSpots,
      entries: pool.entries,
    })

    if (recomputed !== pool.snapshotHash) {
      refuse('its contents no longer match its snapshot hash')
    }
  }
}

export const lotteryService = new LotteryService()
