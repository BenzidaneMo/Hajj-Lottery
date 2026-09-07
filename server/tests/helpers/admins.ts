import { AdminRole, type Commune, type PrismaClient, type User, type Wilaya } from '@prisma/client'
import type { Express } from 'express'
import request from 'supertest'

import { SESSION_COOKIE_NAME } from '../../src/config/session-cookie.js'
import { hashPassword } from '../../src/lib/password.js'

export const TEST_PASSWORD = 'a sufficiently long test password'

/**
 * argon2 is intentionally slow, so the digest for the shared test password is
 * computed once and reused. Tests that care about hashing call hashPassword
 * directly instead.
 */
let cachedDigest: string | undefined
async function testPasswordHash(): Promise<string> {
  cachedDigest ??= await hashPassword(TEST_PASSWORD)
  return cachedDigest
}

export interface TestGeography {
  wilayaA: Wilaya
  wilayaB: Wilaya
  /** Two communes in wilaya A, one in wilaya B. */
  communeA1: Commune
  communeA2: Commune
  communeB1: Commune
}

/**
 * Fixture geography, upserted by code so it is idempotent and additive.
 *
 * The suite deliberately never truncates the geographic tables (see
 * tests/setup.ts), so these use codes far outside Algeria's real 1–69 range
 * and cannot collide with seeded reference data.
 */
export async function ensureTestGeography(prisma: PrismaClient): Promise<TestGeography> {
  const wilaya = (code: string, name: string) =>
    prisma.wilaya.upsert({
      where: { code },
      update: {},
      create: { code, nameAr: name, nameFr: name, nameEn: name },
    })

  const wilayaA = await wilaya('901', 'Test Wilaya A')
  const wilayaB = await wilaya('902', 'Test Wilaya B')

  const commune = (w: Wilaya, code: string, name: string) =>
    prisma.commune.upsert({
      where: { wilayaId_code: { wilayaId: w.id, code } },
      update: {},
      create: { wilayaId: w.id, code, nameAr: name, nameFr: name, nameEn: name },
    })

  return {
    wilayaA,
    wilayaB,
    communeA1: await commune(wilayaA, '90101', 'Test Commune A1'),
    communeA2: await commune(wilayaA, '90102', 'Test Commune A2'),
    communeB1: await commune(wilayaB, '90201', 'Test Commune B1'),
  }
}

export interface CreateAdminOptions {
  role: AdminRole
  username?: string
  wilayaId?: string | null
  communeId?: string | null
  isActive?: boolean
}

let usernameCounter = 0

export async function createAdmin(prisma: PrismaClient, options: CreateAdminOptions): Promise<User> {
  usernameCounter += 1
  return prisma.user.create({
    data: {
      username: options.username ?? `test.admin.${usernameCounter}`,
      passwordHash: await testPasswordHash(),
      role: options.role,
      wilayaId: options.wilayaId ?? null,
      communeId: options.communeId ?? null,
      isActive: options.isActive ?? true,
    },
  })
}

/** Signs in and returns the `name=value` cookie pair to send back. */
export async function signIn(app: Express, username: string): Promise<string> {
  const response = await request(app).post('/api/auth/login').send({ username, password: TEST_PASSWORD })

  if (response.status !== 200) {
    throw new Error(`Sign-in failed for "${username}": ${response.status}`)
  }

  const header = response.headers['set-cookie'] as unknown as string[] | undefined
  const cookie = header?.find((value) => value.startsWith(`${SESSION_COOKIE_NAME}=`))
  if (!cookie) throw new Error('Sign-in returned no session cookie')
  return cookie.split(';')[0] as string
}

export async function createAdminAndSignIn(
  app: Express,
  prisma: PrismaClient,
  options: CreateAdminOptions,
): Promise<{ user: User; cookie: string }> {
  const user = await createAdmin(prisma, options)
  return { user, cookie: await signIn(app, user.username) }
}

export { AdminRole }
