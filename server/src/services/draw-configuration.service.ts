import type { CommuneDrawStatus, DrawYearStatus } from '@hajj-lottery/shared'
import {
  Prisma,
  type Commune,
  type CommuneDraw,
  type DrawYear,
  type PrismaClient,
  type Wilaya,
} from '@prisma/client'

import {
  allowsSpotChanges,
  canTransitionCommuneDraw,
  canTransitionDrawYear,
  isAdministrativelySettable,
} from '../lib/draw-lifecycle.js'
import { ConflictError, NotFoundError } from '../lib/errors.js'
import { sortByCode } from '../lib/geo-order.js'
import { prisma as defaultPrisma } from '../lib/prisma.js'

/** A commune draw with the geography needed to present or authorize it. */
export type CommuneDrawWithPlace = CommuneDraw & {
  drawYear: DrawYear
  commune: Commune & { wilaya: Wilaya }
}

export interface CreateCommuneDrawInput {
  drawYearId: string
  communeId: string
  allocatedSpots: number
}

export interface UpdateCommuneDrawInput {
  allocatedSpots?: number
  status?: CommuneDrawStatus
}

/**
 * The annual draw configuration: which year is running, and how many places
 * each commune has.
 *
 * Allocation is *configuration*, never a calculation. Nothing here counts
 * applicants, reads population figures or looks at past winners — an official
 * decides how many places a commune gets, and this records the decision. A
 * commune with 843 eligible applications for 12 places is the ordinary case,
 * and so is one with 100 places and 20 applicants.
 *
 * Geographic authorization is not here. Reads go through AuthorizationService,
 * where scope is a query filter; writes are SUPER_ADMIN-only and gated at the
 * route.
 */
export class DrawConfigurationService {
  private readonly db: PrismaClient

  constructor(db: PrismaClient = defaultPrisma) {
    this.db = db
  }

  // --- The national cycle -------------------------------------------------

  /**
   * The year citizens are currently applying for, or null when none is open.
   *
   * A partial unique index permits at most one REGISTRATION_OPEN row, so this
   * question has one answer or none — never two.
   */
  async activeDrawYear(): Promise<DrawYear | null> {
    return this.db.drawYear.findFirst({ where: { status: 'REGISTRATION_OPEN' } })
  }

  /**
   * The year to judge "is this in the future?" against, for records that are
   * about years rather than about registration — the participation ledger, and
   * the streak's target.
   *
   * The latest configured year, falling back to the calendar year when nothing
   * is configured at all, so a fresh installation still refuses history for
   * years that have not happened.
   */
  async referenceDrawYear(): Promise<number> {
    const latest = await this.db.drawYear.findFirst({ orderBy: { year: 'desc' } })

    return latest?.year ?? new Date().getUTCFullYear()
  }

  async listDrawYears(): Promise<(DrawYear & { _count: { communeDraws: number } })[]> {
    return this.db.drawYear.findMany({
      orderBy: { year: 'desc' },
      include: { _count: { select: { communeDraws: true } } },
    })
  }

  async findDrawYear(year: number): Promise<(DrawYear & { _count: { communeDraws: number } }) | null> {
    return this.db.drawYear.findUnique({
      where: { year },
      include: { _count: { select: { communeDraws: true } } },
    })
  }

  /**
   * Creates a cycle for a calendar year. Always DRAFT: opening registration is
   * a separate, deliberate act.
   */
  async createDrawYear(year: number): Promise<DrawYear> {
    try {
      return await this.db.drawYear.create({ data: { year } })
    } catch (error) {
      // The unique index decides, not a prior read, so two simultaneous
      // creations of the same year resolve to one row.
      if (isUniqueViolation(error)) {
        throw new ConflictError('DUPLICATE_DRAW_YEAR', 'That draw year already exists')
      }
      throw error
    }
  }

  /**
   * Moves a cycle to a new state, if the lifecycle permits it.
   *
   * The "only one year open" rule is enforced by the database rather than by
   * checking first: opening a second year violates the partial unique index,
   * which is what makes it hold under concurrent requests too.
   */
  async updateDrawYearStatus(id: string, status: DrawYearStatus): Promise<DrawYear> {
    const existing = await this.db.drawYear.findUnique({ where: { id } })
    if (!existing) throw new NotFoundError('DRAW_YEAR_NOT_FOUND', 'Draw year not found')

    if (existing.status === status) return existing

    if (!canTransitionDrawYear(existing.status, status)) {
      throw new ConflictError(
        'INVALID_STATUS_TRANSITION',
        `A draw year cannot move from ${existing.status} to ${status}`,
      )
    }

    try {
      return await this.db.drawYear.update({ where: { id }, data: { status } })
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError(
          'REGISTRATION_ALREADY_OPEN',
          'Another draw year is already open for registration',
        )
      }
      throw error
    }
  }

  // --- One commune's draw -------------------------------------------------

  async findCommuneDraw(id: string): Promise<CommuneDrawWithPlace | null> {
    return this.db.communeDraw.findUnique({
      where: { id },
      include: { drawYear: true, commune: { include: { wilaya: true } } },
    })
  }

  /**
   * The configuration a citizen's chosen commune must have to accept an
   * application, looked up by the pair that identifies it.
   */
  async findCommuneDrawFor(drawYearId: string, communeId: string): Promise<CommuneDraw | null> {
    return this.db.communeDraw.findUnique({
      where: { drawYearId_communeId: { drawYearId, communeId } },
    })
  }

  /**
   * Configures a commune's draw for a year.
   *
   * Both the year and the commune must already exist; this creates a
   * configuration, not geography. The commune determines its own wilaya, so
   * there is no wilaya to validate against and none is stored.
   */
  async createCommuneDraw(input: CreateCommuneDrawInput): Promise<CommuneDrawWithPlace> {
    const [drawYear, commune] = await Promise.all([
      this.db.drawYear.findUnique({ where: { id: input.drawYearId }, select: { id: true } }),
      this.db.commune.findUnique({ where: { id: input.communeId }, select: { id: true } }),
    ])

    if (!drawYear) throw new NotFoundError('DRAW_YEAR_NOT_FOUND', 'Draw year not found')
    if (!commune) throw new NotFoundError('COMMUNE_NOT_FOUND', 'Commune not found')

    try {
      return await this.db.communeDraw.create({
        data: {
          drawYearId: input.drawYearId,
          communeId: input.communeId,
          allocatedSpots: input.allocatedSpots,
        },
        include: { drawYear: true, commune: { include: { wilaya: true } } },
      })
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError(
          'DUPLICATE_COMMUNE_DRAW',
          'This commune already has a draw configured for that year',
        )
      }
      throw error
    }
  }

  /**
   * Changes a commune's allocation, its state, or both.
   *
   * Spots may only move while the draw is still configurable. Once it is
   * locked, the allocation is the published terms of a lottery — changing it
   * afterwards would alter a draw people have already been told about, so it
   * is refused for everyone, including whoever set it.
   */
  async updateCommuneDraw(id: string, changes: UpdateCommuneDrawInput): Promise<CommuneDrawWithPlace> {
    const existing = await this.db.communeDraw.findUnique({ where: { id } })
    if (!existing) throw new NotFoundError('COMMUNE_DRAW_NOT_FOUND', 'Commune draw not found')

    if (changes.allocatedSpots !== undefined && !allowsSpotChanges(existing.status)) {
      throw new ConflictError(
        'DRAW_CONFIGURATION_LOCKED',
        `Spot allocation cannot be changed once a commune draw is ${existing.status}`,
      )
    }

    // COMPLETED belongs to winner processing alone. Setting it here would
    // produce a draw that claims to have concluded with no winners to show, so
    // it is refused before the transition table is even consulted — the
    // transition itself is legal, but not from an administrator's hand.
    if (changes.status !== undefined && !isAdministrativelySettable(changes.status)) {
      throw new ConflictError(
        'INVALID_STATUS_TRANSITION',
        `A commune draw can only become ${changes.status} by executing its draw`,
      )
    }

    if (
      changes.status !== undefined &&
      changes.status !== existing.status &&
      !canTransitionCommuneDraw(existing.status, changes.status)
    ) {
      throw new ConflictError(
        'INVALID_STATUS_TRANSITION',
        `A commune draw cannot move from ${existing.status} to ${changes.status}`,
      )
    }

    return this.db.communeDraw.update({
      where: { id },
      data: {
        ...(changes.allocatedSpots === undefined ? {} : { allocatedSpots: changes.allocatedSpots }),
        ...(changes.status === undefined ? {} : { status: changes.status }),
      },
      include: { drawYear: true, commune: { include: { wilaya: true } } },
    })
  }

  /**
   * Orders a set of commune draws the way the rest of the application orders
   * geography — by commune code, numerically. See lib/geo-order.ts for why
   * that cannot be done in the query.
   */
  sortByCommuneCode(draws: CommuneDrawWithPlace[]): CommuneDrawWithPlace[] {
    const ordered = sortByCode(draws.map((draw) => ({ code: draw.commune.code, draw })))

    return ordered.map((entry) => entry.draw)
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

export const drawConfigurationService = new DrawConfigurationService()
