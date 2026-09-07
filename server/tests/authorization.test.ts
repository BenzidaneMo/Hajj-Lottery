import { AdminRole, PrismaClient, type User } from '@prisma/client'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import { resolveScope } from '../src/lib/scope.js'
import { AdminAccountService } from '../src/services/admin-account.service.js'
import { AuthorizationService } from '../src/services/authorization.service.js'
import {
  createAdmin,
  createAdminAndSignIn,
  ensureTestGeography,
  type TestGeography,
} from './helpers/admins.js'

const app = createApp()
const prisma = new PrismaClient()
const authorization = new AuthorizationService(prisma)
const accounts = new AdminAccountService(prisma)

let geo: TestGeography

const authed = (cookie: string) => ({
  get: (path: string) => request(app).get(path).set('Cookie', cookie),
})

beforeAll(async () => {
  await prisma.$connect()
})

beforeEach(async () => {
  geo = await ensureTestGeography(prisma)
})

afterAll(async () => {
  await prisma.$disconnect()
})

async function signInAs(role: AdminRole, scope: Partial<Pick<User, 'wilayaId' | 'communeId'>> = {}) {
  return createAdminAndSignIn(app, prisma, { role, ...scope })
}

describe('role authorization', () => {
  it('rejects an unauthenticated request with 401, not 403', async () => {
    const response = await request(app).get('/api/admin/wilayas')

    expect(response.status).toBe(401)
    expect(response.body.code).toBe('UNAUTHORIZED')
  })

  it('rejects an authenticated administrator whose role is insufficient with 403', async () => {
    const { cookie } = await signInAs(AdminRole.WILAYA_ADMIN, { wilayaId: geo.wilayaA.id })

    const response = await authed(cookie).get('/api/participants/by-national-id/112233445566778899')

    expect(response.status).toBe(403)
    expect(response.body.code).toBe('FORBIDDEN_ROLE')
    // The refusal must not enumerate which roles would have worked.
    expect(JSON.stringify(response.body)).not.toContain('SUPER_ADMIN')
  })

  it('lets a SUPER_ADMIN reach the unrestricted endpoint', async () => {
    const { cookie } = await signInAs(AdminRole.SUPER_ADMIN)

    const response = await authed(cookie).get('/api/participants/by-national-id/112233445566778899')

    // 404 (no such participant), not 403 — the role gate was passed.
    expect(response.status).toBe(404)
  })
})

describe('SUPER_ADMIN scope', () => {
  it('sees every wilaya and commune', async () => {
    const { cookie } = await signInAs(AdminRole.SUPER_ADMIN)

    const wilayas = await authed(cookie).get('/api/admin/wilayas')
    const ids = wilayas.body.map((w: { id: string }) => w.id)
    expect(ids).toContain(geo.wilayaA.id)
    expect(ids).toContain(geo.wilayaB.id)

    for (const commune of [geo.communeA1, geo.communeB1]) {
      const response = await authed(cookie).get(`/api/admin/communes/${commune.id}`)
      expect(response.status).toBe(200)
    }
  })
})

describe('WILAYA_ADMIN scope', () => {
  it('can read its own wilaya', async () => {
    const { cookie } = await signInAs(AdminRole.WILAYA_ADMIN, { wilayaId: geo.wilayaA.id })

    const response = await authed(cookie).get(`/api/admin/wilayas/${geo.wilayaA.id}`)

    expect(response.status).toBe(200)
    expect(response.body.id).toBe(geo.wilayaA.id)
  })

  it('cannot read another wilaya, and cannot tell it exists', async () => {
    const { cookie } = await signInAs(AdminRole.WILAYA_ADMIN, { wilayaId: geo.wilayaA.id })

    const otherWilaya = await authed(cookie).get(`/api/admin/wilayas/${geo.wilayaB.id}`)
    const madeUpId = await authed(cookie).get('/api/admin/wilayas/does-not-exist-at-all')

    expect(otherWilaya.status).toBe(404)
    // Byte-identical to a nonexistent id, so ids cannot be probed.
    expect(otherWilaya.body).toEqual(madeUpId.body)
  })

  it('lists only its own wilaya', async () => {
    const { cookie } = await signInAs(AdminRole.WILAYA_ADMIN, { wilayaId: geo.wilayaA.id })

    const response = await authed(cookie).get('/api/admin/wilayas')

    expect(response.body).toHaveLength(1)
    expect(response.body[0].id).toBe(geo.wilayaA.id)
  })

  it('can read a commune belonging to its wilaya', async () => {
    const { cookie } = await signInAs(AdminRole.WILAYA_ADMIN, { wilayaId: geo.wilayaA.id })

    const response = await authed(cookie).get(`/api/admin/communes/${geo.communeA1.id}`)

    expect(response.status).toBe(200)
    expect(response.body.id).toBe(geo.communeA1.id)
  })

  it('cannot read a commune from another wilaya', async () => {
    const { cookie } = await signInAs(AdminRole.WILAYA_ADMIN, { wilayaId: geo.wilayaA.id })

    const response = await authed(cookie).get(`/api/admin/communes/${geo.communeB1.id}`)

    expect(response.status).toBe(404)
  })

  it('lists every commune of its wilaya and no others', async () => {
    const { cookie } = await signInAs(AdminRole.WILAYA_ADMIN, { wilayaId: geo.wilayaA.id })

    const response = await authed(cookie).get('/api/admin/communes')
    const ids = response.body.map((c: { id: string }) => c.id)

    expect(ids).toContain(geo.communeA1.id)
    expect(ids).toContain(geo.communeA2.id)
    expect(ids).not.toContain(geo.communeB1.id)
  })
})

describe('COMMUNE_ADMIN scope', () => {
  const asCommuneAdmin = () =>
    signInAs(AdminRole.COMMUNE_ADMIN, { wilayaId: geo.wilayaA.id, communeId: geo.communeA1.id })

  it('can read its own commune', async () => {
    const { cookie } = await asCommuneAdmin()

    const response = await authed(cookie).get(`/api/admin/communes/${geo.communeA1.id}`)

    expect(response.status).toBe(200)
    expect(response.body.id).toBe(geo.communeA1.id)
  })

  it('cannot read a sibling commune in its own wilaya', async () => {
    const { cookie } = await asCommuneAdmin()

    const response = await authed(cookie).get(`/api/admin/communes/${geo.communeA2.id}`)

    expect(response.status).toBe(404)
  })

  it('cannot read a commune in another wilaya', async () => {
    const { cookie } = await asCommuneAdmin()

    const response = await authed(cookie).get(`/api/admin/communes/${geo.communeB1.id}`)

    expect(response.status).toBe(404)
  })

  it('cannot read another wilaya', async () => {
    const { cookie } = await asCommuneAdmin()

    const response = await authed(cookie).get(`/api/admin/wilayas/${geo.wilayaB.id}`)

    expect(response.status).toBe(404)
  })

  it('lists exactly one commune', async () => {
    const { cookie } = await asCommuneAdmin()

    const response = await authed(cookie).get('/api/admin/communes')

    expect(response.body).toHaveLength(1)
    expect(response.body[0].id).toBe(geo.communeA1.id)
  })
})

describe('query parameters cannot widen scope', () => {
  it('a WILAYA_ADMIN asking for another wilaya gets nothing', async () => {
    const { cookie } = await signInAs(AdminRole.WILAYA_ADMIN, { wilayaId: geo.wilayaA.id })

    const wilayas = await authed(cookie).get(`/api/admin/wilayas?wilayaId=${geo.wilayaB.id}`)
    const communes = await authed(cookie).get(`/api/admin/communes?wilayaId=${geo.wilayaB.id}`)

    expect(wilayas.body).toEqual([])
    expect(communes.body).toEqual([])
  })

  it('a WILAYA_ADMIN cannot name a commune outside its wilaya', async () => {
    const { cookie } = await signInAs(AdminRole.WILAYA_ADMIN, { wilayaId: geo.wilayaA.id })

    const response = await authed(cookie).get(`/api/admin/communes?communeId=${geo.communeB1.id}`)

    expect(response.body).toEqual([])
  })

  it('a COMMUNE_ADMIN cannot name another commune', async () => {
    const { cookie } = await signInAs(AdminRole.COMMUNE_ADMIN, {
      wilayaId: geo.wilayaA.id,
      communeId: geo.communeA1.id,
    })

    const sibling = await authed(cookie).get(`/api/admin/communes?communeId=${geo.communeA2.id}`)
    const foreign = await authed(cookie).get(`/api/admin/communes?wilayaId=${geo.wilayaB.id}`)

    expect(sibling.body).toEqual([])
    expect(foreign.body).toEqual([])
  })

  it('a filter still narrows within an allowed scope', async () => {
    const { cookie } = await signInAs(AdminRole.SUPER_ADMIN)

    const response = await authed(cookie).get(`/api/admin/communes?wilayaId=${geo.wilayaB.id}`)
    const ids = response.body.map((c: { id: string }) => c.id)

    expect(ids).toContain(geo.communeB1.id)
    expect(ids).not.toContain(geo.communeA1.id)
  })
})

describe('GET /api/auth/me reports scope', () => {
  it('reports a national scope for SUPER_ADMIN and leaks nothing sensitive', async () => {
    const { cookie } = await signInAs(AdminRole.SUPER_ADMIN)

    const response = await authed(cookie).get('/api/auth/me')

    expect(response.body.role).toBe('SUPER_ADMIN')
    expect(response.body.isActive).toBe(true)
    expect(response.body.scope).toEqual({ wilaya: null, commune: null })
    for (const field of ['passwordHash', 'password_hash', 'wilayaId', 'communeId']) {
      expect(response.body).not.toHaveProperty(field)
    }
    expect(JSON.stringify(response.body)).not.toContain('argon2')
  })

  it('reports the wilaya for a WILAYA_ADMIN', async () => {
    const { cookie } = await signInAs(AdminRole.WILAYA_ADMIN, { wilayaId: geo.wilayaA.id })

    const response = await authed(cookie).get('/api/auth/me')

    expect(response.body.scope.wilaya).toMatchObject({ id: geo.wilayaA.id, code: '901' })
    expect(response.body.scope.commune).toBeNull()
  })

  it('reports both places for a COMMUNE_ADMIN', async () => {
    const { cookie } = await signInAs(AdminRole.COMMUNE_ADMIN, {
      wilayaId: geo.wilayaA.id,
      communeId: geo.communeA1.id,
    })

    const response = await authed(cookie).get('/api/auth/me')

    expect(response.body.scope.wilaya.id).toBe(geo.wilayaA.id)
    expect(response.body.scope.commune.id).toBe(geo.communeA1.id)
  })
})

describe('scope assignment validation', () => {
  it('accepts each legal role/scope combination', async () => {
    await expect(accounts.validateAssignment({ role: AdminRole.SUPER_ADMIN })).resolves.toMatchObject({
      wilayaId: null,
      communeId: null,
    })
    await expect(
      accounts.validateAssignment({ role: AdminRole.WILAYA_ADMIN, wilayaId: geo.wilayaA.id }),
    ).resolves.toMatchObject({ wilayaId: geo.wilayaA.id, communeId: null })
    await expect(
      accounts.validateAssignment({
        role: AdminRole.COMMUNE_ADMIN,
        wilayaId: geo.wilayaA.id,
        communeId: geo.communeA1.id,
      }),
    ).resolves.toMatchObject({ communeId: geo.communeA1.id })
  })

  it('rejects impossible role/scope combinations', async () => {
    const cases = [
      { role: AdminRole.SUPER_ADMIN, wilayaId: geo.wilayaA.id },
      { role: AdminRole.WILAYA_ADMIN },
      { role: AdminRole.WILAYA_ADMIN, wilayaId: geo.wilayaA.id, communeId: geo.communeA1.id },
      { role: AdminRole.COMMUNE_ADMIN, wilayaId: geo.wilayaA.id },
      { role: AdminRole.COMMUNE_ADMIN, communeId: geo.communeA1.id },
    ]

    for (const assignment of cases) {
      await expect(accounts.validateAssignment(assignment)).rejects.toMatchObject({
        status: 422,
        code: 'INVALID_SCOPE_ASSIGNMENT',
      })
    }
  })

  it('rejects a commune that does not belong to the assigned wilaya', async () => {
    await expect(
      accounts.validateAssignment({
        role: AdminRole.COMMUNE_ADMIN,
        wilayaId: geo.wilayaA.id,
        communeId: geo.communeB1.id,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SCOPE_ASSIGNMENT' })
  })

  it('rejects references to places that do not exist', async () => {
    await expect(
      accounts.validateAssignment({ role: AdminRole.WILAYA_ADMIN, wilayaId: 'nope' }),
    ).rejects.toMatchObject({ code: 'INVALID_SCOPE_ASSIGNMENT' })
  })

  it('is enforced by PostgreSQL as well, not only by the service', async () => {
    // Straight to the database, bypassing every application-level check.
    await expect(
      createAdmin(prisma, { role: AdminRole.SUPER_ADMIN, wilayaId: geo.wilayaA.id }),
    ).rejects.toThrow()

    await expect(
      createAdmin(prisma, {
        role: AdminRole.COMMUNE_ADMIN,
        wilayaId: geo.wilayaA.id,
        communeId: geo.communeB1.id,
      }),
    ).rejects.toThrow()
  })
})

describe('privilege escalation', () => {
  it('stops a scoped administrator granting national access', async () => {
    const wilayaAdmin = await createAdmin(prisma, {
      role: AdminRole.WILAYA_ADMIN,
      wilayaId: geo.wilayaA.id,
    })

    expect(() =>
      accounts.assertMayAssign(wilayaAdmin, {
        role: AdminRole.SUPER_ADMIN,
        wilayaId: null,
        communeId: null,
      }),
    ).toThrow(/national access/i)
  })

  it('stops a WILAYA_ADMIN assigning into another wilaya', async () => {
    const wilayaAdmin = await createAdmin(prisma, {
      role: AdminRole.WILAYA_ADMIN,
      wilayaId: geo.wilayaA.id,
    })

    expect(() =>
      accounts.assertMayAssign(wilayaAdmin, {
        role: AdminRole.WILAYA_ADMIN,
        wilayaId: geo.wilayaB.id,
        communeId: null,
      }),
    ).toThrow(/outside your own scope/i)
  })

  it('stops a COMMUNE_ADMIN assigning a different commune', async () => {
    const communeAdmin = await createAdmin(prisma, {
      role: AdminRole.COMMUNE_ADMIN,
      wilayaId: geo.wilayaA.id,
      communeId: geo.communeA1.id,
    })

    expect(() =>
      accounts.assertMayAssign(communeAdmin, {
        role: AdminRole.COMMUNE_ADMIN,
        wilayaId: geo.wilayaA.id,
        communeId: geo.communeA2.id,
      }),
    ).toThrow(/outside your own scope/i)
  })

  it('lets a SUPER_ADMIN assign anywhere', async () => {
    const superAdmin = await createAdmin(prisma, { role: AdminRole.SUPER_ADMIN })

    expect(() =>
      accounts.assertMayAssign(superAdmin, {
        role: AdminRole.COMMUNE_ADMIN,
        wilayaId: geo.wilayaB.id,
        communeId: geo.communeB1.id,
      }),
    ).not.toThrow()
  })

  it('stops an administrator editing their own role or scope', async () => {
    const superAdmin = await createAdmin(prisma, { role: AdminRole.SUPER_ADMIN })

    expect(() => accounts.assertNotSelf(superAdmin, superAdmin.id)).toThrow(/your own/i)
    await expect(
      accounts.prepareScopeChange(superAdmin, superAdmin.id, { role: AdminRole.SUPER_ADMIN }),
    ).rejects.toMatchObject({ status: 403 })
  })
})

describe('last SUPER_ADMIN invariant', () => {
  it('refuses to release the only active SUPER_ADMIN', async () => {
    const only = await createAdmin(prisma, { role: AdminRole.SUPER_ADMIN })

    await expect(accounts.assertNotLastSuperAdmin(only.id)).rejects.toMatchObject({
      status: 409,
      code: 'LAST_SUPER_ADMIN',
    })
  })

  it('allows it once a second active SUPER_ADMIN exists', async () => {
    const first = await createAdmin(prisma, { role: AdminRole.SUPER_ADMIN })
    await createAdmin(prisma, { role: AdminRole.SUPER_ADMIN })

    await expect(accounts.assertNotLastSuperAdmin(first.id)).resolves.toBeUndefined()
  })

  it('does not count deactivated SUPER_ADMINs as cover', async () => {
    const active = await createAdmin(prisma, { role: AdminRole.SUPER_ADMIN })
    await createAdmin(prisma, { role: AdminRole.SUPER_ADMIN, isActive: false })

    await expect(accounts.assertNotLastSuperAdmin(active.id)).rejects.toMatchObject({
      code: 'LAST_SUPER_ADMIN',
    })
  })

  it('blocks demoting the last SUPER_ADMIN, too', async () => {
    const actor = await createAdmin(prisma, { role: AdminRole.SUPER_ADMIN })
    const target = await createAdmin(prisma, { role: AdminRole.SUPER_ADMIN })
    // Deactivate the actor's peer cover so `target` is the last active one.
    await prisma.user.update({ where: { id: actor.id }, data: { isActive: false } })

    await expect(
      accounts.prepareScopeChange(actor, target.id, {
        role: AdminRole.WILAYA_ADMIN,
        wilayaId: geo.wilayaA.id,
      }),
    ).rejects.toMatchObject({ code: 'LAST_SUPER_ADMIN' })
  })

  it('ignores non-SUPER_ADMIN accounts', async () => {
    const wilayaAdmin = await createAdmin(prisma, {
      role: AdminRole.WILAYA_ADMIN,
      wilayaId: geo.wilayaA.id,
    })

    await expect(accounts.assertNotLastSuperAdmin(wilayaAdmin.id)).resolves.toBeUndefined()
  })
})

describe('scope resolution', () => {
  it('refuses to widen scope when a record is somehow inconsistent', () => {
    // The database prevents this; if it ever happened, failing closed beats
    // silently treating a scoped admin as national.
    expect(() => resolveScope({ role: AdminRole.WILAYA_ADMIN, wilayaId: null, communeId: null })).toThrow()
    expect(() => resolveScope({ role: AdminRole.SUPER_ADMIN, wilayaId: 'w1', communeId: null })).toThrow()
  })

  it('derives scope only from the stored record', async () => {
    const communeAdmin = await createAdmin(prisma, {
      role: AdminRole.COMMUNE_ADMIN,
      wilayaId: geo.wilayaA.id,
      communeId: geo.communeA1.id,
    })

    expect(authorization.scopeFor(communeAdmin)).toEqual({
      kind: 'commune',
      wilayaId: geo.wilayaA.id,
      communeId: geo.communeA1.id,
    })
    expect(authorization.canReachWilaya(communeAdmin, geo.wilayaB.id)).toBe(false)
    expect(authorization.canReachCommune(communeAdmin, geo.communeA2)).toBe(false)
    expect(authorization.canReachCommune(communeAdmin, geo.communeA1)).toBe(true)
  })
})
