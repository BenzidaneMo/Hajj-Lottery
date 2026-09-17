import type { AdminRole } from './roles.js'

/** A wilaya or commune reduced to what the admin UI needs to label a scope. */
export interface ScopePlaceDto {
  id: string
  code: string
  nameAr: string
  nameFr: string
  nameEn: string
}

/**
 * An administrator's geographic reach, as reported to the client.
 *
 * Both null means national (SUPER_ADMIN). This is descriptive only — the
 * client uses it to label the UI and hide irrelevant navigation. Every
 * access decision is made again on the server from the stored scope.
 */
export interface AdminScopeDto {
  wilaya: ScopePlaceDto | null
  commune: ScopePlaceDto | null
}

/**
 * Navigation areas of the admin portal, with the roles allowed to open them.
 *
 * Shared so the sidebar and the server agree on one definition instead of two
 * drifting copies. Hiding a link is a convenience; the server still enforces
 * the same rule on every request.
 */
export const ADMIN_AREA_ROLES = {
  dashboard: ['SUPER_ADMIN', 'WILAYA_ADMIN', 'COMMUNE_ADMIN'],
  participants: ['SUPER_ADMIN'],
  applications: ['SUPER_ADMIN', 'WILAYA_ADMIN', 'COMMUNE_ADMIN'],
  communes: ['SUPER_ADMIN', 'WILAYA_ADMIN'],
  draws: ['SUPER_ADMIN', 'WILAYA_ADMIN', 'COMMUNE_ADMIN'],
  winners: ['SUPER_ADMIN', 'WILAYA_ADMIN', 'COMMUNE_ADMIN'],
  history: ['SUPER_ADMIN', 'WILAYA_ADMIN', 'COMMUNE_ADMIN'],
  // Uploading and reviewing a register is ordinary scoped work — the server
  // never gated it to SUPER_ADMIN (see admin.ts's `/imports` routes and
  // AuthorizationService's import scoping). Approve/reject/execute stay
  // SUPER_ADMIN-only, enforced by `requireRole` regardless of this map; that
  // narrower gate is what the console's own action buttons key off of, not
  // this area check — see AdminImportDetail's `isSuperAdmin` guard.
  imports: ['SUPER_ADMIN', 'WILAYA_ADMIN', 'COMMUNE_ADMIN'],
  approvals: ['SUPER_ADMIN'],
  audit: ['SUPER_ADMIN'],
  admins: ['SUPER_ADMIN'],
  settings: ['SUPER_ADMIN'],
} as const satisfies Record<string, readonly AdminRole[]>

export type AdminArea = keyof typeof ADMIN_AREA_ROLES

export function canOpenAdminArea(role: AdminRole, area: AdminArea): boolean {
  return (ADMIN_AREA_ROLES[area] as readonly AdminRole[]).includes(role)
}
