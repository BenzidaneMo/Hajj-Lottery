import { PrismaClient } from '@prisma/client'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { createInitialAdmin } from '../src/services/admin-bootstrap.js'

const prisma = new PrismaClient()

const CREDENTIALS = { username: 'boot.admin', password: 'a sufficiently long password' }

beforeAll(async () => {
  await prisma.$connect()
})

afterAll(async () => {
  await prisma.$disconnect()
})

/**
 * `isProduction` is captured when config/env.ts is first evaluated, so
 * exercising a production path means re-evaluating the module graph with
 * NODE_ENV set. `vi.resetModules()` clears the registry; the import specifier
 * stays static so Vite can still analyze it.
 */
async function withProductionEnv<T>(
  run: (mod: typeof import('../src/services/admin-bootstrap.js')) => Promise<T>,
): Promise<T> {
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  vi.resetModules()
  try {
    const mod = await import('../src/services/admin-bootstrap.js')
    return await run(mod)
  } finally {
    process.env.NODE_ENV = previous
    vi.resetModules()
  }
}

afterEach(() => {
  process.env.NODE_ENV = 'test'
})

describe('createInitialAdmin', () => {
  it('creates a SUPER_ADMIN from explicit credentials', async () => {
    const outcome = await createInitialAdmin({ ...CREDENTIALS, devOnly: true, db: prisma })

    expect(outcome).toMatchObject({ status: 'created', username: 'boot.admin' })

    const user = await prisma.user.findUniqueOrThrow({ where: { username: 'boot.admin' } })
    expect(user.role).toBe('SUPER_ADMIN')
    expect(user.isActive).toBe(true)
    expect(user.passwordHash).not.toContain(CREDENTIALS.password)
  })

  it('creates nothing when credentials are missing', async () => {
    const outcome = await createInitialAdmin({
      username: undefined,
      password: undefined,
      devOnly: true,
      db: prisma,
    })

    expect(outcome.status).toBe('skipped')
    expect(await prisma.user.count()).toBe(0)
  })

  it('creates nothing when only one of the two is supplied', async () => {
    const outcome = await createInitialAdmin({
      username: 'boot.admin',
      password: undefined,
      devOnly: true,
      db: prisma,
    })

    expect(outcome.status).toBe('skipped')
    expect(await prisma.user.count()).toBe(0)
  })

  it('rejects a password below the minimum length', async () => {
    const outcome = await createInitialAdmin({
      username: 'boot.admin',
      password: 'short',
      devOnly: true,
      db: prisma,
    })

    expect(outcome.status).toBe('skipped')
    expect(await prisma.user.count()).toBe(0)
  })

  it('is idempotent in development, resetting the password on re-run', async () => {
    await createInitialAdmin({ ...CREDENTIALS, devOnly: true, db: prisma })
    const first = await prisma.user.findUniqueOrThrow({ where: { username: 'boot.admin' } })

    const outcome = await createInitialAdmin({
      ...CREDENTIALS,
      password: 'a different long password',
      devOnly: true,
      db: prisma,
    })

    expect(outcome.status).toBe('password-updated')
    expect(await prisma.user.count()).toBe(1)
    const second = await prisma.user.findUniqueOrThrow({ where: { username: 'boot.admin' } })
    expect(second.passwordHash).not.toBe(first.passwordHash)
  })
})

describe('production safety', () => {
  it('refuses to run the development seed in production', async () => {
    const outcome = await withProductionEnv((mod) =>
      mod.createInitialAdmin({ ...CREDENTIALS, devOnly: true, db: prisma }),
    )

    expect(outcome.status).toBe('skipped')
    expect(await prisma.user.count()).toBe(0)
  })

  it('creates no default administrator in production when nothing is configured', async () => {
    const outcome = await withProductionEnv((mod) =>
      mod.createInitialAdmin({ username: undefined, password: undefined, devOnly: false, db: prisma }),
    )

    expect(outcome.status).toBe('skipped')
    expect(await prisma.user.count()).toBe(0)
  })

  it('never resets an existing administrator password in production', async () => {
    await createInitialAdmin({ ...CREDENTIALS, devOnly: true, db: prisma })
    const before = await prisma.user.findUniqueOrThrow({ where: { username: 'boot.admin' } })

    const outcome = await withProductionEnv((mod) =>
      mod.createInitialAdmin({
        username: CREDENTIALS.username,
        password: 'an attacker supplied password',
        devOnly: false,
        db: prisma,
      }),
    )

    expect(outcome.status).toBe('already-exists')
    const after = await prisma.user.findUniqueOrThrow({ where: { username: 'boot.admin' } })
    expect(after.passwordHash).toBe(before.passwordHash)
  })

  it('does allow an explicit production bootstrap when none exists yet', async () => {
    const outcome = await withProductionEnv((mod) =>
      mod.createInitialAdmin({ ...CREDENTIALS, devOnly: false, db: prisma }),
    )

    expect(outcome.status).toBe('created')
    expect(await prisma.user.count()).toBe(1)
  })
})

describe('source code hygiene', () => {
  it('ships no hardcoded default administrator password', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')

    const source = readFileSync(
      fileURLToPath(new URL('../src/services/admin-bootstrap.ts', import.meta.url)),
      'utf8',
    )

    for (const forbidden of ['admin123', 'password123', 'changeme', "'admin'", '"admin"']) {
      expect(source.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
  })
})
