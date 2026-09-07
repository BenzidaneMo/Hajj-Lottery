import { AdminRole, type User } from '@prisma/client'

/**
 * An administrator's authoritative reach, derived from their stored record.
 *
 * Never construct one of these from anything the client sent. `resolveScope`
 * is the only supported way to obtain one, and it reads the database row that
 * `requireAuthenticatedUser` loaded.
 */
export type AdminScope =
  | { kind: 'national' }
  | { kind: 'wilaya'; wilayaId: string }
  | { kind: 'commune'; wilayaId: string; communeId: string }

/**
 * Reads the scope off an authenticated user.
 *
 * A role/scope combination the database should have rejected throws rather
 * than degrading to a wider scope: if the invariant is somehow broken, the
 * safe outcome is a failed request, never accidental national access.
 */
export function resolveScope(user: Pick<User, 'role' | 'wilayaId' | 'communeId'>): AdminScope {
  switch (user.role) {
    case AdminRole.SUPER_ADMIN:
      if (user.wilayaId !== null || user.communeId !== null) {
        throw new Error('SUPER_ADMIN must not carry a geographic scope')
      }
      return { kind: 'national' }

    case AdminRole.WILAYA_ADMIN:
      if (user.wilayaId === null || user.communeId !== null) {
        throw new Error('WILAYA_ADMIN must have a wilaya and no commune')
      }
      return { kind: 'wilaya', wilayaId: user.wilayaId }

    case AdminRole.COMMUNE_ADMIN:
      if (user.wilayaId === null || user.communeId === null) {
        throw new Error('COMMUNE_ADMIN must have both a wilaya and a commune')
      }
      return { kind: 'commune', wilayaId: user.wilayaId, communeId: user.communeId }
  }
}

/** True if this scope reaches the given wilaya. */
export function canAccessWilaya(scope: AdminScope, wilayaId: string): boolean {
  if (scope.kind === 'national') return true
  return scope.wilayaId === wilayaId
}

/**
 * True if this scope reaches the given commune. Takes the commune's own
 * wilaya rather than an id alone, so the caller cannot accidentally check
 * against a wilaya the client supplied.
 */
export function canAccessCommune(scope: AdminScope, commune: { id: string; wilayaId: string }): boolean {
  if (scope.kind === 'national') return true
  if (scope.kind === 'wilaya') return scope.wilayaId === commune.wilayaId
  return scope.communeId === commune.id
}

/** Prisma `where` fragment limiting Wilaya rows to this scope. */
export function wilayaScopeFilter(scope: AdminScope): { id?: string } {
  return scope.kind === 'national' ? {} : { id: scope.wilayaId }
}

/** Prisma `where` fragment limiting Commune rows to this scope. */
export function communeScopeFilter(scope: AdminScope): { id?: string; wilayaId?: string } {
  switch (scope.kind) {
    case 'national':
      return {}
    case 'wilaya':
      return { wilayaId: scope.wilayaId }
    case 'commune':
      return { id: scope.communeId }
  }
}

/**
 * Combines the caller's ceiling with the filter they asked for.
 *
 * The two are ANDed, never merged, so a requested filter can only ever narrow
 * the result set. A WILAYA_ADMIN of wilaya 7 asking for `?wilayaId=8` gets the
 * intersection — which is empty — rather than wilaya 8's data.
 */
export function intersectFilters<T extends object>(ceiling: T, requested: T): { AND: [T, T] } {
  return { AND: [ceiling, requested] }
}
