import type { AdminRole as SharedAdminRole } from '@hajj-lottery/shared'
import { AdminRole as PrismaAdminRole } from '@prisma/client'

/**
 * The admin role vocabulary is declared twice — as a PostgreSQL enum in
 * prisma/schema.prisma and as a plain union in shared/, which the browser can
 * import without pulling in Prisma. These assertions fail the build if the
 * two ever drift apart, so the mismatch is caught at compile time rather than
 * as a runtime enum error in production.
 */
type AssertExtends<A extends B, B> = A

type _PrismaRolesAreShared = AssertExtends<PrismaAdminRole, SharedAdminRole>
type _SharedRolesArePrisma = AssertExtends<SharedAdminRole, PrismaAdminRole>

export { PrismaAdminRole as AdminRole }
