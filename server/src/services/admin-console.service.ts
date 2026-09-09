import {
  ADMIN_PAGE_SIZE_DEFAULT,
  ADMIN_PAGE_SIZE_MAX,
  type AdminScopeKind,
  type DashboardCountsDto,
  type DashboardGovernanceDto,
} from '@hajj-lottery/shared'
import {
  AdminRole,
  ApplicationStatus,
  CommuneDrawStatus,
  DrawYearStatus,
  EntryType,
  ImportBatchStatus,
  ApprovalStatus,
  ReserveStatus,
  type Application,
  type ApplicationParticipant,
  type Commune,
  type DrawYear,
  type Participant,
  type Prisma,
  type PrismaClient,
  type User,
  type Wilaya,
} from '@prisma/client'

import { prisma as defaultPrisma } from '../lib/prisma.js'
import { communeScopeFilter, resolveScope, intersectFilters } from '../lib/scope.js'

/** An application with everything the console renders alongside it. */
export type ApplicationWithPlace = Application & {
  commune: Commune & { wilaya: Wilaya }
}

export type ApplicationWithApplicants = ApplicationWithPlace & {
  participants: (ApplicationParticipant & { participant: Participant })[]
}

/** What the applications table may be narrowed by. Filters only ever remove rows. */
export interface ApplicationFilters {
  drawYear?: number
  wilayaId?: string
  communeId?: string
  status?: ApplicationStatus
  entryType?: EntryType
  /** An exact receipt reference. Not a prefix search — see `listApplications`. */
  applicationReference?: string
  page?: number
  pageSize?: number
}

export interface ParticipantFilters {
  /** Matches a name fragment, case-insensitively. */
  name?: string
  /** An exact canonical national ID. Never a prefix. */
  nationalId?: string
  hasWonHajj?: boolean
  page?: number
  pageSize?: number
}

export interface Page<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface DashboardReading {
  scope: AdminScopeKind
  wilaya: Wilaya | null
  commune: Commune | null
  drawYear: DrawYear | null
  counts: DashboardCountsDto
  governance: DashboardGovernanceDto | null
  generatedAt: Date
}

const EMPTY_COUNTS: DashboardCountsDto = {
  communeDraws: 0,
  draftDraws: 0,
  readyDraws: 0,
  lockedDraws: 0,
  completedDraws: 0,
  cancelledDraws: 0,
  allocatedSpots: 0,
  applications: 0,
  eligibleApplications: 0,
  ineligibleApplications: 0,
  publishedResults: 0,
  unpublishedResults: 0,
  withdrawnWinners: 0,
  reservesAwaitingDecision: 0,
}

/** Clamps a requested page size into the range the API will serve. */
function boundedPaging(page: number | undefined, pageSize: number | undefined) {
  const size = Math.min(Math.max(pageSize ?? ADMIN_PAGE_SIZE_DEFAULT, 1), ADMIN_PAGE_SIZE_MAX)
  const current = Math.max(page ?? 1, 1)
  return { skip: (current - 1) * size, take: size, page: current, pageSize: size }
}

function paged<T>(items: T[], total: number, page: number, pageSize: number): Page<T> {
  return { items, page, pageSize, total, totalPages: Math.max(Math.ceil(total / pageSize), 1) }
}

/**
 * The aggregate reads behind the administrative console.
 *
 * Two rules hold throughout, and they are the reason this is a service rather
 * than a handful of client-side loops.
 *
 * **Scope is part of every query.** Each read starts from
 * `communeScopeFilter` and intersects it with whatever the request asked for,
 * so a filter can only narrow. Nothing is fetched and then checked, and
 * forgetting the ceiling would change the result rather than quietly skip an
 * `if`.
 *
 * **Nothing here decides anything.** These are counts and lists of facts other
 * services wrote. No eligibility is evaluated, no weight computed, no
 * lifecycle advanced; a dashboard that recomputed a domain value would be a
 * second, disagreeing implementation of it.
 */
export class AdminConsoleService {
  private readonly db: PrismaClient

  constructor(db: PrismaClient = defaultPrisma) {
    this.db = db
  }

  /**
   * The operational summary for one administrator's territory.
   *
   * Reported for a single draw year — the open one if registration is running,
   * otherwise the most recent, because after a cycle closes the year people are
   * still working on is the one that just ended. Counts from different years
   * summed together would answer no question at all.
   */
  async dashboard(user: User): Promise<DashboardReading> {
    const scope = resolveScope(user)
    const communeCeiling = communeScopeFilter(scope)

    const [wilaya, commune, drawYear] = await Promise.all([
      scope.kind === 'national'
        ? Promise.resolve(null)
        : this.db.wilaya.findUnique({ where: { id: scope.wilayaId } }),
      scope.kind === 'commune'
        ? this.db.commune.findUnique({ where: { id: scope.communeId } })
        : Promise.resolve(null),
      this.currentDrawYear(),
    ])

    const kind: AdminScopeKind =
      scope.kind === 'national' ? 'NATIONAL' : scope.kind === 'wilaya' ? 'WILAYA' : 'COMMUNE'

    const governance = user.role === AdminRole.SUPER_ADMIN ? await this.governanceQueues() : null

    if (!drawYear) {
      return {
        scope: kind,
        wilaya,
        commune,
        drawYear: null,
        counts: EMPTY_COUNTS,
        governance,
        generatedAt: new Date(),
      }
    }

    const counts = await this.countsFor(drawYear, communeCeiling)

    return { scope: kind, wilaya, commune, drawYear, counts, governance, generatedAt: new Date() }
  }

  /**
   * The year the console is about: the one accepting registrations, or the
   * latest configured year when none is open. A partial unique index makes the
   * first query return at most one row.
   */
  private async currentDrawYear(): Promise<DrawYear | null> {
    const open = await this.db.drawYear.findFirst({
      where: { status: DrawYearStatus.REGISTRATION_OPEN },
    })
    if (open) return open

    return this.db.drawYear.findFirst({ orderBy: { year: 'desc' } })
  }

  private async governanceQueues(): Promise<DashboardGovernanceDto> {
    const [pendingImports, pendingApprovals] = await Promise.all([
      this.db.importBatch.count({ where: { status: ImportBatchStatus.READY_FOR_REVIEW } }),
      this.db.approvalRequest.count({ where: { status: ApprovalStatus.PENDING } }),
    ])
    return { pendingImports, pendingApprovals }
  }

  private async countsFor(
    drawYear: DrawYear,
    communeCeiling: Prisma.CommuneWhereInput,
  ): Promise<DashboardCountsDto> {
    const drawsInScope = { drawYearId: drawYear.id, commune: communeCeiling }
    // A result belongs to a commune draw, which belongs to a commune — so the
    // ceiling nests rather than being compared against a column here.
    const resultsInScope = { communeDraw: drawsInScope }

    const [
      drawGroups,
      allocation,
      applicationGroups,
      applications,
      publishedResults,
      completedResults,
      withdrawnWinners,
      reservesAwaitingDecision,
    ] = await Promise.all([
      this.db.communeDraw.groupBy({ by: ['status'], where: drawsInScope, _count: { _all: true } }),
      this.db.communeDraw.aggregate({ where: drawsInScope, _sum: { allocatedSpots: true } }),
      this.db.application.groupBy({
        by: ['status'],
        where: { drawYear: drawYear.year, commune: communeCeiling },
        _count: { _all: true },
      }),
      this.db.application.count({ where: { drawYear: drawYear.year, commune: communeCeiling } }),
      this.db.drawResult.count({ where: { ...resultsInScope, publication: { isNot: null } } }),
      this.db.drawResult.count({ where: resultsInScope }),
      this.db.winnerAbandonment.count({ where: { drawWinner: { drawResult: resultsInScope } } }),
      this.db.drawReserve.count({
        where: { status: ReserveStatus.CALLED, drawResult: resultsInScope },
      }),
    ])

    const drawsBy = (status: CommuneDrawStatus) =>
      drawGroups.find((group) => group.status === status)?._count._all ?? 0
    const applicationsBy = (status: ApplicationStatus) =>
      applicationGroups.find((group) => group.status === status)?._count._all ?? 0

    return {
      communeDraws: drawGroups.reduce((total, group) => total + group._count._all, 0),
      draftDraws: drawsBy(CommuneDrawStatus.DRAFT),
      readyDraws: drawsBy(CommuneDrawStatus.READY),
      lockedDraws: drawsBy(CommuneDrawStatus.LOCKED),
      completedDraws: drawsBy(CommuneDrawStatus.COMPLETED),
      cancelledDraws: drawsBy(CommuneDrawStatus.CANCELLED),
      allocatedSpots: allocation._sum.allocatedSpots ?? 0,
      applications,
      eligibleApplications: applicationsBy(ApplicationStatus.ELIGIBLE),
      ineligibleApplications: applicationsBy(ApplicationStatus.INELIGIBLE),
      publishedResults,
      unpublishedResults: completedResults - publishedResults,
      withdrawnWinners,
      reservesAwaitingDecision,
    }
  }

  /**
   * One page of applications in the caller's territory.
   *
   * The reference filter is an equality test rather than a prefix or substring
   * match. A receipt is deliberately opaque and unguessable; letting somebody
   * type three characters and page through everything that starts with them
   * would turn the table into the enumeration oracle the reference was
   * designed to prevent.
   */
  async listApplications(user: User, filters: ApplicationFilters = {}): Promise<Page<ApplicationWithPlace>> {
    const ceiling = communeScopeFilter(resolveScope(user))
    const narrowing: { id?: string; wilayaId?: string } = {
      ...(filters.wilayaId ? { wilayaId: filters.wilayaId } : {}),
      ...(filters.communeId ? { id: filters.communeId } : {}),
    }

    const where: Prisma.ApplicationWhereInput = {
      commune: intersectFilters(ceiling, narrowing),
      ...(filters.drawYear === undefined ? {} : { drawYear: filters.drawYear }),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.entryType ? { entryType: filters.entryType } : {}),
      ...(filters.applicationReference ? { applicationReference: filters.applicationReference } : {}),
    }

    const { skip, take, page, pageSize } = boundedPaging(filters.page, filters.pageSize)

    const [items, total] = await Promise.all([
      this.db.application.findMany({
        where,
        include: { commune: { include: { wilaya: true } } },
        // Newest first, with an id tie-break so paging is stable when many
        // applications share a timestamp — which they will, at a deadline.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.db.application.count({ where }),
    ])

    return paged(items, total, page, pageSize)
  }

  /** One application with its applicants, or null when out of scope or absent. */
  async findApplication(user: User, applicationId: string): Promise<ApplicationWithApplicants | null> {
    const ceiling = communeScopeFilter(resolveScope(user))

    return this.db.application.findFirst({
      where: { id: applicationId, commune: ceiling },
      include: {
        commune: { include: { wilaya: true } },
        participants: { include: { participant: true }, orderBy: { role: 'asc' } },
      },
    })
  }

  /**
   * One page of the identity registry. Route-gated to SUPER_ADMIN.
   *
   * A participant has no commune, so there is no scope to apply — which is
   * exactly why no scoped administrator may reach this at all. The national ID
   * filter is an equality test on the canonical form: a prefix search here
   * would let somebody discover which IDs exist by typing digits.
   */
  async listParticipants(filters: ParticipantFilters = {}): Promise<Page<Participant>> {
    const where: Prisma.ParticipantWhereInput = {
      ...(filters.name ? { fullName: { contains: filters.name, mode: 'insensitive' } } : {}),
      ...(filters.nationalId ? { nationalId: filters.nationalId } : {}),
      ...(filters.hasWonHajj === undefined ? {} : { hasWonHajj: filters.hasWonHajj }),
    }

    const { skip, take, page, pageSize } = boundedPaging(filters.page, filters.pageSize)

    const [items, total] = await Promise.all([
      this.db.participant.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.db.participant.count({ where }),
    ])

    return paged(items, total, page, pageSize)
  }
}

export const adminConsoleService = new AdminConsoleService()
