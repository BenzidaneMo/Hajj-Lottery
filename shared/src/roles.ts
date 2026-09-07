/**
 * Administrative hierarchy for the lottery platform.
 * SUPER_ADMIN oversees all wilayas; WILAYA_ADMIN oversees communes within one
 * wilaya; COMMUNE_ADMIN manages a single commune's draw and participants.
 */
export const ADMIN_ROLES = ['SUPER_ADMIN', 'WILAYA_ADMIN', 'COMMUNE_ADMIN'] as const

export type AdminRole = (typeof ADMIN_ROLES)[number]
