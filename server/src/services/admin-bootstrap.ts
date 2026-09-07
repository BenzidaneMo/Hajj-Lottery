import { AdminRole, type PrismaClient } from '@prisma/client'

import { env, isProduction } from '../config/env.js'
import { hashPassword, MIN_PASSWORD_LENGTH } from '../lib/password.js'
import { prisma as defaultPrisma } from '../lib/prisma.js'
import { normalizeUsername } from './auth.service.js'

export type BootstrapOutcome =
  | { status: 'created'; username: string }
  | { status: 'password-updated'; username: string }
  | { status: 'already-exists'; username: string }
  | { status: 'skipped'; reason: string }

export interface BootstrapOptions {
  username: string | undefined
  password: string | undefined
  /** Development seeding refuses to run in production; the explicit
   *  bootstrap does not. */
  devOnly: boolean
  db?: PrismaClient
}

/**
 * Creates the first SUPER_ADMIN.
 *
 * There is deliberately no default username or password anywhere in this
 * file: if credentials are not supplied, no administrator is created and the
 * caller is told why. That is what stops a deployment from silently ending up
 * with a well-known account.
 */
export async function createInitialAdmin(options: BootstrapOptions): Promise<BootstrapOutcome> {
  const db = options.db ?? defaultPrisma

  if (options.devOnly && isProduction) {
    return {
      status: 'skipped',
      reason:
        'Refusing to run the development admin seed with NODE_ENV=production. ' +
        'Use the documented bootstrap (npm run admin:create) instead.',
    }
  }

  if (!options.username || !options.password) {
    return {
      status: 'skipped',
      reason: options.devOnly
        ? 'DEV_ADMIN_USERNAME and DEV_ADMIN_PASSWORD are not set; no administrator was created.'
        : 'ADMIN_USERNAME and ADMIN_PASSWORD must both be set; no administrator was created.',
    }
  }

  if (options.password.length < MIN_PASSWORD_LENGTH) {
    return {
      status: 'skipped',
      reason: `Password must be at least ${MIN_PASSWORD_LENGTH} characters; no administrator was created.`,
    }
  }

  const username = normalizeUsername(options.username)
  const existing = await db.user.findUnique({ where: { username } })

  if (existing) {
    // Re-running the dev seed should be idempotent, but silently resetting a
    // live administrator's password would be a backdoor.
    if (isProduction) return { status: 'already-exists', username }

    await db.user.update({
      where: { id: existing.id },
      data: { passwordHash: await hashPassword(options.password), isActive: true },
    })
    return { status: 'password-updated', username }
  }

  await db.user.create({
    data: {
      username,
      passwordHash: await hashPassword(options.password),
      role: AdminRole.SUPER_ADMIN,
      // A SUPER_ADMIN is national; the role/scope CHECK constraint rejects
      // any geographic assignment here.
      wilayaId: null,
      communeId: null,
    },
  })

  return { status: 'created', username }
}

/** Credentials for the development seed (`npm run seed:admin`). */
export function devAdminCredentials(): Pick<BootstrapOptions, 'username' | 'password'> {
  return { username: env.DEV_ADMIN_USERNAME, password: env.DEV_ADMIN_PASSWORD }
}

/** Credentials for the explicit bootstrap (`npm run admin:create`). */
export function explicitAdminCredentials(): Pick<BootstrapOptions, 'username' | 'password'> {
  return { username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD }
}
