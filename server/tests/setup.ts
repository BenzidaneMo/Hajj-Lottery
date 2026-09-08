import { PrismaClient } from '@prisma/client'
import { afterAll, beforeEach } from 'vitest'

import { resolveTestDatabaseUrl } from './test-database.js'

// Must happen before anything imports src/config/env.ts or src/lib/prisma.ts:
// both read DATABASE_URL at module load, and dotenv does not override values
// that are already set.
const databaseUrl = resolveTestDatabaseUrl()
process.env.DATABASE_URL = databaseUrl
process.env.NODE_ENV = 'test'

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

beforeEach(async () => {
  // Only the tables these tests write to. The geographic tables are left
  // alone so an accidental misconfiguration cannot quietly wipe seeded
  // reference data. Truncating "users" cascades to "sessions", "participants"
  // to applications and history, and "draw_years" to commune draws.
  //
  // Draw years matter here beyond tidiness: at most one may be open for
  // registration at a time, so a year left open by one file would make every
  // later file's fixture unopenable.
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "participants", "sessions", "users", "draw_years" RESTART IDENTITY CASCADE',
  )
})

afterAll(async () => {
  await prisma.$disconnect()
})
