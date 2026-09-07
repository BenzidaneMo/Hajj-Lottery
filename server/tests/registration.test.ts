import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import { communeToken, generateApplicationReference } from '../src/lib/application-reference.js'
import { isValidPhoneNumber, normalizePhoneNumber } from '../src/lib/phone.js'
import { ensureTestGeography, type TestGeography } from './helpers/admins.js'

const prisma = new PrismaClient()

/**
 * A fresh app per test, because the registration rate limit is real and
 * keeps its counter per app instance. Rebuilding it isolates tests from one
 * another instead of weakening the limit for all of them; the limit itself is
 * exercised deliberately further down.
 */
let app: ReturnType<typeof createApp>
let geo: TestGeography
const DRAW_YEAR = new Date().getUTCFullYear()

const NATIONAL_IDS = {
  ahmed: '111111111111111111',
  fatima: '222222222222222222',
  karim: '333333333333333333',
  leila: '444444444444444444',
}

function applicant(nationalId: string, overrides: Record<string, unknown> = {}) {
  return {
    nationalId,
    fullName: 'Test Applicant',
    dob: '1985-04-12',
    phoneNumber: '0555123456',
    ...overrides,
  }
}

function singleBody(overrides: Record<string, unknown> = {}) {
  return {
    entryType: 'SINGLE',
    wilayaId: geo.wilayaA.id,
    communeId: geo.communeA1.id,
    primary: applicant(NATIONAL_IDS.ahmed),
    ...overrides,
  }
}

function pairedBody(overrides: Record<string, unknown> = {}) {
  return {
    entryType: 'PAIRED',
    wilayaId: geo.wilayaA.id,
    communeId: geo.communeA1.id,
    primary: applicant(NATIONAL_IDS.ahmed),
    secondary: applicant(NATIONAL_IDS.fatima, { fullName: 'Second Applicant' }),
    ...overrides,
  }
}

/** Deliberately no cookie, no header: citizens register unauthenticated. */
const submit = (body: Record<string, unknown>) => request(app).post('/api/applications').send(body)

beforeAll(async () => {
  await prisma.$connect()
})

beforeEach(async () => {
  app = createApp()
  geo = await ensureTestGeography(prisma)
  await prisma.applicationParticipant.deleteMany()
  await prisma.application.deleteMany()
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('POST /api/applications — single', () => {
  it('accepts a valid application from an unauthenticated citizen', async () => {
    const response = await submit(singleBody())

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      drawYear: DRAW_YEAR,
      entryType: 'SINGLE',
      status: 'PENDING',
      applicantCount: 1,
    })
    expect(response.body.applicationReference).toMatch(/^HZ-\d{4}-[A-Z]{3}-[0-9A-Z]{6}$/)
    expect(response.body.commune.code).toBe(geo.communeA1.code)
  })

  it('creates the participant and links the application to them', async () => {
    await submit(singleBody())

    const participant = await prisma.participant.findUniqueOrThrow({
      where: { nationalId: NATIONAL_IDS.ahmed },
    })
    const application = await prisma.application.findFirstOrThrow()

    expect(application.primaryParticipantId).toBe(participant.id)
    expect(application.secondaryParticipantId).toBeNull()
    expect(application.entryType).toBe('SINGLE')
    expect(application.drawYear).toBe(DRAW_YEAR)
    expect(application.communeId).toBe(geo.communeA1.id)
  })

  it('records exactly one participation row for a single application', async () => {
    await submit(singleBody())

    const rows = await prisma.applicationParticipant.findMany()

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ role: 'PRIMARY', drawYear: DRAW_YEAR })
  })
})

describe('POST /api/applications — paired', () => {
  it('accepts a pair and links both participants', async () => {
    const response = await submit(pairedBody())

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({ entryType: 'PAIRED', applicantCount: 2 })

    const application = await prisma.application.findFirstOrThrow()
    expect(application.secondaryParticipantId).not.toBeNull()
    expect(application.primaryParticipantId).not.toBe(application.secondaryParticipantId)

    const rows = await prisma.applicationParticipant.findMany({ orderBy: { role: 'asc' } })
    expect(rows.map((r) => r.role)).toEqual(['PRIMARY', 'SECONDARY'])
    expect(await prisma.participant.count()).toBe(2)
  })

  it('rejects a pair of the same person', async () => {
    const response = await submit(
      pairedBody({ secondary: applicant(NATIONAL_IDS.ahmed, { fullName: 'Same Person' }) }),
    )

    expect(response.status).toBe(400)
    expect(await prisma.application.count()).toBe(0)
  })

  it('rejects PAIRED without a second applicant, and SINGLE with one', async () => {
    const missing = await submit(pairedBody({ secondary: undefined }))
    expect(missing.status).toBe(400)

    const extra = await submit(singleBody({ secondary: applicant(NATIONAL_IDS.fatima) }))
    expect(extra.status).toBe(400)

    expect(await prisma.application.count()).toBe(0)
  })
})

describe('participant identity', () => {
  it('reuses an existing participant rather than creating a second record', async () => {
    const existing = await prisma.participant.create({
      data: {
        nationalId: NATIONAL_IDS.ahmed,
        fullName: 'Original Name',
        dob: new Date('1970-01-01T00:00:00.000Z'),
        phoneNumber: '+213555000111',
      },
    })

    const response = await submit(singleBody())
    expect(response.status).toBe(201)

    expect(await prisma.participant.count()).toBe(1)
    const application = await prisma.application.findFirstOrThrow()
    expect(application.primaryParticipantId).toBe(existing.id)
  })

  it('never overwrites an existing participant, even when details differ', async () => {
    await prisma.participant.create({
      data: {
        nationalId: NATIONAL_IDS.ahmed,
        fullName: 'Original Name',
        dob: new Date('1970-01-01T00:00:00.000Z'),
        phoneNumber: '+213555000111',
      },
    })

    await submit(
      singleBody({
        primary: applicant(NATIONAL_IDS.ahmed, {
          fullName: 'Completely Different',
          dob: '1999-09-09',
          phoneNumber: '0666999888',
        }),
      }),
    )

    const stored = await prisma.participant.findUniqueOrThrow({
      where: { nationalId: NATIONAL_IDS.ahmed },
    })
    expect(stored.fullName).toBe('Original Name')
    expect(stored.dob.toISOString().slice(0, 10)).toBe('1970-01-01')
    expect(stored.phoneNumber).toBe('+213555000111')
  })

  it('treats a differently-formatted national ID as the same person', async () => {
    await submit(singleBody())
    const reformatted = await submit(singleBody({ primary: applicant('1111-1111 1111.111111') }))

    // Same person, already applied this year.
    expect(reformatted.status).toBe(409)
    expect(await prisma.participant.count()).toBe(1)
  })

  it('stores no identity information on the application row itself', async () => {
    await submit(pairedBody())

    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'applications'
    `
    const names = columns.map((c) => c.column_name)

    for (const leaked of [
      'full_name',
      'national_id',
      'dob',
      'phone_number',
      'secondary_name',
      'secondary_dob',
    ]) {
      expect(names).not.toContain(leaked)
    }
  })
})

describe('one application per person per draw year', () => {
  it('rejects the same person applying twice', async () => {
    expect((await submit(singleBody())).status).toBe(201)

    const second = await submit(singleBody())

    expect(second.status).toBe(409)
    expect(second.body.code).toBe('ALREADY_APPLIED')
    expect(await prisma.application.count()).toBe(1)
  })

  it('rejects the same person applying in a different commune', async () => {
    await submit(singleBody())

    const elsewhere = await submit(singleBody({ communeId: geo.communeA2.id }))

    expect(elsewhere.status).toBe(409)
    expect(await prisma.application.count()).toBe(1)
  })

  it('rejects the same person applying in a different wilaya', async () => {
    await submit(singleBody())

    const elsewhere = await submit(singleBody({ wilayaId: geo.wilayaB.id, communeId: geo.communeB1.id }))

    expect(elsewhere.status).toBe(409)
    expect(await prisma.application.count()).toBe(1)
  })

  it('rejects a secondary applicant who already applied as primary', async () => {
    await submit(singleBody({ primary: applicant(NATIONAL_IDS.fatima) }))

    const paired = await submit(
      pairedBody({ primary: applicant(NATIONAL_IDS.karim) }), // secondary is fatima
    )

    expect(paired.status).toBe(409)
    expect(await prisma.application.count()).toBe(1)
  })

  it('rejects a primary applicant who is already someone else’s secondary', async () => {
    await submit(pairedBody())

    // Fatima was the secondary above; she cannot now apply as a primary.
    const asPrimary = await submit(singleBody({ primary: applicant(NATIONAL_IDS.fatima) }))

    expect(asPrimary.status).toBe(409)
    expect(await prisma.application.count()).toBe(1)
  })

  it('rejects the same person as secondary on two applications', async () => {
    await submit(pairedBody())

    const again = await submit(
      pairedBody({ primary: applicant(NATIONAL_IDS.karim) }), // fatima again
    )

    expect(again.status).toBe(409)
    expect(await prisma.application.count()).toBe(1)
  })
})

describe('lifetime winner exclusion', () => {
  it('rejects a primary applicant who has already won', async () => {
    await prisma.participant.create({
      data: {
        nationalId: NATIONAL_IDS.ahmed,
        fullName: 'Past Winner',
        dob: new Date('1970-01-01T00:00:00.000Z'),
        hasWonHajj: true,
      },
    })

    const response = await submit(singleBody())

    expect(response.status).toBe(422)
    expect(response.body.code).toBe('APPLICANT_NOT_ELIGIBLE')
    expect(await prisma.application.count()).toBe(0)
  })

  it('rejects a paired application whose secondary has already won', async () => {
    await prisma.participant.create({
      data: {
        nationalId: NATIONAL_IDS.fatima,
        fullName: 'Past Winner',
        dob: new Date('1970-01-01T00:00:00.000Z'),
        hasWonHajj: true,
      },
    })

    const response = await submit(pairedBody())

    expect(response.status).toBe(422)
    expect(await prisma.application.count()).toBe(0)
    // The refusal must not say which applicant, nor why.
    const message = JSON.stringify(response.body).toLowerCase()
    expect(message).not.toContain('won')
    expect(message).not.toContain('secondary')
    expect(message).not.toContain(NATIONAL_IDS.fatima)
  })

  it('leaves no participant created when the application is refused', async () => {
    await prisma.participant.create({
      data: {
        nationalId: NATIONAL_IDS.ahmed,
        fullName: 'Past Winner',
        dob: new Date('1970-01-01T00:00:00.000Z'),
        hasWonHajj: true,
      },
    })

    await submit(pairedBody())

    // The transaction rolled back, so the partner was not half-registered.
    expect(await prisma.participant.count()).toBe(1)
  })
})

describe('geography is validated server-side', () => {
  it('rejects a commune that belongs to a different wilaya', async () => {
    const response = await submit(singleBody({ wilayaId: geo.wilayaA.id, communeId: geo.communeB1.id }))

    expect(response.status).toBe(400)
    expect(response.body.code).toBe('INVALID_COMMUNE')
    expect(await prisma.application.count()).toBe(0)
  })

  it('rejects a commune that does not exist', async () => {
    const response = await submit(singleBody({ communeId: 'no-such-commune' }))

    expect(response.status).toBe(400)
    expect(response.body.code).toBe('INVALID_COMMUNE')
  })

  it('gives the same answer for a wrong-wilaya commune and a missing one', async () => {
    const mismatch = await submit(singleBody({ communeId: geo.communeB1.id }))
    const missing = await submit(singleBody({ communeId: 'no-such-commune' }))

    expect(mismatch.body).toEqual(missing.body)
  })

  it('rejects an inactive commune', async () => {
    await prisma.commune.update({ where: { id: geo.communeA1.id }, data: { isActive: false } })
    try {
      const response = await submit(singleBody())
      expect(response.status).toBe(400)
    } finally {
      await prisma.commune.update({ where: { id: geo.communeA1.id }, data: { isActive: true } })
    }
  })
})

describe('the client cannot choose the draw year', () => {
  it('ignores a drawYear in the body by rejecting the unknown field', async () => {
    const response = await submit({ ...singleBody(), drawYear: 1999 })

    expect(response.status).toBe(400)
    expect(await prisma.application.count()).toBe(0)
  })

  it('uses the server year even when a plausible one is submitted', async () => {
    const response = await submit({ ...singleBody(), drawYear: DRAW_YEAR + 5 })
    expect(response.status).toBe(400)

    const accepted = await submit(singleBody())
    expect(accepted.body.drawYear).toBe(DRAW_YEAR)
  })

  it('reports the window the form should use', async () => {
    const response = await request(app).get('/api/applications/registration-window')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ drawYear: DRAW_YEAR, isOpen: true })
  })
})

describe('concurrency', () => {
  it('lets exactly one of two simultaneous identical registrations win', async () => {
    const results = await Promise.all([submit(singleBody()), submit(singleBody()), submit(singleBody())])

    const created = results.filter((r) => r.status === 201)
    const rejected = results.filter((r) => r.status === 409)

    expect(created).toHaveLength(1)
    expect(rejected).toHaveLength(2)
    expect(await prisma.application.count()).toBe(1)
    expect(await prisma.participant.count()).toBe(1)
  })

  it('lets only one paired registration claim a shared secondary applicant', async () => {
    const results = await Promise.all([
      submit(pairedBody()),
      submit(pairedBody({ primary: applicant(NATIONAL_IDS.karim) })),
      submit(pairedBody({ primary: applicant(NATIONAL_IDS.leila) })),
    ])

    expect(results.filter((r) => r.status === 201)).toHaveLength(1)
    expect(results.filter((r) => r.status === 409)).toHaveLength(2)
    expect(await prisma.application.count()).toBe(1)
  })

  it('fails cleanly, never with a leaked database error', async () => {
    const results = await Promise.all([submit(singleBody()), submit(singleBody())])

    for (const rejected of results.filter((r) => r.status !== 201)) {
      expect(rejected.body.code).toBe('ALREADY_APPLIED')
      const body = JSON.stringify(rejected.body).toLowerCase()
      for (const leak of ['prisma', 'constraint', 'postgres', 'sql', 'stack']) {
        expect(body).not.toContain(leak)
      }
    }
  })
})

describe('the public response exposes nothing sensitive', () => {
  it('returns a receipt with no identity or database ids', async () => {
    const response = await submit(pairedBody())
    const body = JSON.stringify(response.body)

    for (const forbidden of [
      NATIONAL_IDS.ahmed,
      NATIONAL_IDS.fatima,
      'Test Applicant',
      'Second Applicant',
      '0555123456',
      '+213555123456',
      '1985-04-12',
    ]) {
      expect(body).not.toContain(forbidden)
    }

    for (const field of [
      'id',
      'primaryParticipantId',
      'secondaryParticipantId',
      'communeId',
      'participants',
      'hasWonHajj',
    ]) {
      expect(response.body).not.toHaveProperty(field)
    }
  })

  it('puts nothing sensitive in the application reference', async () => {
    const response = await submit(singleBody())
    const reference: string = response.body.applicationReference

    const application = await prisma.application.findFirstOrThrow()
    expect(reference).not.toContain(NATIONAL_IDS.ahmed)
    expect(reference).not.toContain(application.id)
    expect(reference).not.toContain(application.primaryParticipantId)
  })
})

describe('application reference generation', () => {
  it('produces distinct references across many draws', () => {
    const references = new Set(
      Array.from({ length: 2000 }, () => generateApplicationReference(2027, 'Mesra')),
    )

    // 32^6 possibilities; 2000 draws colliding would signal a broken generator.
    expect(references.size).toBe(2000)
  })

  it('is shaped for a printed receipt', () => {
    const reference = generateApplicationReference(2027, 'Mesra')

    expect(reference).toMatch(/^HZ-2027-MES-[0-9A-Z]{6}$/)
    // No characters that are ambiguous when read aloud or handwritten.
    expect(reference.slice(12)).not.toMatch(/[ILOU]/)
  })

  it('builds a readable token from awkward commune names', () => {
    expect(communeToken('Mesra')).toBe('MES')
    expect(communeToken('Béjaïa')).toBe('BEJ')
    expect(communeToken("Hassi R'mel")).toBe('HAS')
    expect(communeToken('Aïn')).toBe('AIN')
    expect(communeToken('Bo')).toBe('BOX')
    expect(communeToken('123')).toBe('XXX')
  })

  it('is unique in the database as well', async () => {
    await submit(singleBody())
    const application = await prisma.application.findFirstOrThrow()

    await expect(
      prisma.$executeRaw`
        INSERT INTO "applications"
          ("id", "application_reference", "draw_year", "commune_id",
           "primary_participant_id", "entry_type", "updated_at")
        VALUES ('dup', ${application.applicationReference}, ${DRAW_YEAR},
                ${application.communeId}, ${application.primaryParticipantId},
                'SINGLE', NOW())
      `,
    ).rejects.toThrow()
  })
})

describe('phone numbers', () => {
  it('stores every written form as one canonical number', async () => {
    const forms = ['0555123456', '+213555123456', '00213555123456', '213555123456']

    for (const form of forms) {
      expect(normalizePhoneNumber(form)).toBe('+213555123456')
    }
  })

  it('accepts grouped and Arabic-Indic input', () => {
    expect(normalizePhoneNumber('0555 12 34 56')).toBe('+213555123456')
    expect(normalizePhoneNumber('0555-12-34-56')).toBe('+213555123456')
    expect(normalizePhoneNumber('٠٥٥٥١٢٣٤٥٦')).toBe('+213555123456')
  })

  it('rejects what is not an Algerian mobile number', () => {
    for (const invalid of ['0455123456', '055512345', '05551234567', 'not a phone', '']) {
      expect(isValidPhoneNumber(normalizePhoneNumber(invalid))).toBe(false)
    }
  })

  it('does not mistake a national number starting 213 for a country code', () => {
    // 0213456789 is not a mobile number, so it must not be accepted as one.
    expect(isValidPhoneNumber(normalizePhoneNumber('0213456789'))).toBe(false)
  })

  it('persists the canonical form through registration', async () => {
    await submit(singleBody({ primary: applicant(NATIONAL_IDS.ahmed, { phoneNumber: '0555 12 34 56' }) }))

    const participant = await prisma.participant.findUniqueOrThrow({
      where: { nationalId: NATIONAL_IDS.ahmed },
    })
    expect(participant.phoneNumber).toBe('+213555123456')
    expect(participant.phoneVerifiedAt).toBeNull()
  })

  it('accepts an application with no phone number at all', async () => {
    const response = await submit(singleBody({ primary: applicant(NATIONAL_IDS.ahmed, { phoneNumber: '' }) }))

    expect(response.status).toBe(201)
    const participant = await prisma.participant.findUniqueOrThrow({
      where: { nationalId: NATIONAL_IDS.ahmed },
    })
    expect(participant.phoneNumber).toBeNull()
  })

  it('rejects a malformed phone number with a readable message', async () => {
    const response = await submit(
      singleBody({ primary: applicant(NATIONAL_IDS.ahmed, { phoneNumber: '12345' }) }),
    )

    expect(response.status).toBe(400)
    expect(response.body.code).toBe('VALIDATION_FAILED')
  })
})

describe('request hygiene', () => {
  it('rejects an oversized body without reaching the handler', async () => {
    const response = await submit({
      ...singleBody(),
      primary: applicant(NATIONAL_IDS.ahmed, { fullName: 'x'.repeat(64 * 1024) }),
    })

    expect(response.status).toBe(413)
    expect(response.body.code).toBe('PAYLOAD_TOO_LARGE')
  })

  it('rejects unknown fields rather than ignoring them', async () => {
    const response = await submit({ ...singleBody(), status: 'APPROVED', calculatedWeight: 999 })

    expect(response.status).toBe(400)
    expect(await prisma.application.count()).toBe(0)
  })

  it('rejects an invalid national ID', async () => {
    const response = await submit(singleBody({ primary: applicant('123') }))

    expect(response.status).toBe(400)
    expect(response.body.details).toHaveProperty('primary')
  })

  it('rate limits repeated submissions from one address', async () => {
    const statuses: number[] = []

    // Each submission is a fresh person, so nothing is rejected as a
    // duplicate — only the limiter can stop these. Built as a string because
    // an 18-digit national ID exceeds Number.MAX_SAFE_INTEGER.
    for (let attempt = 0; attempt < 22; attempt += 1) {
      const nationalId = `5000000000000000${String(attempt).padStart(2, '0')}`
      const response = await submit(singleBody({ primary: applicant(nationalId) }))
      statuses.push(response.status)
    }

    expect(statuses.filter((status) => status === 201)).toHaveLength(20)
    expect(statuses.filter((status) => status === 429)).toHaveLength(2)
    expect(statuses.at(-1)).toBe(429)
  })
})
