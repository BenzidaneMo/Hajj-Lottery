import type { AdminScopeDto, ScopePlaceDto } from '@hajj-lottery/shared'
import type { Application, Commune, PrismaClient, User, Wilaya } from '@prisma/client'

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
import { prisma as defaultPrisma } from '../lib/prisma.js'

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
