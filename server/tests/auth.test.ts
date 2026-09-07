import { AdminRole, PrismaClient, type User } from '@prisma/client'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { createApp } from '../src/app.js'
import { SESSION_COOKIE_NAME } from '../src/config/session-cookie.js'
import { hashPassword } from '../src/lib/password.js'
import { AuthService } from '../src/services/auth.service.js'

const app = createApp()
const prisma = new PrismaClient()
const authService = new AuthService(prisma)

const USERNAME = 'super.admin'
const PASSWORD = 'correct horse battery staple'

async function createAdmin(overrides: Partial<User> = {}): Promise<User> {
  return prisma.user.create({
    data: {
      username: USERNAME,
      passwordHash: await hashPassword(PASSWORD),
      role: AdminRole.SUPER_ADMIN,
      ...overrides,
    },
  })
}

const login = (username = USERNAME, password = PASSWORD) =>
  request(app).post('/api/auth/login').send({ username, password })

/** The `name=value` pair from Set-Cookie, ready to send back as `Cookie`. */
function sessionCookie(response: request.Response): string {
  const header = response.headers['set-cookie'] as unknown as string[] | undefined
  const cookie = header?.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`))
  if (!cookie) throw new Error('No session cookie was set')
  return cookie.split(';')[0] as string
}

function sessionCookieAttributes(response: request.Response): string {
  const header = response.headers['set-cookie'] as unknown as string[] | undefined
  const cookie = header?.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`))
  if (!cookie) throw new Error('No session cookie was set')
  return cookie
}

beforeAll(async () => {
  await prisma.$connect()
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('POST /api/auth/login', () => {
  it('authenticates valid credentials and returns safe user information', async () => {
    await createAdmin()

    const response = await login()

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ username: USERNAME, role: 'SUPER_ADMIN' })
    expect(response.body.id).toEqual(expect.any(String))
    // Nothing sensitive may appear in the response.
    for (const field of ['passwordHash', 'password_hash', 'password', 'token', 'sessionToken']) {
      expect(response.body).not.toHaveProperty(field)
    }
    expect(JSON.stringify(response.body)).not.toContain('argon2')
  })

  it('accepts the username case-insensitively', async () => {
    await createAdmin()

    const response = await login('SUPER.Admin')

    expect(response.status).toBe(200)
  })

  it('records last_login_at, reporting the previous value to the client', async () => {
    const admin = await createAdmin()
    expect(admin.lastLoginAt).toBeNull()

    const first = await login()
    expect(first.body.lastLoginAt).toBeNull()

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })
    expect(stored.lastLoginAt).toBeInstanceOf(Date)

    const second = await login()
    expect(second.body.lastLoginAt).not.toBeNull()
  })

  it('rejects an unknown username', async () => {
    await createAdmin()

    const response = await login('someone.else')

    expect(response.status).toBe(401)
    expect(await prisma.session.count()).toBe(0)
  })

  it('rejects a wrong password', async () => {
    await createAdmin()

    const response = await login(USERNAME, 'not the password')

    expect(response.status).toBe(401)
    expect(await prisma.session.count()).toBe(0)
  })

  it('gives byte-identical responses for unknown user and wrong password', async () => {
    await createAdmin()

    const unknownUser = await login('someone.else', PASSWORD)
    const wrongPassword = await login(USERNAME, 'not the password')
    const malformedBody = await request(app).post('/api/auth/login').send({ username: USERNAME })

    expect(unknownUser.status).toBe(wrongPassword.status)
    expect(unknownUser.body).toEqual(wrongPassword.body)
    // A malformed body must not be a cheaper oracle than a bad password.
    expect(malformedBody.status).toBe(wrongPassword.status)
    expect(malformedBody.body).toEqual(wrongPassword.body)

    // And the message must not name which half was wrong.
    const message = JSON.stringify(unknownUser.body).toLowerCase()
    for (const leak of ['exist', 'not found', 'unknown user', 'incorrect password', 'wrong password']) {
      expect(message).not.toContain(leak)
    }
  })

  it('refuses a deactivated administrator, indistinguishably', async () => {
    await createAdmin({ isActive: false })

    const response = await login()
    const wrongPassword = await login(USERNAME, 'not the password')

    expect(response.status).toBe(401)
    expect(response.body).toEqual(wrongPassword.body)
    expect(await prisma.session.count()).toBe(0)
  })
})

describe('session cookie', () => {
  it('is HttpOnly, SameSite=Lax, scoped to /api, and carries an opaque token', async () => {
    await createAdmin()

    const attributes = sessionCookieAttributes(await login())

    expect(attributes).toMatch(/HttpOnly/i)
    expect(attributes).toMatch(/SameSite=Lax/i)
    expect(attributes).toMatch(/Path=\/api/i)
    expect(attributes).toMatch(/Max-Age=\d+/i)
    // Not secure under NODE_ENV=test, so local HTTP development works.
    expect(attributes).not.toMatch(/Secure/i)

    // The cookie value must be the raw token, not anything derived from the
    // user record.
    const value = attributes.split(';')[0]?.split('=')[1] ?? ''
    expect(value.length).toBeGreaterThanOrEqual(32)
    expect(value).not.toContain(USERNAME)
  })

  it('stores only a hash of the token, never the token itself', async () => {
    await createAdmin()
    const response = await login()
    const token = sessionCookie(response).split('=')[1] as string

    const sessions = await prisma.session.findMany()
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.tokenHash).not.toBe(token)
    expect(sessions[0]?.tokenHash).toHaveLength(64) // sha256 hex
  })

  it('marks the cookie Secure when running in production', async () => {
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    // The cookie config reads NODE_ENV once, at module load, so the module
    // graph has to be re-evaluated to observe the production branch.
    vi.resetModules()
    try {
      const { sessionCookieOptions } = await import('../src/config/session-cookie.js')
      expect(sessionCookieOptions().secure).toBe(true)
    } finally {
      process.env.NODE_ENV = previous
      vi.resetModules()
    }
  })
})

describe('GET /api/auth/me', () => {
  it('returns the authenticated administrator', async () => {
    await createAdmin()
    const cookie = sessionCookie(await login())

    const response = await request(app).get('/api/auth/me').set('Cookie', cookie)

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ username: USERNAME, role: 'SUPER_ADMIN' })
    expect(response.body).not.toHaveProperty('passwordHash')
  })

  it('rejects a request with no session cookie', async () => {
    const response = await request(app).get('/api/auth/me')

    expect(response.status).toBe(401)
    expect(response.body.code).toBe('UNAUTHORIZED')
  })

  it('rejects a forged or stale token', async () => {
    const response = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `${SESSION_COOKIE_NAME}=not-a-real-token`)

    expect(response.status).toBe(401)
  })

  it('rejects a session whose user was deactivated after signing in', async () => {
    const admin = await createAdmin()
    const cookie = sessionCookie(await login())

    await prisma.user.update({ where: { id: admin.id }, data: { isActive: false } })

    const response = await request(app).get('/api/auth/me').set('Cookie', cookie)

    expect(response.status).toBe(401)
    // Deactivation revokes every session, not just this request.
    expect(await prisma.session.count()).toBe(0)
  })

  it('rejects an expired session and cleans the row up', async () => {
    await createAdmin()
    const cookie = sessionCookie(await login())

    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } })

    const response = await request(app).get('/api/auth/me').set('Cookie', cookie)

    expect(response.status).toBe(401)
    expect(await prisma.session.count()).toBe(0)
  })
})

describe('POST /api/auth/logout', () => {
  it('invalidates the session server-side', async () => {
    await createAdmin()
    const cookie = sessionCookie(await login())

    const logout = await request(app).post('/api/auth/logout').set('Cookie', cookie)
    expect(logout.status).toBe(204)
    expect(await prisma.session.count()).toBe(0)

    // The same cookie must no longer work, even though the browser still has it.
    const afterLogout = await request(app).get('/api/auth/me').set('Cookie', cookie)
    expect(afterLogout.status).toBe(401)
  })

  it('clears the cookie in the response', async () => {
    await createAdmin()
    const cookie = sessionCookie(await login())

    const response = await request(app).post('/api/auth/logout').set('Cookie', cookie)

    const cleared = (response.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith(`${SESSION_COOKIE_NAME}=`),
    )
    expect(cleared).toMatch(/hajj_admin_session=;/)
  })

  it('requires authentication', async () => {
    const response = await request(app).post('/api/auth/logout')

    expect(response.status).toBe(401)
  })

  it('leaves other sessions of the same administrator alone', async () => {
    await createAdmin()
    const first = sessionCookie(await login())
    const second = sessionCookie(await login())

    await request(app).post('/api/auth/logout').set('Cookie', first)

    expect(await request(app).get('/api/auth/me').set('Cookie', first)).toMatchObject({ status: 401 })
    expect(await request(app).get('/api/auth/me').set('Cookie', second)).toMatchObject({ status: 200 })
  })
})

describe('password storage', () => {
  it('never stores the plaintext password', async () => {
    await createAdmin()

    const stored = await prisma.user.findUniqueOrThrow({ where: { username: USERNAME } })

    expect(stored.passwordHash).not.toBe(PASSWORD)
    expect(stored.passwordHash).not.toContain(PASSWORD)
    expect(stored.passwordHash.startsWith('$argon2id$')).toBe(true)

    // Nothing anywhere in the row leaks the password.
    expect(JSON.stringify(stored)).not.toContain(PASSWORD)
  })

  it('produces a different hash for the same password each time', async () => {
    const [a, b] = [await hashPassword(PASSWORD), await hashPassword(PASSWORD)]

    expect(a).not.toBe(b) // distinct salts
  })
})

describe('brute-force protection', () => {
  it('starts rejecting repeated failures with 429', async () => {
    await createAdmin()
    // A dedicated app instance, so this test's budget is its own.
    const isolated = createApp()

    const statuses: number[] = []
    for (let attempt = 0; attempt < 12; attempt++) {
      const response = await request(isolated)
        .post('/api/auth/login')
        .send({ username: USERNAME, password: 'wrong password' })
      statuses.push(response.status)
    }

    expect(statuses.filter((s) => s === 401).length).toBe(10)
    expect(statuses.filter((s) => s === 429).length).toBe(2)
    expect(statuses.at(-1)).toBe(429)
  })

  it('budgets per username, so one account cannot lock out another', async () => {
    await createAdmin()
    await prisma.user.create({
      data: {
        username: 'other.admin',
        passwordHash: await hashPassword(PASSWORD),
        // National, so this fixture needs no wilaya; the role/scope CHECK
        // constraint would reject a WILAYA_ADMIN without one.
        role: AdminRole.SUPER_ADMIN,
      },
    })
    const isolated = createApp()

    for (let attempt = 0; attempt < 11; attempt++) {
      await request(isolated).post('/api/auth/login').send({ username: USERNAME, password: 'wrong' })
    }

    const other = await request(isolated)
      .post('/api/auth/login')
      .send({ username: 'other.admin', password: PASSWORD })

    expect(other.status).toBe(200)
  })
})

describe('CSRF and CORS posture', () => {
  it('rejects a state-changing request from an unrecognized origin', async () => {
    await createAdmin()

    const response = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ username: USERNAME, password: PASSWORD })

    expect(response.status).toBe(403)
    expect(response.body.code).toBe('FORBIDDEN_ORIGIN')
    expect(await prisma.session.count()).toBe(0)
  })

  it('allows a state-changing request from the configured client origin', async () => {
    await createAdmin()

    const response = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .send({ username: USERNAME, password: PASSWORD })

    expect(response.status).toBe(200)
  })

  it('never answers a credentialed request with a wildcard origin', async () => {
    const response = await request(app).get('/api/health').set('Origin', 'http://localhost:5173')

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173')
    expect(response.headers['access-control-allow-credentials']).toBe('true')
  })
})

describe('authentication service internals', () => {
  it('does not reveal, through its return value, why credentials failed', async () => {
    await createAdmin({ isActive: false })

    expect(await authService.verifyCredentials(USERNAME, PASSWORD)).toBeNull()
    expect(await authService.verifyCredentials(USERNAME, 'wrong')).toBeNull()
    expect(await authService.verifyCredentials('nobody', PASSWORD)).toBeNull()
  })

  it('purges expired sessions', async () => {
    const admin = await createAdmin()
    await authService.startSession(admin.id)
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } })

    expect(await authService.purgeExpiredSessions()).toBe(1)
    expect(await prisma.session.count()).toBe(0)
  })
})
