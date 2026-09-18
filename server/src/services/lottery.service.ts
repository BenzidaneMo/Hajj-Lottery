import { LOTTERY_ALGORITHM_VERSION, pilgrimCountOf, totalDrawPilgrimQuota } from '@hajj-lottery/shared'
import type { EntryType, PrismaClient } from '@prisma/client'

import { hashPool, SNAPSHOT_VERSION } from '../lib/draw-pool-hash.js'
import { ApiError, ConflictError, NotFoundError } from '../lib/errors.js'
import {
  UnfillableQuotaError,
  weightedCapacitySample,
  type RandomIntSource,
  type SelectionEvent,
} from '../lib/lottery.js'
import { cryptoRandomIntSource } from '../lib/lottery-random.js'
import { prisma as defaultPrisma } from '../lib/prisma.js'
import { drawConfigurationService, type CommuneDrawWithPlace } from './draw-configuration.service.js'

/**
 * The Prisma surface a draw needs.
 *
 * Widened from `PrismaClient` deliberately: a transaction client satisfies it
 * too, so winner processing can run the selection *inside* the transaction that
 * records its winners rather than reading the pool from outside it.
 */
export type LotteryReader = Pick<PrismaClient, 'drawPool'>

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
  /**
   * The pilgrim places this entry occupies: 1 for SINGLE, 2 for PAIRED.
   *
   * Derived from the frozen `entryType`, not stored separately — the quota is
   * spent in these, and they are what makes a winning list of eleven
   * applications fill twelve places exactly.
   */
  pilgrimCount: number
  /** 1-based position in the order the entries were drawn. */
  selectionOrder: number
  /**
   * Who the entry wins for, as internal ids. Winner processing needs them to
   * apply lifetime exclusion — a paired entry excludes both travellers — and no
   * response ever carries them: the DTO layer exposes the application reference
   * and a count of people, nothing more.
   */
  primaryParticipantId: string
  secondaryParticipantId: string | null
}

/**
 * One selected entry in the reserve half of the same draw.
 *
 * `selectionOrder` continues straight on from the winners — reserve 1 is the
 * selection immediately after the last winner — because there was only ever one
 * sample. It is *not* derivable from the allocation any more: how many
 * selections the winning half took depends on how many of them were pairs. The
 * two numbers are kept apart because they answer different questions: the
 * selection order says where in the lottery this entry came out, and the reserve
 * position says who gets asked next.
 */
export interface SelectedReserve extends SelectedEntry {
  /** 1-based, the order reserves are called in. */
  reservePosition: number
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
  /** The pilgrims the whole pool could place. Always at least `2 * allocatedSpots`. */
  poolPilgrimCount: number
  totalWeight: number
  /**
   * The number of **pilgrim places** the commune allocated. The winners fill it
   * exactly and the reserves cover the same number again; neither half's entry
   * count is this number, and expecting it to be was the defect this replaced.
   */
  allocatedSpots: number
  /** The winning entries' pilgrims, summed. Exactly `allocatedSpots`. */
  winnerPilgrimCount: number
  /** The reserve entries' pilgrims, summed. Exactly `allocatedSpots` too. */
  reservePilgrimCount: number
  /** Which implementation produced this selection. Recorded with every result. */
  algorithmVersion: string
  /**
   * The winning entries, in the order they were drawn — however many it took to
   * fill the pilgrim quota, which is between `allocatedSpots / 2` and
   * `allocatedSpots` of them.
   */
  selected: SelectedEntry[]
  /**
   * The reserve list: the selections of the *same* sample that follow the last
   * winner, in the order they were drawn, covering the same number of pilgrim
   * places again.
   *
   * Not a second draw, not the losers sorted by weight, and not something
   * produced later when somebody drops out. The ordering a replacement will
   * follow months from now was fixed by the same random values that chose the
   * winners, at the same moment, and is recorded alongside them.
   */
  reserves: SelectedReserve[]
  /**
   * Every application in the pool, selected or not — the authoritative list of
   * who actually took part in this draw. Winner processing finalizes exactly
   * these and records participation for exactly these people.
   */
  pooledApplicationIds: string[]
  events: SelectionEvent[]
  selectedAt: string
}

/**
 * The lottery engine's one consumer of the frozen draw pool.
 *
 * It reads a `LOCKED` commune draw's immutable pool, draws from it with a
 * cryptographically secure random source, and returns the selected entries in
 * order. That is all it does.
 *
 * A commune with N pilgrim places draws 2N *places* in one continuous sample:
 * the first N are filled by the winners, the next N by the reserves, in the
 * order they came out. **Places, not applications** — the unit of selection is
 * an application carrying one or two pilgrims, and the unit of capacity is a
 * pilgrim, so a twelve place commune may produce eleven winning applications
 * and still fill twelve places exactly. At each step only the applications that
 * fit entirely inside the remaining capacity may be drawn, which is what keeps
 * a paired registration from ever being split; see docs/pilgrim-capacity.md.
 *
 * The split between the halves is a slice of one result, not two draws — which
 * is what makes the reserve order provably the lottery's rather than somebody's
 * arrangement of the people who did not win. Nothing sorts the remainder by
 * weight, and nothing regenerates a reserve list later; see
 * docs/reserves-and-replacements.md. It writes nothing: no winners, no `has_won_hajj`,
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
   * Draws this commune draw's places *and its reserve list* from the frozen
   * pool — one sample, twice the allocation in pilgrim places — and persists
   * nothing.
   *
   * Reads only. Every refusal happens before a single random number is drawn,
   * so a draw either runs against a complete, verified snapshot or does not run
   * at all. A selection produced here is not a result: recording one is
   * `DrawExecutionService`'s job, and it calls `drawFrom` below instead.
   */
  async selectFromPool(communeDrawId: string): Promise<DrawSelection> {
    const communeDraw = await drawConfigurationService.findCommuneDraw(communeDrawId)
    if (!communeDraw) throw new NotFoundError('COMMUNE_DRAW_NOT_FOUND', 'Commune draw not found')

    // LOCKED is the only state whose input cannot still change. A DRAFT or
    // READY commune draw is still accepting applications and can still be
    // reallocated; a CANCELLED one is not holding a lottery at all, and a
    // COMPLETED one has already been drawn.
    if (communeDraw.status !== 'LOCKED') {
      throw new ConflictError(
        'DRAW_NOT_LOCKED',
        `A draw can only be run against a locked commune draw, and this one is ${communeDraw.status}`,
      )
    }

    return this.drawFrom(communeDraw, this.db)
  }

  /**
   * Draws from a commune draw whose lifecycle the caller has already settled,
   * reading through the client it is given.
   *
   * Winner processing passes its own transaction client, so the pool is read,
   * verified and drawn from inside the same transaction that writes the result —
   * there is no window in which the snapshot could be seen differently by the
   * verification and by the draw.
   *
   * The caller owns the state check, because by the time execution reaches here
   * it has already claimed the commune draw and moved it out of LOCKED. That
   * claim is the proof the draw was legitimate; re-reading the status now would
   * see the claim itself and refuse.
   */
  async drawFrom(communeDraw: CommuneDrawWithPlace, db: LotteryReader): Promise<DrawSelection> {
    const pool = await db.drawPool.findUnique({
      where: { communeDrawId: communeDraw.id },
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

    // The allocation is a number of *pilgrim places*, not of applications. The
    // winners fill it exactly, and the reserve list covers the same number of
    // places again — drawn as one continuous sample, because a reserve list
    // assembled afterwards, however honestly, could not be shown to have been.
    const pilgrimQuota = pool.allocatedSpots
    const requiredPilgrims = totalDrawPilgrimQuota(pilgrimQuota)

    // The algorithm sees each entry through the three fields it may act on —
    // identity, weight, and how many places it occupies — and hands the whole
    // row back. `pilgrimCount` is derived from the frozen `entryType`, so it is
    // part of the immutable input the snapshot hash already covers.
    const candidates = pool.entries.map((entry) => ({
      ...entry,
      pilgrimCount: pilgrimCountOf(entry.entryType),
    }))
    const poolPilgrimCount = candidates.reduce((sum, entry) => sum + entry.pilgrimCount, 0)

    // A pool that cannot supply both halves is refused, never truncated —
    // counted in pilgrims, since that is what a place is measured in. A pool of
    // 2N *entries* can hold anywhere from 2N to 4N places, and only this figure
    // says whether a draw and its reserve list can both be filled. Freezing
    // still permits an undersubscribed pool: whether such a commune should draw
    // at all is a policy question the engine will not answer silently.
    if (poolPilgrimCount < requiredPilgrims) {
      throw new ConflictError(
        'INSUFFICIENT_DRAW_ENTRIES',
        `This pool's ${pool.entryCount} applications cover ${poolPilgrimCount} pilgrim place(s); ` +
          `a draw for ${pilgrimQuota} place(s) needs ${requiredPilgrims} — ${pilgrimQuota} for the ` +
          `winners and ${pilgrimQuota} for the reserves`,
      )
    }

    // One call, one continuous sample without replacement. The two quotas are
    // where the sample is cut, not a second draw: selection numbering runs
    // straight through, and a pair that could not fit the last winning place is
    // a full candidate again for the reserve quota, which starts with its own
    // capacity.
    const selection = (() => {
      try {
        return weightedCapacitySample(candidates, [pilgrimQuota, pilgrimQuota], this.random)
      } catch (error) {
        // The one failure the domain has to name: a single place left and every
        // remaining application a pair. Nothing is split, nothing overspent,
        // and nothing is written — the commune draw stays LOCKED.
        if (error instanceof UnfillableQuotaError) {
          throw new ConflictError(
            'QUOTA_NOT_EXACTLY_FILLABLE',
            `${error.message}. Retrying draws a fresh sample; a pool with more single applicants ` +
              'is what makes an exact fill reliably reachable.',
          )
        }
        throw error
      }
    })()

    const [winningEntries = [], reserveEntries = []] = selection.phases

    const drawn = [...winningEntries, ...reserveEntries].map((entry, index) => ({
      drawPoolEntryId: entry.id,
      applicationId: entry.applicationId,
      applicationReference: entry.applicationReference,
      entryType: entry.entryType,
      weight: entry.weight,
      pilgrimCount: entry.pilgrimCount,
      selectionOrder: index + 1,
      primaryParticipantId: entry.primaryParticipantId,
      secondaryParticipantId: entry.secondaryParticipantId,
    }))

    const selected = drawn.slice(0, winningEntries.length)
    const reserves = drawn.slice(winningEntries.length).map((entry, index) => ({
      ...entry,
      reservePosition: index + 1,
    }))

    const winnerPilgrimCount = pilgrimsOf(selected)
    const reservePilgrimCount = pilgrimsOf(reserves)

    // The algorithm fills each quota exactly or throws, so neither of these can
    // disagree. Asserted because a draw that placed the wrong number of people
    // would be indistinguishable from a correct one afterwards, and this is the
    // last moment before winner processing starts writing.
    if (winnerPilgrimCount !== pilgrimQuota || reservePilgrimCount !== pilgrimQuota) {
      throw new ApiError(
        500,
        'INTERNAL_ERROR',
        `A draw for ${pilgrimQuota} places selected ${winnerPilgrimCount} winning and ` +
          `${reservePilgrimCount} reserve pilgrims`,
      )
    }

    return {
      communeDrawId: communeDraw.id,
      drawPoolId: pool.id,
      drawYear: communeDraw.drawYear.year,
      communeCode: communeDraw.commune.code,
      snapshotHash: pool.snapshotHash,
      entryCount: pool.entryCount,
      poolPilgrimCount,
      totalWeight: pool.totalWeight,
      allocatedSpots: pool.allocatedSpots,
      winnerPilgrimCount,
      reservePilgrimCount,
      algorithmVersion: LOTTERY_ALGORITHM_VERSION,
      selected,
      reserves,
      pooledApplicationIds: pool.entries.map((entry) => entry.applicationId),
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
      pilgrimCount: number
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

    // The capacity aggregate, checked exactly like the other two. The draw's
    // quota is spent against this figure, so a pool whose stored pilgrim count
    // disagreed with its entries could place the wrong number of people while
    // every other check passed.
    const loadedPilgrims = pool.entries.reduce((sum, entry) => sum + pilgrimCountOf(entry.entryType), 0)
    if (loadedPilgrims !== pool.pilgrimCount) {
      refuse(`its entries cover ${loadedPilgrims} pilgrim places, not the recorded ${pool.pilgrimCount}`)
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

/** The pilgrim places a set of drawn entries occupies. */
function pilgrimsOf(entries: readonly { pilgrimCount: number }[]): number {
  return entries.reduce((sum, entry) => sum + entry.pilgrimCount, 0)
}

export const lotteryService = new LotteryService()
