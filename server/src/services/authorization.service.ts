import {
  AUDIT_PAGE_SIZE_DEFAULT,
  AUDIT_PAGE_SIZE_MAX,
  IMPORT_ROW_PAGE_SIZE_DEFAULT,
  IMPORT_ROW_PAGE_SIZE_MAX,
  type AdminScopeDto,
  type ApprovalStatus,
  type AuditAction,
  type AuditTargetType,
  type CommuneDrawStatus,
  type ScopePlaceDto,
} from '@hajj-lottery/shared'
import type {
  Application,
  AuditLog,
  Commune,
  ImportBatch,
  ImportRow,
  ImportRowStatus,
  Prisma,
  PrismaClient,
  User,
  Wilaya,
} from '@prisma/client'

import {
  canAccessCommune,
  canAccessWilaya,
  communeScopeFilter,
  intersectFilters,
  resolveScope,
  wilayaScopeFilter,
  type AdminScope,
} from '../lib/scope.js'
import { sortByCode } from '../lib/geo-order.js'
import { boundedPaging, paged, type Page } from '../lib/pagination.js'
import { prisma as defaultPrisma } from '../lib/prisma.js'
import type { ApprovalRequestWithPlace } from './approval.service.js'
import type { CommuneDrawWithListState, CommuneDrawWithPlace } from './draw-configuration.service.js'
import type { ImportBatchWithUsers } from './legacy-import.service.js'
import type { HistoryRecordWithPlace } from './participation-history.service.js'

/** What the audit API may be narrowed by. A filter can only ever remove rows. */
export interface AuditLogFilters {
  action?: AuditAction
  actorUserId?: string
  targetType?: AuditTargetType
  targetId?: string
  wilayaId?: string
  communeId?: string
  from?: Date
  to?: Date
  page?: number
  pageSize?: number
}

/** One page of the trail, with the actor and geography needed to present it. */
export interface AuditLogPage {
  items: (AuditLog & {
    actor: Pick<User, 'id' | 'username'> | null
    wilaya: Wilaya | null
    commune: Commune | null
  })[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

/**
 * Geographic authorization.
 *
 * The pattern throughout: never "fetch, then check". Every read applies the
 * caller's scope as part of the query, so a row outside their reach simply
 * does not come back. That makes an out-of-scope resource indistinguishable
 * from one that does not exist (no id enumeration), and — more importantly —
 * makes it impossible to forget the check, because omitting the filter
 * changes what the query returns rather than merely skipping an `if`.
 */
export class AuthorizationService {
  private readonly db: PrismaClient

  constructor(db: PrismaClient = defaultPrisma) {
    this.db = db
  }

  /** The caller's authoritative reach, from their stored record only. */
  scopeFor(user: User): AdminScope {
    return resolveScope(user)
  }

  /**
   * Wilayas the caller may see, optionally narrowed by a requested filter.
   * The requested filter is intersected with the ceiling, so it can only
   * ever remove rows.
   */
  async listWilayas(user: User, requested: { wilayaId?: string } = {}): Promise<Wilaya[]> {
    const ceiling = wilayaScopeFilter(this.scopeFor(user))
    const narrowing = requested.wilayaId ? { id: requested.wilayaId } : {}

    const wilayas = await this.db.wilaya.findMany({
      where: { ...intersectFilters(ceiling, narrowing), isActive: true },
    })
    return sortByCode(wilayas)
  }

  /** A single wilaya, or null when it does not exist *or* is out of scope. */
  async findWilaya(user: User, wilayaId: string): Promise<Wilaya | null> {
    const ceiling = wilayaScopeFilter(this.scopeFor(user))

    return this.db.wilaya.findFirst({
      where: { ...intersectFilters(ceiling, { id: wilayaId }), isActive: true },
    })
  }

  /**
   * Communes the caller may see. Both `wilayaId` and `communeId` filters are
   * intersected with the ceiling — a COMMUNE_ADMIN asking for a different
   * commune, or a WILAYA_ADMIN asking for another wilaya, gets nothing back
   * rather than another territory's data.
   */
  async listCommunes(
    user: User,
    requested: { wilayaId?: string; communeId?: string } = {},
  ): Promise<Commune[]> {
    const ceiling = communeScopeFilter(this.scopeFor(user))
    const narrowing = {
      ...(requested.wilayaId ? { wilayaId: requested.wilayaId } : {}),
      ...(requested.communeId ? { id: requested.communeId } : {}),
    }

    const communes = await this.db.commune.findMany({
      where: { ...intersectFilters(ceiling, narrowing), isActive: true },
    })
    return sortByCode(communes)
  }

  /** A single commune, or null when it does not exist *or* is out of scope. */
  async findCommune(user: User, communeId: string): Promise<Commune | null> {
    const ceiling = communeScopeFilter(this.scopeFor(user))

    return this.db.commune.findFirst({
      where: { ...intersectFilters(ceiling, { id: communeId }), isActive: true },
    })
  }

  /**
   * A single application, or null when it does not exist *or* belongs to a
   * commune the caller does not administer.
   *
   * An application has no scope of its own — it inherits the commune's, which
   * is why the filter nests through the relation rather than comparing a
   * column here. A COMMUNE_ADMIN sees only their commune's applications, a
   * WILAYA_ADMIN their wilaya's, a SUPER_ADMIN every one; and because the
   * ceiling is part of the query, an application from another territory comes
   * back as null exactly like an id that was never issued.
   */
  async findApplication(
    user: User,
    applicationId: string,
  ): Promise<(Application & { commune: Commune & { wilaya: Wilaya } }) | null> {
    const ceiling = communeScopeFilter(this.scopeFor(user))

    return this.db.application.findFirst({
      where: { id: applicationId, commune: ceiling },
      include: { commune: { include: { wilaya: true } } },
    })
  }

  /**
   * One historical record, or null when it does not exist *or* its commune is
   * outside the caller's reach.
   *
   * Authorized on the commune of *that year*, never on the participant. A
   * person may take part in different communes in different years, so a
   * COMMUNE_ADMIN who may see their 2024 record has no claim on their 2025 one
   * elsewhere — the participant is not the unit of ownership, the record is.
   */
  async findHistoryRecord(user: User, historyId: string): Promise<HistoryRecordWithPlace | null> {
    const ceiling = communeScopeFilter(this.scopeFor(user))

    return this.db.participationHistory.findFirst({
      where: { id: historyId, commune: ceiling },
      include: { commune: { include: { wilaya: true } } },
    })
  }

  /**
   * A participant's history, narrowed to the records this administrator may
   * see, newest first.
   *
   * The filtering is the authorization. Asking for a participant by id is not
   * a claim on that participant — there is nothing to claim, since a
   * participant belongs to no commune — so the query returns their years in
   * *this* administrator's territory and silently omits the rest. A
   * COMMUNE_ADMIN never learns that someone also took part elsewhere, which
   * they would if this authorized the participant as a whole and then returned
   * everything.
   */
  async listParticipantHistory(user: User, participantId: string): Promise<HistoryRecordWithPlace[]> {
    const ceiling = communeScopeFilter(this.scopeFor(user))

    return this.db.participationHistory.findMany({
      where: { participantId, commune: ceiling },
      include: { commune: { include: { wilaya: true } } },
      orderBy: { drawYear: 'desc' },
    })
  }

  /**
   * Commune draws the caller may see, optionally narrowed by year, commune,
   * wilaya or status, and paged.
   *
   * A commune draw has no scope of its own — it inherits its commune's, so the
   * ceiling nests through that relation. Requested filters are intersected
   * with it, so a WILAYA_ADMIN asking for a commune in another wilaya gets
   * nothing rather than another territory's allocation.
   *
   * Ordered newest-first with an id tie-break, like every other paginated
   * admin listing (`AdminConsoleService.listApplications`) — geographic-code
   * order (`sortByCode`) cannot be expressed in SQL and so cannot compose with
   * `skip`/`take` without reordering rows within a page.
   */
  async listCommuneDraws(
    user: User,
    requested: {
      drawYearId?: string
      communeId?: string
      wilayaId?: string
      status?: CommuneDrawStatus
      page?: number
      pageSize?: number
    } = {},
  ): Promise<Page<CommuneDrawWithListState>> {
    const ceiling = communeScopeFilter(this.scopeFor(user))
    const narrowing: { id?: string; wilayaId?: string } = requested.wilayaId
      ? { wilayaId: requested.wilayaId }
      : {}

    const where: Prisma.CommuneDrawWhereInput = {
      commune: intersectFilters(ceiling, narrowing),
      ...(requested.drawYearId ? { drawYearId: requested.drawYearId } : {}),
      ...(requested.communeId ? { communeId: requested.communeId } : {}),
      ...(requested.status ? { status: requested.status } : {}),
    }

    const { skip, take, page, pageSize } = boundedPaging(requested.page, requested.pageSize)

    const [items, total] = await Promise.all([
      this.db.communeDraw.findMany({
        where,
        include: {
          drawYear: true,
          commune: { include: { wilaya: true } },
          pool: { select: { id: true } },
          result: { select: { id: true, publication: { select: { id: true } } } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.db.communeDraw.count({ where }),
    ])

    return paged(items, total, page, pageSize)
  }

  /**
   * One commune draw, or null when it does not exist *or* its commune is
   * outside the caller's reach — the two being indistinguishable is the point.
   */
  async findCommuneDraw(user: User, communeDrawId: string): Promise<CommuneDrawWithPlace | null> {
    const ceiling = communeScopeFilter(this.scopeFor(user))

    return this.db.communeDraw.findFirst({
      where: { id: communeDrawId, commune: ceiling },
      include: { drawYear: true, commune: { include: { wilaya: true } } },
    })
  }

  /**
   * A page of the audit trail the caller may see, newest first.
   *
   * The scope rule here is stricter than everywhere else, and deliberately so.
   * Elsewhere an unscoped row is national reference data; in the trail an
   * unscoped row is a *national action* — an administrator's privileges being
   * changed, a draw year being opened, the system being configured. A
   * COMMUNE_ADMIN has no business watching those, so a scoped caller sees only
   * rows filed under their own territory and never the ones filed under none.
   *
   * That is why this cannot reuse `communeScopeFilter`: for a SUPER_ADMIN it
   * must match everything including the null-scoped rows, and for everybody else
   * it must match neither another territory's nor the nation's.
   */
  async listAuditLogs(user: User, filters: AuditLogFilters = {}): Promise<AuditLogPage> {
    const where = this.auditVisibility(user, filters)
    const page = Math.max(1, filters.page ?? 1)
    const pageSize = Math.min(Math.max(1, filters.pageSize ?? AUDIT_PAGE_SIZE_DEFAULT), AUDIT_PAGE_SIZE_MAX)

    const [items, total] = await Promise.all([
      this.db.auditLog.findMany({
        where,
        include: { actor: { select: { id: true, username: true } }, wilaya: true, commune: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.db.auditLog.count({ where }),
    ])

    return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
  }

  /**
   * The caller's ceiling on the trail, intersected with what they asked for.
   *
   * A requested filter can only narrow: a COMMUNE_ADMIN asking for another
   * commune's events gets nothing back rather than another territory's trail.
   */
  private auditVisibility(user: User, filters: AuditLogFilters): Prisma.AuditLogWhereInput {
    const scope = this.scopeFor(user)

    const ceiling: Prisma.AuditLogWhereInput =
      scope.kind === 'national'
        ? {}
        : scope.kind === 'wilaya'
          ? { wilayaId: scope.wilayaId }
          : { communeId: scope.communeId }

    const requested: Prisma.AuditLogWhereInput = {
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.actorUserId ? { actorUserId: filters.actorUserId } : {}),
      ...(filters.targetType ? { targetType: filters.targetType } : {}),
      ...(filters.targetId ? { targetId: filters.targetId } : {}),
      ...(filters.wilayaId ? { wilayaId: filters.wilayaId } : {}),
      ...(filters.communeId ? { communeId: filters.communeId } : {}),
      ...(filters.from || filters.to
        ? {
            createdAt: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
    }

    return { AND: [ceiling, requested] }
  }

  /**
   * Approval requests the caller may see, newest first.
   *
   * Scoped like the records they concern: a request to correct a commune's
   * historical record is visible to that commune's administrators, its wilaya's,
   * and nationally. A SUPER_ADMIN reviewing the queue sees every one.
   */
  async listApprovalRequests(
    user: User,
    requested: { status?: ApprovalStatus } = {},
  ): Promise<ApprovalRequestWithPlace[]> {
    const scope = this.scopeFor(user)

    const ceiling =
      scope.kind === 'national'
        ? {}
        : scope.kind === 'wilaya'
          ? { wilayaId: scope.wilayaId }
          : { communeId: scope.communeId }

    return this.db.approvalRequest.findMany({
      where: { ...ceiling, ...(requested.status ? { status: requested.status } : {}) },
      include: {
        requestedBy: { select: { id: true, username: true } },
        reviewedBy: { select: { id: true, username: true } },
        wilaya: true,
        commune: true,
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  /** One request, or null when it does not exist *or* is out of scope. */
  async findApprovalRequest(user: User, requestId: string): Promise<ApprovalRequestWithPlace | null> {
    const scope = this.scopeFor(user)

    const ceiling =
      scope.kind === 'national'
        ? {}
        : scope.kind === 'wilaya'
          ? { wilayaId: scope.wilayaId }
          : { communeId: scope.communeId }

    return this.db.approvalRequest.findFirst({
      where: { id: requestId, ...ceiling },
      include: {
        requestedBy: { select: { id: true, username: true } },
        reviewedBy: { select: { id: true, username: true } },
        wilaya: true,
        commune: true,
      },
    })
  }

  /**
   * Import batches the caller may see, newest first.
   *
   * A batch has no geography of its own — its *rows* do — so visibility is
   * decided by what it touches: an administrator sees a batch when at least one
   * of its rows lands in their territory, or when they uploaded it themselves.
   * That second clause matters for a batch that failed before staging, or whose
   * rows all named communes that do not exist: it has nothing in anybody's
   * territory, and its uploader still has to be able to find out why.
   */
  async listImportBatches(
    user: User,
    requested: { status?: ImportBatch['status'] } = {},
  ): Promise<ImportBatchWithUsers[]> {
    return this.db.importBatch.findMany({
      where: {
        ...this.batchVisibility(user),
        ...(requested.status ? { status: requested.status } : {}),
      },
      include: {
        uploadedBy: { select: { id: true, username: true } },
        approvedBy: { select: { id: true, username: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  /** One batch, or null when it does not exist *or* touches nothing the caller administers. */
  async findImportBatch(user: User, batchId: string): Promise<ImportBatchWithUsers | null> {
    return this.db.importBatch.findFirst({
      where: { id: batchId, ...this.batchVisibility(user) },
      include: {
        uploadedBy: { select: { id: true, username: true } },
        approvedBy: { select: { id: true, username: true } },
      },
    })
  }

  private batchVisibility(user: User): Prisma.ImportBatchWhereInput {
    const scope = this.scopeFor(user)
    if (scope.kind === 'national') return {}

    return {
      OR: [{ uploadedByUserId: user.id }, { rows: { some: { commune: communeScopeFilter(scope) } } }],
    }
  }

  /**
   * The caller's ceiling on one batch's rows.
   *
   * Returned rather than applied, so every query about a batch's contents — the
   * row list, the conflict list, the counts on the summary — narrows through the
   * same filter instead of each remembering to. A COMMUNE_ADMIN reviewing a
   * national register is shown what it does to their commune and is not told how
   * many rows it holds for anybody else's.
   *
   * The uploader is the exception: they supplied every row in the file, so
   * withholding rows from them would hide the very lines they need to correct
   * while telling them nothing they did not already have.
   */
  importRowScope(user: User, batch: Pick<ImportBatch, 'uploadedByUserId'>): Prisma.ImportRowWhereInput {
    const scope = this.scopeFor(user)
    if (scope.kind === 'national' || batch.uploadedByUserId === user.id) return {}

    return { commune: communeScopeFilter(scope) }
  }

  /** A page of one batch's rows, narrowed to the caller's reach. */
  async listImportRows(
    user: User,
    batch: Pick<ImportBatch, 'id' | 'uploadedByUserId'>,
    requested: { status?: ImportRowStatus; page?: number; pageSize?: number } = {},
  ): Promise<{ items: ImportRow[]; total: number; page: number; pageSize: number; totalPages: number }> {
    const where: Prisma.ImportRowWhereInput = {
      importBatchId: batch.id,
      ...this.importRowScope(user, batch),
      ...(requested.status ? { status: requested.status } : {}),
    }

    const page = Math.max(1, requested.page ?? 1)
    const pageSize = Math.min(
      Math.max(1, requested.pageSize ?? IMPORT_ROW_PAGE_SIZE_DEFAULT),
      IMPORT_ROW_PAGE_SIZE_MAX,
    )

    const [items, total] = await Promise.all([
      this.db.importRow.findMany({
        where,
        orderBy: { rowNumber: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.db.importRow.count({ where }),
    ])

    return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
  }

  /**
   * Predicate form, for callers that already hold the record. Prefer the
   * scoped queries above where possible — a filter cannot be forgotten, a
   * check can.
   */
  canReachWilaya(user: User, wilayaId: string): boolean {
    return canAccessWilaya(this.scopeFor(user), wilayaId)
  }

  canReachCommune(user: User, commune: { id: string; wilayaId: string }): boolean {
    return canAccessCommune(this.scopeFor(user), commune)
  }

  /** Scope as reported to the client by `GET /api/auth/me`. */
  async describeScope(user: User): Promise<AdminScopeDto> {
    const [wilaya, commune] = await Promise.all([
      user.wilayaId ? this.db.wilaya.findUnique({ where: { id: user.wilayaId } }) : null,
      user.communeId ? this.db.commune.findUnique({ where: { id: user.communeId } }) : null,
    ])

    return { wilaya: wilaya && toScopePlace(wilaya), commune: commune && toScopePlace(commune) }
  }
}

function toScopePlace(place: Wilaya | Commune): ScopePlaceDto {
  const { id, code, nameAr, nameFr, nameEn } = place
  return { id, code, nameAr, nameFr, nameEn }
}

export const authorizationService = new AuthorizationService()
