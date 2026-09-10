import type {
  PublicDrawStatusDto,
  PublicPageDto,
  PublicPlatformStatsDto,
  PublicResultDto,
  PublicResultSummaryDto,
} from '@hajj-lottery/shared'
import type { Prisma, PrismaClient } from '@prisma/client'

import { prisma as defaultPrisma } from '../lib/prisma.js'
import { toPublicPage, toPublicPlace, toPublicReserve, toPublicWinner } from '../lib/public-dto.js'
import { toPublicDrawPhase } from '../lib/public-status.js'

/** What a public listing may be narrowed by. Codes, never internal ids. */
export interface PublicGeographicFilters {
  drawYear?: number | undefined
  wilayaCode?: string | undefined
  communeCode?: string | undefined
  page: number
  pageSize: number
}

/**
 * The read-only public surface: official results, and where each commune's draw
 * stands.
 *
 * Two constraints shape every query here, and they pull the same way.
 *
 * **Privacy.** Nothing in this service loads a participant, a national ID, a
 * phone number, a date of birth, a weight or a pool entry's identity columns.
 * The published winner list is assembled from selection order, application
 * reference and entry type, and that is the entire set of columns it touches.
 *
 * **Traffic.** These are the endpoints that get hit by everybody in the country
 * within the same ten minutes, twice a year. So: every listing is paginated with
 * a server-enforced cap, every filter lands on an index, the published totals
 * are read from the publication row rather than aggregated per request, and
 * nothing walks a relation per row. A page of results is two queries — a window
 * and a count — regardless of how many communes have published.
 */
export class PublicResultsService {
  private readonly db: PrismaClient

  constructor(db: PrismaClient = defaultPrisma) {
    this.db = db
  }

  /**
   * A page of published results, most recently announced first.
   *
   * Ordered by recency rather than by geographic code deliberately. Wilaya and
   * commune codes are official numbers stored as text, so `ORDER BY code` gives
   * 1, 10, 11 … 2, and this codebase corrects that in the application
   * (`lib/geo-order.ts`) because Prisma cannot cast inside `orderBy`. That
   * correction is incompatible with pagination: sorting after `take` reorders
   * rows within a page and shuffles them between pages. Recency is a stable SQL
   * order, it paginates correctly, and it is what a public results feed should
   * lead with anyway. Callers wanting one commune ask for that commune.
   */
  async listResults(filters: PublicGeographicFilters): Promise<PublicPageDto<PublicResultSummaryDto>> {
    const where = this.publicationFilter(filters)

    const [rows, total] = await Promise.all([
      this.db.resultPublication.findMany({
        where,
        select: {
          drawYear: true,
          allocatedSpots: true,
          winnerCount: true,
          winningParticipantCount: true,
          publishedAt: true,
          commune: {
            select: {
              code: true,
              nameAr: true,
              nameFr: true,
              nameEn: true,
              wilaya: { select: { code: true, nameAr: true, nameFr: true, nameEn: true } },
            },
          },
        },
        // `id` breaks ties so the order is total: two communes published in the
        // same millisecond must not swap places between two requests, or a
        // reader paging through would see one twice and miss the other.
        orderBy: [{ drawYear: 'desc' }, { publishedAt: 'desc' }, { id: 'asc' }],
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.db.resultPublication.count({ where }),
    ])

    const items = rows.map((row): PublicResultSummaryDto => ({
      drawYear: row.drawYear,
      wilaya: toPublicPlace(row.commune.wilaya),
      commune: toPublicPlace(row.commune),
      allocatedSpots: row.allocatedSpots,
      winnerCount: row.winnerCount,
      winningParticipantCount: row.winningParticipantCount,
      publishedAt: row.publishedAt.toISOString(),
    }))

    return toPublicPage(items, total, filters.page, filters.pageSize)
  }

  /**
   * One commune's published result in full, or null.
   *
   * Null for a commune that never ran a draw, one whose draw is not published,
   * and one whose code does not exist — the same answer to all three, so this
   * route cannot be used to discover which communes have drawn but not yet
   * announced.
   *
   * The winner list is returned whole rather than paginated. It is bounded by
   * the commune's frozen allocation, which is configuration rather than a
   * function of demand, and an official result served a page at a time is not an
   * official result. It is also the most cacheable response in the system — a
   * published result never changes — so the expensive case is served once.
   */
  async findResult(
    drawYear: number,
    wilayaCode: string,
    communeCode: string,
  ): Promise<PublicResultDto | null> {
    const publication = await this.db.resultPublication.findFirst({
      where: { drawYear, commune: { code: communeCode, wilaya: { code: wilayaCode } } },
      select: {
        drawYear: true,
        allocatedSpots: true,
        entryCount: true,
        winnerCount: true,
        winningParticipantCount: true,
        publishedAt: true,
        commune: {
          select: {
            code: true,
            nameAr: true,
            nameFr: true,
            nameEn: true,
            wilaya: { select: { code: true, nameAr: true, nameFr: true, nameEn: true } },
          },
        },
        drawResult: {
          select: {
            poolHash: true,
            algorithmVersion: true,
            completedAt: true,
            winners: {
              // Exactly three columns, two of them from the frozen entry, plus
              // the *existence* of an abandonment. No participant id is loaded,
              // so `participantCount` is derived from the entry type and nothing
              // identifying is ever in memory — and the abandonment's reason and
              // explanation are not selected at all, so no query on this route
              // can put a death or an illness within reach of a response.
              select: {
                selectionOrder: true,
                drawPoolEntry: { select: { applicationReference: true, entryType: true } },
                abandonment: { select: { id: true } },
              },
              // The order the entries were drawn in, as persisted. Nothing is
              // re-run, re-sorted or recomputed to publish a result.
              orderBy: { selectionOrder: 'asc' },
            },
            // The reserve list, in the order the same draw produced it. Its
            // lifecycle status is public in the coarse form `toPublicReserve`
            // maps it to; who was asked, when, and about which place is not.
            reserves: {
              select: {
                reservePosition: true,
                selectionOrder: true,
                status: true,
                drawPoolEntry: { select: { applicationReference: true, entryType: true } },
              },
              orderBy: { reservePosition: 'asc' },
            },
          },
        },
      },
    })

    if (!publication) return null

    return {
      drawYear: publication.drawYear,
      wilaya: toPublicPlace(publication.commune.wilaya),
      commune: toPublicPlace(publication.commune),
      allocatedSpots: publication.allocatedSpots,
      entryCount: publication.entryCount,
      winnerCount: publication.winnerCount,
      winningParticipantCount: publication.winningParticipantCount,
      poolHash: publication.drawResult.poolHash,
      algorithmVersion: publication.drawResult.algorithmVersion,
      drawnAt: publication.drawResult.completedAt.toISOString(),
      publishedAt: publication.publishedAt.toISOString(),
      winners: publication.drawResult.winners.map((winner) =>
        toPublicWinner({
          selectionOrder: winner.selectionOrder,
          applicationReference: winner.drawPoolEntry.applicationReference,
          entryType: winner.drawPoolEntry.entryType,
          abandoned: winner.abandonment !== null,
        }),
      ),
      reserves: publication.drawResult.reserves.map((reserve) =>
        toPublicReserve({
          reservePosition: reserve.reservePosition,
          selectionOrder: reserve.selectionOrder,
          applicationReference: reserve.drawPoolEntry.applicationReference,
          entryType: reserve.drawPoolEntry.entryType,
          status: reserve.status,
        }),
      ),
    }
  }

  /**
   * A page of commune draw states.
   *
   * Carries no applicant count of any kind. During intake that number is live
   * and privacy-adjacent — a commune with three applicants and twelve places has
   * told everybody something about three identifiable households — and after the
   * draw the number that matters is the frozen entry count, which belongs to the
   * published result rather than to a status page.
   *
   * `winnerCount` is null until publication rather than zero, so "nobody won" and
   * "you may not know yet" cannot be confused.
   */
  async listDrawStatus(filters: PublicGeographicFilters): Promise<PublicPageDto<PublicDrawStatusDto>> {
    const where: Prisma.CommuneDrawWhereInput = {
      ...(filters.drawYear === undefined ? {} : { drawYear: { year: filters.drawYear } }),
      commune: {
        isActive: true,
        ...(filters.communeCode === undefined ? {} : { code: filters.communeCode }),
        ...(filters.wilayaCode === undefined ? {} : { wilaya: { code: filters.wilayaCode } }),
      },
    }

    const [rows, total] = await Promise.all([
      this.db.communeDraw.findMany({
        where,
        select: {
          allocatedSpots: true,
          status: true,
          drawYear: { select: { year: true, status: true } },
          commune: {
            select: {
              code: true,
              nameAr: true,
              nameFr: true,
              nameEn: true,
              wilaya: { select: { code: true, nameAr: true, nameFr: true, nameEn: true } },
            },
          },
          // One nested select, batched by Prisma across the page rather than
          // issued per row. Only the count is read — a draw status page never
          // touches a winner, an entry or a participant.
          result: { select: { publication: { select: { winnerCount: true } } } },
        },
        orderBy: [{ drawYear: { year: 'desc' } }, { id: 'asc' }],
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.db.communeDraw.count({ where }),
    ])

    const items = rows.map((row): PublicDrawStatusDto => {
      const publication = row.result?.publication ?? null

      return {
        drawYear: row.drawYear.year,
        registrationOpen: row.drawYear.status === 'REGISTRATION_OPEN',
        wilaya: toPublicPlace(row.commune.wilaya),
        commune: toPublicPlace(row.commune),
        allocatedSpots: row.allocatedSpots,
        phase: toPublicDrawPhase(row.status),
        resultsPublished: publication !== null,
        winnerCount: publication?.winnerCount ?? null,
      }
    })

    return toPublicPage(items, total, filters.page, filters.pageSize)
  }

  /**
   * Platform-wide scale for the landing page: how many wilayas and communes
   * the reference dataset covers, and the total Hajj places this platform has
   * ever configured across every commune draw, any year, any status.
   *
   * Three cheap aggregate queries, nothing scoped to a caller and nothing
   * privacy-adjacent — a wilaya/commune count and a sum of a figure
   * (`allocated_spots`) that is already public per commune via
   * `listDrawStatus`. `allocated_spots` is configuration, set once a
   * `CommuneDraw` is created, so a cancelled or still-open draw counts the
   * same as a completed one: this is committed capacity, not an outcome.
   */
  async getPlatformStats(): Promise<PublicPlatformStatsDto> {
    const [totalWilayas, totalCommunes, spots] = await Promise.all([
      this.db.wilaya.count({ where: { isActive: true } }),
      this.db.commune.count({ where: { isActive: true } }),
      this.db.communeDraw.aggregate({ _sum: { allocatedSpots: true } }),
    ])

    return {
      totalWilayas,
      totalCommunes,
      totalAllocatedSpots: spots._sum.allocatedSpots ?? 0,
    }
  }

  /**
   * The filter every result listing shares.
   *
   * An unknown code matches nothing rather than raising: a public caller must
   * not be able to tell "no such wilaya" from "no results published there yet",
   * and the reference data they would learn from the difference is served whole
   * by `/api/wilayas` anyway.
   */
  private publicationFilter(filters: PublicGeographicFilters): Prisma.ResultPublicationWhereInput {
    const commune = {
      ...(filters.communeCode === undefined ? {} : { code: filters.communeCode }),
      ...(filters.wilayaCode === undefined ? {} : { wilaya: { code: filters.wilayaCode } }),
    }

    return {
      ...(filters.drawYear === undefined ? {} : { drawYear: filters.drawYear }),
      ...(Object.keys(commune).length === 0 ? {} : { commune }),
    }
  }
}

export const publicResultsService = new PublicResultsService()
