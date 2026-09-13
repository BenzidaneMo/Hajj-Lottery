import { AdminRole, PrismaClient } from '@prisma/client'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import { ParticipantService } from '../src/services/participant.service.js'
import { createAdminAndSignIn, ensureTestGeography } from './helpers/admins.js'
import { participantFixture } from './helpers/participants.js'

const app = createApp()
const prisma = new PrismaClient()
const service = new ParticipantService(prisma)

/** A well-formed request body; individual tests override single fields. */
function body(overrides: Record<string, unknown> = {}) {
  return {
    nationalId: '112233445566778899',
    firstNameAr: 'ياسين',
    lastNameAr: 'بلقاسم',
    firstNameLatin: 'Yanis',
    lastNameLatin: 'Belkacem',
    dob: '1985-04-12',
    gender: 'MALE',
    phoneNumber: '0555123456',
    ...overrides,
  }
}

// Participant endpoints are SUPER_ADMIN-only (identity is national; there is
// no commune to scope by until applications exist).
let superAdminCookie: string

const post = (payload: Record<string, unknown>) =>
  request(app).post('/api/participants').set('Cookie', superAdminCookie).send(payload)

const get = (path: string) => request(app).get(path).set('Cookie', superAdminCookie)

beforeAll(async () => {
  await prisma.$connect()
})

// setup.ts truncates users between tests, so the signed-in administrator is
// recreated for each one.
beforeEach(async () => {
  const signedIn = await createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })
  superAdminCookie = signedIn.cookie
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('POST /api/participants', () => {
  it('creates a participant', async () => {
    const response = await post(body())

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      nationalId: '112233445566778899',
      firstNameAr: 'ياسين',
      lastNameAr: 'بلقاسم',
      firstNameLatin: 'Yanis',
      lastNameLatin: 'Belkacem',
      dob: '1985-04-12',
      gender: 'MALE',
      phoneNumber: '+213555123456',
      hasWonHajj: false,
    })
    expect(response.body.id).toEqual(expect.any(String))

    const stored = await prisma.participant.findUnique({
      where: { nationalId: '112233445566778899' },
    })
    expect(stored).not.toBeNull()
  })

  it('defaults has_won_hajj to false and ignores an attempt to set it', async () => {
    const response = await post(body({ hasWonHajj: true }))

    // `.strict()` rejects unknown keys, so the winner flag cannot be set here
    // at all — it is owned by the later winner-processing step.
    expect(response.status).toBe(400)
    expect(response.body.code).toBe('VALIDATION_FAILED')

    const created = await post(body())
    expect(created.body.hasWonHajj).toBe(false)

    const stored = await prisma.participant.findUniqueOrThrow({
      where: { nationalId: '112233445566778899' },
    })
    expect(stored.hasWonHajj).toBe(false)
  })

  it('stores the normalized national ID when it is typed with separators', async () => {
    const response = await post(body({ nationalId: '1122-3344 5566.7788/99' }))

    expect(response.status).toBe(201)
    expect(response.body.nationalId).toBe('112233445566778899')
  })

  it('stores the normalized national ID when it is typed in Arabic-Indic digits', async () => {
    const response = await post(body({ nationalId: '١١٢٢٣٣٤٤٥٥٦٦٧٧٨٨٩٩' }))

    expect(response.status).toBe(201)
    expect(response.body.nationalId).toBe('112233445566778899')
  })

  describe('rejects an invalid national ID', () => {
    const cases: Array<[string, unknown]> = [
      ['too short', '12345'],
      ['too long', '1'.repeat(19)],
      ['non-numeric', 'not-a-national-id!'],
      ['empty', ''],
      ['missing', undefined],
      ['wrong type', 12345],
    ]

    it.each(cases)('%s', async (_label, nationalId) => {
      const payload = body()
      if (nationalId === undefined) delete (payload as Record<string, unknown>).nationalId
      else payload.nationalId = nationalId as string

      const response = await post(payload)

      expect(response.status).toBe(400)
      expect(response.body.code).toBe('VALIDATION_FAILED')
      expect(response.body.details).toHaveProperty('nationalId')
      expect(await prisma.participant.count()).toBe(0)
    })
  })

  describe('rejects an invalid date of birth', () => {
    const cases: Array<[string, unknown]> = [
      ['impossible calendar date', '2024-02-31'],
      ['out-of-range month', '2024-13-01'],
      ['wrong format', '12/04/1985'],
      ['not a date at all', 'yesterday'],
      ['in the future', '2999-01-01'],
      ['implausibly early', '1799-01-01'],
      ['empty', ''],
      ['missing', undefined],
    ]

    it.each(cases)('%s', async (_label, dob) => {
      const payload = body()
      if (dob === undefined) delete (payload as Record<string, unknown>).dob
      else payload.dob = dob as string

      const response = await post(payload)

      expect(response.status).toBe(400)
      expect(response.body.code).toBe('VALIDATION_FAILED')
      expect(response.body.details).toHaveProperty('dob')
      expect(await prisma.participant.count()).toBe(0)
    })
  })

  it('rejects a missing, over-long or wrong-script name field', async () => {
    const missing = await post(body({ firstNameAr: '   ' }))
    expect(missing.status).toBe(400)
    expect(missing.body.details).toHaveProperty('firstNameAr')

    const tooLong = await post(body({ lastNameLatin: 'x'.repeat(101) }))
    expect(tooLong.status).toBe(400)
    expect(tooLong.body.details).toHaveProperty('lastNameLatin')

    const wrongScript = await post(body({ firstNameAr: 'Yanis' }))
    expect(wrongScript.status).toBe(400)
    expect(wrongScript.body.details).toHaveProperty('firstNameAr')

    const digits = await post(body({ firstNameLatin: '12345' }))
    expect(digits.status).toBe(400)
    expect(digits.body.details).toHaveProperty('firstNameLatin')
  })

  it('rejects a duplicate national ID with 409', async () => {
    const first = await post(body())
    expect(first.status).toBe(201)

    const duplicate = await post(body({ lastNameLatin: 'Someone Else' }))

    expect(duplicate.status).toBe(409)
    expect(duplicate.body.code).toBe('DUPLICATE_NATIONAL_ID')
    expect(duplicate.body).not.toHaveProperty('stack')
    expect(await prisma.participant.count()).toBe(1)
  })

  it('treats a differently-formatted duplicate as the same person', async () => {
    await post(body())
    const duplicate = await post(body({ nationalId: '1122 3344 5566 7788 99' }))

    expect(duplicate.status).toBe(409)
    expect(await prisma.participant.count()).toBe(1)
  })
})

describe('GET /api/participants/:id', () => {
  it('returns the participant', async () => {
    const created = await post(body())

    const response = await get(`/api/participants/${created.body.id}`)

    expect(response.status).toBe(200)
    expect(response.body.id).toBe(created.body.id)
  })

  it('404s for an unknown id', async () => {
    const response = await get('/api/participants/does-not-exist')

    expect(response.status).toBe(404)
    expect(response.body.code).toBe('PARTICIPANT_NOT_FOUND')
  })
})

describe('GET /api/participants/by-national-id/:nationalId', () => {
  it('finds an existing participant', async () => {
    const created = await post(body())

    const response = await get('/api/participants/by-national-id/112233445566778899')

    expect(response.status).toBe(200)
    expect(response.body.id).toBe(created.body.id)
    expect(response.body.firstNameLatin).toBe('Yanis')
  })

  it('finds the participant regardless of how the ID is formatted', async () => {
    const created = await post(body())

    const response = await get('/api/participants/by-national-id/1122-3344-5566-7788-99')

    expect(response.status).toBe(200)
    expect(response.body.id).toBe(created.body.id)
  })

  it('404s for an unknown national ID', async () => {
    const response = await get('/api/participants/by-national-id/999999999999999999')

    expect(response.status).toBe(404)
    expect(response.body.code).toBe('PARTICIPANT_NOT_FOUND')
  })

  it('404s rather than 400s for a malformed national ID, leaking nothing', async () => {
    const response = await get('/api/participants/by-national-id/nonsense')

    expect(response.status).toBe(404)
    expect(response.body.code).toBe('PARTICIPANT_NOT_FOUND')
  })
})

describe('access control', () => {
  it('rejects an unauthenticated request', async () => {
    const response = await request(app).get('/api/participants/by-national-id/112233445566778899')

    expect(response.status).toBe(401)
    expect(response.body.code).toBe('UNAUTHORIZED')
  })

  it('rejects a forged session cookie', async () => {
    const response = await request(app)
      .post('/api/participants')
      .set('Cookie', 'hajj_admin_session=not-a-real-token')
      .send(body())

    expect(response.status).toBe(401)
    expect(await prisma.participant.count()).toBe(0)
  })

  it('rejects an authenticated administrator without the SUPER_ADMIN role', async () => {
    const { wilayaA, communeA1 } = await ensureTestGeography(prisma)

    for (const options of [
      { role: AdminRole.WILAYA_ADMIN, wilayaId: wilayaA.id },
      { role: AdminRole.COMMUNE_ADMIN, wilayaId: wilayaA.id, communeId: communeA1.id },
    ]) {
      const { cookie } = await createAdminAndSignIn(app, prisma, options)

      const read = await request(app)
        .get('/api/participants/by-national-id/112233445566778899')
        .set('Cookie', cookie)
      expect(read.status).toBe(403)
      expect(read.body.code).toBe('FORBIDDEN_ROLE')

      const write = await request(app).post('/api/participants').set('Cookie', cookie).send(body())
      expect(write.status).toBe(403)
    }

    expect(await prisma.participant.count()).toBe(0)
  })

  it('leaves the public API reachable without a session', async () => {
    const response = await request(app).get('/api/health')

    expect(response.status).toBe(200)
  })
})

describe('ParticipantService', () => {
  it('finds an existing participant by national ID', async () => {
    const created = await service.create(
      participantFixture('112233445566778899', {
        lastNameLatin: 'Service Lookup',
        dob: new Date('1970-02-03T00:00:00.000Z'),
      }),
    )

    const found = await service.findByNationalId('1122 3344 5566 7788 99')

    expect(found?.id).toBe(created.id)
  })

  it('returns null for an unknown or unusable national ID', async () => {
    expect(await service.findByNationalId('999999999999999999')).toBeNull()
    expect(await service.findByNationalId('nonsense')).toBeNull()
  })

  it('findOrCreate creates when absent and reuses when present', async () => {
    const input = participantFixture('112233445566778899', {
      lastNameLatin: 'Find Or Create',
      dob: new Date('1988-08-08T00:00:00.000Z'),
    })

    const first = await service.findOrCreate(input)
    expect(first.created).toBe(true)

    const second = await service.findOrCreate({ ...input, lastNameLatin: 'Different Name' })

    expect(second.created).toBe(false)
    expect(second.participant.id).toBe(first.participant.id)
    // The existing identity wins; findOrCreate never rewrites a known person.
    expect(second.participant.lastNameLatin).toBe('Find Or Create')
    expect(await prisma.participant.count()).toBe(1)
  })

  it('never creates two records for the same ID under concurrent calls', async () => {
    const input = participantFixture('112233445566778899', {
      lastNameLatin: 'Concurrent',
      dob: new Date('1991-01-01T00:00:00.000Z'),
    })

    const results = await Promise.all([
      service.findOrCreate(input),
      service.findOrCreate(input),
      service.findOrCreate(input),
    ])

    const ids = new Set(results.map((r) => r.participant.id))
    expect(ids.size).toBe(1)
    expect(results.filter((r) => r.created)).toHaveLength(1)
    expect(await prisma.participant.count()).toBe(1)
  })
})

describe('identity is independent of geography and applications', () => {
  it('creates a participant with no commune, and stores no application columns', async () => {
    const response = await post(body())
    expect(response.status).toBe(201)

    // A participant answers "who is this person?" only.
    for (const field of ['communeId', 'wilayaId', 'drawYear', 'status', 'weight', 'entryType']) {
      expect(response.body).not.toHaveProperty(field)
    }

    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'participants'
    `
    const names = columns.map((c) => c.column_name).sort()

    // Pinned deliberately: identity and contact details only. Anything about
    // a particular year's participation — draw year, commune, status, weight,
    // entry type — belongs on `applications`, and adding it here should fail.
    expect(names).toEqual([
      'created_at',
      'dob',
      'first_name_ar',
      'first_name_latin',
      'gender',
      'has_won_hajj',
      'id',
      'last_name_ar',
      'last_name_latin',
      'national_id',
      'phone_number',
      'phone_verified_at',
      'updated_at',
    ])
  })

  it('enforces national_id uniqueness in PostgreSQL, not just in code', async () => {
    await post(body())

    // Bypasses the service entirely: the constraint must live in the database.
    // Every NOT NULL column is supplied so the insert fails for the reason
    // this test is about — the unique index — and not some other one.
    await expect(
      prisma.$executeRaw`
        INSERT INTO "participants"
          ("id", "national_id", "first_name_ar", "last_name_ar", "first_name_latin",
           "last_name_latin", "dob", "gender", "phone_number", "updated_at")
        VALUES ('raw-duplicate', '112233445566778899', 'ياسين', 'بلقاسم', 'Raw', 'Insert',
                DATE '1985-04-12', 'MALE', '+213555000000', NOW())
      `,
    ).rejects.toThrow()

    expect(await prisma.participant.count()).toBe(1)
  })
})
