import { PrismaClient } from '@prisma/client'
import { afterAll, beforeEach } from 'vitest'

import { resolveTestDatabaseUrl } from './test-database.js'

// Must happen before anything imports src/config/env.ts or src/lib/prisma.ts:
// both read DATABASE_URL at module load, and dotenv does not override values
// that are already set.
const databaseUrl = resolveTestDatabaseUrl()
process.env.DATABASE_URL = databaseUrl
process.env.NODE_ENV = 'test'
process.env.INTERNAL_API_KEY = 'test-internal-api-key'

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

beforeEach(async () => {
  // Participants are the only table these tests write to; the geographic
  // tables are left alone so an accidental misconfiguration cannot quietly
  // wipe seeded reference data.
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "participants" RESTART IDENTITY CASCADE')
})

afterAll(async () => {
  await prisma.$disconnect()
})
