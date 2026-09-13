import { MAX_IMPORT_FILE_BYTES } from '@hajj-lottery/shared'
import { PrismaClient } from '@prisma/client'
import ExcelJS from 'exceljs'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import { CsvLimitError, parseCsv } from '../src/lib/csv.js'
import { canTransitionBatch, isTerminalBatchStatus } from '../src/lib/import-lifecycle.js'
import { mapHeaders, parseImportBoolean, parseImportDate } from '../src/lib/import-template.js'
import { neutralizeSpreadsheetText } from '../src/lib/spreadsheet-safety.js'
import { participationHistoryService } from '../src/services/participation-history.service.js'
import { AdminRole, createAdminAndSignIn, ensureTestGeography, type TestGeography } from './helpers/admins.js'
import { participantFixture } from './helpers/participants.js'

const prisma = new PrismaClient()

let app: ReturnType<typeof createApp>
let geo: TestGeography

/** Comfortably in the past, and clear of the years other suites configure. */
const YEAR = 2022

// gender and phone_number are part of the base header (not appended per-test)
// so that a plain `line()` always carries what a brand-new participant needs
// — see MISSING_GENDER_FOR_NEW_PARTICIPANT / MISSING_PHONE_NUMBER_FOR_NEW_PARTICIPANT
// below. A test that wants to exercise their absence overrides them to ''.
const HEADER = [
  'national_id',
  'first_name_ar',
  'last_name_ar',
  'first_name_latin',
  'last_name_latin',
  'dob',
  'commune_code',
  'draw_year',
  'participated',
  'won',
  'gender',
  'phone_number',
]

let nextId = 0
function nationalId(): string {
  nextId += 1
  return `61000000000000${String(nextId).padStart(4, '0')}`
}

/** One well-formed row's values, keyed by column. Overrides replace individual cells. */
function values(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    national_id: nationalId(),
    first_name_ar: 'أمين',
    last_name_ar: 'بلقاسم',
    first_name_latin: 'Amine',
    last_name_latin: 'Belkacem',
    dob: '1980-04-12',
    commune_code: '90101',
    draw_year: String(YEAR),
    participated: 'true',
    won: 'false',
    gender: 'male',
    phone_number: '0555123456',
    ...overrides,
  }
}

/** One well-formed line, as an array in `header`'s column order (default: the base HEADER). */
function line(overrides: Record<string, string> = {}, header: string[] = HEADER): string[] {
  const row = values(overrides)
  return header.map((column) => row[column] ?? '')
}

function csv(rows: string[][], header: string[] = HEADER): Buffer {
  const escape = (cell: string) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)
  return Buffer.from([header, ...rows].map((row) => row.map(escape).join(',')).join('\n'), 'utf8')
}

async function xlsx(rows: (string | number | boolean)[][], header: string[] = HEADER): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('register')
  sheet.addRow(header)
  for (const row of rows) sheet.addRow(row)

  return Buffer.from(await workbook.xlsx.writeBuffer())
}

const superAdmin = (username?: string) =>
  createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN, ...(username ? { username } : {}) })
const wilayaAdmin = (wilayaId: string) =>
  createAdminAndSignIn(app, prisma, { role: AdminRole.WILAYA_ADMIN, wilayaId })
const communeAdmin = (wilayaId: string, communeId: string) =>
  createAdminAndSignIn(app, prisma, { role: AdminRole.COMMUNE_ADMIN, wilayaId, communeId })

function upload(cookie: string, bytes: Buffer, filename = 'register.csv', contentType = 'text/csv') {
  return request(app)
    .post('/api/admin/imports')
    .set('Cookie', cookie)
    .attach('file', bytes, { filename, contentType })
}

/** Uploads and expects the file to have been staged. */
async function stage(cookie: string, rows: string[][], header: string[] = HEADER): Promise<string> {
  const response = await upload(cookie, csv(rows, header))
  expect(response.status).toBe(201)
  expect(response.body.status).toBe('READY_FOR_REVIEW')
  return response.body.id as string
}

async function rowsOf(cookie: string, batchId: string) {
  const response = await request(app)
    .get(`/api/admin/imports/${batchId}/rows?pageSize=200`)
    .set('Cookie', cookie)
  expect(response.status).toBe(200)
  return response.body.items as {
    rowNumber: number
    status: string
    firstNameAr: string
    lastNameAr: string
    firstNameLatin: string
    lastNameLatin: string
    nationalIdSuffix: string
    issues: { code: string; column: string | null }[]
  }[]
}

const codesOn = (row: { issues: { code: string }[] }) => row.issues.map((issue) => issue.code)

async function summaryOf(cookie: string, batchId: string) {
  const response = await request(app).get(`/api/admin/imports/${batchId}/summary`).set('Cookie', cookie)
  expect(response.status).toBe(200)
  return response.body
}

/** Uploads, approves with a second national administrator, and imports. */
async function importFully(rows: string[][], uploader?: { cookie: string }) {
  const owner = uploader ?? (await superAdmin())
  const reviewer = await superAdmin()

  const batchId = await stage(owner.cookie, rows)

  const approved = await request(app)
    .post(`/api/admin/imports/${batchId}/approve`)
    .set('Cookie', reviewer.cookie)
    .send({ reason: 'Checked against the commune register' })
  expect(approved.status).toBe(200)

  const executed = await request(app)
    .post(`/api/admin/imports/${batchId}/execute`)
    .set('Cookie', reviewer.cookie)
    .send({})

  return { batchId, executed, reviewer, owner }
}

async function aParticipant(
  overrides: {
    nationalId?: string
    firstNameAr?: string
    lastNameAr?: string
    firstNameLatin?: string
    lastNameLatin?: string
    dob?: string
    gender?: 'MALE' | 'FEMALE'
    phoneNumber?: string
  } = {},
) {
  const { nationalId: id, dob, ...rest } = overrides
  return prisma.participant.create({
    data: participantFixture(id ?? nationalId(), {
      firstNameAr: 'أمين',
      lastNameAr: 'بلقاسم',
      firstNameLatin: 'Amine',
      lastNameLatin: 'Belkacem',
      // Matches line()'s own default dob, so a test that overrides neither
      // does not accidentally manufacture an IDENTITY_CONFLICT.
      dob: new Date(dob ?? '1980-04-12'),
      ...rest,
    }),
  })
}

beforeAll(async () => {
  await prisma.$connect()
})

beforeEach(async () => {
  app = createApp()
  geo = await ensureTestGeography(prisma)
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('reading the file', () => {
  it('imports a valid CSV register', async () => {
    const { cookie } = await superAdmin()
    const batchId = await stage(cookie, [line(), line()])

    const rows = await rowsOf(cookie, batchId)
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.status === 'VALID')).toBe(true)
    // Row numbers count the header, so a reviewer can find the line in the file.
    expect(rows.map((row) => row.rowNumber)).toEqual([2, 3])
  })

  it('imports a valid XLSX register', async () => {
    const { cookie } = await superAdmin()
    const bytes = await xlsx([line(), line()])

    const response = await upload(
      cookie,
      bytes,
      'register.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )

    expect(response.status).toBe(201)
    expect(response.body.sourceFormat).toBe('XLSX')

    const rows = await rowsOf(cookie, response.body.id)
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.status === 'VALID')).toBe(true)
  })

  it('refuses a file that is not a register', async () => {
    const { cookie } = await superAdmin()

    const response = await upload(cookie, Buffer.from('hello', 'utf8'), 'notes.txt', 'text/plain')

    expect(response.status).toBe(400)
    expect(response.body.code).toBe('UNSUPPORTED_IMPORT_FORMAT')
  })

  it('refuses a spreadsheet wearing a .csv name', async () => {
    const { cookie } = await superAdmin()
    const bytes = await xlsx([line()])

    const response = await upload(cookie, bytes, 'register.csv', 'text/csv')

    expect(response.status).toBe(400)
    expect(response.body.code).toBe('MALFORMED_IMPORT_FILE')
  })

  it('refuses a file over the size limit', async () => {
    const { cookie } = await superAdmin()
    const oversized = Buffer.alloc(MAX_IMPORT_FILE_BYTES + 4096, 0x61)

    const response = await upload(cookie, oversized)

    expect(response.status).toBe(400)
    expect(response.body.code).toBe('PAYLOAD_TOO_LARGE')
    // Nothing was staged: the limit is enforced before the bytes are believed.
    expect(await prisma.importBatch.count()).toBe(0)
  })

  it('refuses a file missing a required column', async () => {
    const { cookie } = await superAdmin()
    const header = HEADER.filter((column) => column !== 'won')

    const response = await upload(cookie, csv([line({}, header)], header))

    expect(response.status).toBe(400)
    expect(response.body.code).toBe('INVALID_IMPORT_TEMPLATE')
    expect(response.body.details.missing).toContain('won')
  })

  it('maps the documented aliases and ignores unknown headers', () => {
    const mapping = mapHeaders([
      'Numéro national',
      'Prenom AR',
      'Nom AR',
      'Prénom',
      'Nom',
      'Date de naissance',
      'Code commune',
      'Année',
      'Participation',
      'Gagnant',
      'Colonne inconnue',
    ])

    expect(mapping.missing).toEqual([])
    expect(mapping.columns.national_id).toBe(0)
    expect(mapping.columns.first_name_ar).toBe(1)
    expect(mapping.columns.last_name_ar).toBe(2)
    expect(mapping.columns.first_name_latin).toBe(3)
    expect(mapping.columns.last_name_latin).toBe(4)
    expect(mapping.columns.won).toBe(9)
    // Not guessed at, not turned into a field — reported and dropped.
    expect(mapping.ignored).toEqual(['Colonne inconnue'])
  })

  it('reads quoted CSV and refuses a cell beyond the limit', () => {
    expect(parseCsv('a,"b,c",d\n1,2,3')).toEqual([
      ['a', 'b,c', 'd'],
      ['1', '2', '3'],
    ])
    expect(parseCsv('a,"say ""hi"""')).toEqual([['a', 'say "hi"']])
    expect(() => parseCsv(`a,${'x'.repeat(600)}`)).toThrow(CsvLimitError)
  })

  it('refuses a formula rather than evaluating it', async () => {
    const { cookie } = await superAdmin()
    const batchId = await stage(cookie, [line({ first_name_ar: '=1+1' })])

    const [row] = await rowsOf(cookie, batchId)
    expect(codesOn(row!)).toContain('FORMULA_CELL')
    // And what comes back is inert text, not something a spreadsheet would run.
    expect(row!.firstNameAr.startsWith("'")).toBe(true)
    expect(neutralizeSpreadsheetText('=HYPERLINK("http://x")')).toBe('\'=HYPERLINK("http://x")')
  })

  it('refuses a formula cell in a workbook without trusting its cached result', async () => {
    const { cookie } = await superAdmin()

    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('register')
    sheet.addRow(HEADER)
    const row = sheet.addRow(line())
    row.getCell(2).value = { formula: 'A1&"x"', result: 'Innocent Name' }

    const response = await upload(
      cookie,
      Buffer.from(await workbook.xlsx.writeBuffer()),
      'register.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )

    const [staged] = await rowsOf(cookie, response.body.id)
    expect(codesOn(staged!)).toContain('FORMULA_CELL')
    // The cached result is whatever some other machine computed. It is not used.
    expect(staged!.firstNameAr).not.toBe('Innocent Name')
  })
})

describe('what a row must say', () => {
  it('refuses a national ID that is not one', async () => {
    const { cookie } = await superAdmin()
    const batchId = await stage(cookie, [line({ national_id: '12345' }), line({ national_id: '' })])

    const rows = await rowsOf(cookie, batchId)
    expect(codesOn(rows[0]!)).toContain('INVALID_NATIONAL_ID')
    expect(codesOn(rows[1]!)).toContain('MISSING_NATIONAL_ID')
    expect(rows.every((row) => row.status === 'INVALID')).toBe(true)
  })

  it('folds Arabic-Indic and Persian digits onto the person already known', async () => {
    const { cookie } = await superAdmin()
    const ascii = nationalId()
    const arabicIndic = ascii.replace(/\d/g, (digit) => String.fromCharCode(0x0660 + Number(digit)))
    const persian = ascii.replace(/\d/g, (digit) => String.fromCharCode(0x06f0 + Number(digit)))

    const existing = await aParticipant({ nationalId: ascii })

    const batchId = await stage(cookie, [
      line({ national_id: arabicIndic, draw_year: String(YEAR) }),
      line({ national_id: persian, draw_year: String(YEAR - 1) }),
    ])

    const staged = await prisma.importRow.findMany({
      where: { importBatchId: batchId },
      orderBy: { rowNumber: 'asc' },
    })

    // Both scripts canonicalize to the same 18 ASCII digits, so neither becomes
    // a second identity for a person the registry already holds.
    expect(staged.map((row) => row.nationalId)).toEqual([ascii, ascii])
    expect(await prisma.participant.count({ where: { nationalId: ascii } })).toBe(1)
    expect(existing.nationalId).toBe(ascii)
  })

  it('refuses an unknown commune code and creates no commune for it', async () => {
    const { cookie } = await superAdmin()
    const batchId = await stage(cookie, [line({ commune_code: '99999' })])

    const [row] = await rowsOf(cookie, batchId)
    expect(codesOn(row!)).toContain('UNKNOWN_COMMUNE')
    expect(await prisma.commune.count({ where: { code: '99999' } })).toBe(0)
  })

  it('refuses a draw year outside the range, and one that has not happened', async () => {
    const { cookie } = await superAdmin()
    const future = new Date().getUTCFullYear() + 3

    const batchId = await stage(cookie, [
      line({ draw_year: '1999' }),
      line({ draw_year: String(future) }),
      line({ draw_year: 'l’an dernier' }),
    ])

    const rows = await rowsOf(cookie, batchId)
    expect(codesOn(rows[0]!)).toContain('INVALID_DRAW_YEAR')
    expect(codesOn(rows[1]!)).toContain('FUTURE_DRAW_YEAR')
    expect(codesOn(rows[2]!)).toContain('INVALID_DRAW_YEAR')
  })

  it('treats a missing participation as unknown, never as false', async () => {
    const { cookie } = await superAdmin()
    const batchId = await stage(cookie, [line({ participated: '' }), line({ won: '' })])

    const rows = await rowsOf(cookie, batchId)
    expect(codesOn(rows[0]!)).toContain('MISSING_PARTICIPATION')
    expect(codesOn(rows[1]!)).toContain('MISSING_OUTCOME')

    // The staged values are null — not false. Coercing them would manufacture an
    // authoritative claim that somebody did not take part.
    const staged = await prisma.importRow.findMany({
      where: { importBatchId: batchId },
      orderBy: { rowNumber: 'asc' },
    })
    expect(staged[0]?.participated).toBeNull()
    expect(staged[1]?.won).toBeNull()
  })

  it('refuses winning a draw that was not entered', async () => {
    const { cookie } = await superAdmin()
    const batchId = await stage(cookie, [line({ participated: 'false', won: 'true' })])

    const [row] = await rowsOf(cookie, batchId)
    expect(codesOn(row!)).toContain('WON_WITHOUT_PARTICIPATION')
    expect(row!.status).toBe('INVALID')
  })

  it('accepts the truth values a register is actually kept in', () => {
    for (const yes of ['true', '1', 'oui', 'نعم', 'X']) expect(parseImportBoolean(yes)).toBe(true)
    for (const no of ['false', '0', 'non', 'لا']) expect(parseImportBoolean(no)).toBe(false)
    expect(parseImportBoolean('')).toBeUndefined()
    expect(parseImportBoolean('peut-être')).toBeNull()
  })

  it('reads the date forms a register uses, and refuses a date that does not exist', () => {
    expect(parseImportDate('1980-04-12')?.toISOString().slice(0, 10)).toBe('1980-04-12')
    expect(parseImportDate('12/04/1980')?.toISOString().slice(0, 10)).toBe('1980-04-12')
    expect(parseImportDate('31/02/1980')).toBeNull()
    expect(parseImportDate('yesterday')).toBeNull()
  })

  it('treats a phone number as contact information, not a reason to refuse a life of waiting', async () => {
    const { cookie } = await superAdmin()
    // An existing participant: a malformed phone here cannot block on the
    // separate new-participant requirement below, which is exactly the case
    // this property is about — nothing dials this number regardless.
    const participant = await aParticipant()
    const batchId = await stage(cookie, [
      line({ national_id: participant.nationalId, phone_number: 'not a number' }),
    ])

    const [row] = await rowsOf(cookie, batchId)
    expect(codesOn(row!)).toContain('INVALID_PHONE_NUMBER')
    // A warning, so the historical record still imports.
    expect(row!.status).toBe('WARNING')
  })

  it('blocks a new participant whose gender or phone number cannot be established', async () => {
    const { cookie } = await superAdmin()

    const noGender = await stage(cookie, [line({ gender: '' })])
    const [genderRow] = await rowsOf(cookie, noGender)
    expect(codesOn(genderRow!)).toContain('MISSING_GENDER_FOR_NEW_PARTICIPANT')
    expect(genderRow!.status).toBe('INVALID')

    const noPhone = await stage(cookie, [line({ phone_number: '' })])
    const [phoneRow] = await rowsOf(cookie, noPhone)
    expect(codesOn(phoneRow!)).toContain('MISSING_PHONE_NUMBER_FOR_NEW_PARTICIPANT')
    expect(phoneRow!.status).toBe('INVALID')
  })

  it('does not require gender or phone for a row matching an existing participant', async () => {
    const { cookie } = await superAdmin()
    const participant = await aParticipant()

    const batchId = await stage(cookie, [
      line({ national_id: participant.nationalId, gender: '', phone_number: '' }),
    ])

    const [row] = await rowsOf(cookie, batchId)
    expect(codesOn(row!)).not.toContain('MISSING_GENDER_FOR_NEW_PARTICIPANT')
    expect(codesOn(row!)).not.toContain('MISSING_PHONE_NUMBER_FOR_NEW_PARTICIPANT')
  })
})

describe('duplicates inside one file', () => {
  it('consolidates identical repeats and reports them', async () => {
    const { cookie } = await superAdmin()
    const id = nationalId()

    const batchId = await stage(cookie, [line({ national_id: id }), line({ national_id: id })])

    const rows = await rowsOf(cookie, batchId)
    expect(rows[0]!.status).toBe('VALID')
    expect(codesOn(rows[1]!)).toContain('DUPLICATE_ROW_IN_FILE')
    expect(rows[1]!.status).toBe('WARNING')
  })

  it('blocks a repeat that disagrees, on both rows', async () => {
    const { cookie } = await superAdmin()
    const id = nationalId()

    const batchId = await stage(cookie, [
      line({ national_id: id, won: 'false' }),
      line({ national_id: id, won: 'true' }),
    ])

    const rows = await rowsOf(cookie, batchId)
    // Both, so a reviewer sees the disagreement rather than a survivor.
    for (const row of rows) {
      expect(codesOn(row)).toContain('CONFLICTING_DUPLICATE_IN_FILE')
      expect(row.status).toBe('CONFLICT')
    }
  })

  it('blocks a repeat that disagrees only about the commune', async () => {
    const { cookie } = await superAdmin()
    const id = nationalId()

    const batchId = await stage(cookie, [
      line({ national_id: id, commune_code: '90101' }),
      line({ national_id: id, commune_code: '90102' }),
    ])

    const rows = await rowsOf(cookie, batchId)
    expect(codesOn(rows[0]!)).toContain('CONFLICTING_DUPLICATE_IN_FILE')
  })

  it('blocks a chronology that cannot have happened', async () => {
    const { cookie } = await superAdmin()
    const id = nationalId()

    const batchId = await stage(cookie, [
      line({ national_id: id, draw_year: '2020', won: 'false' }),
      line({ national_id: id, draw_year: '2021', won: 'true' }),
      line({ national_id: id, draw_year: '2022', won: 'false' }),
    ])

    const rows = await rowsOf(cookie, batchId)
    expect(rows[0]!.status).toBe('VALID')
    // Taking part after winning: the entitlement was already spent.
    expect(codesOn(rows[2]!)).toContain('CONFLICTING_CHRONOLOGY_IN_FILE')
  })

  it('blocks two wins for one person', async () => {
    const { cookie } = await superAdmin()
    const id = nationalId()

    const batchId = await stage(cookie, [
      line({ national_id: id, draw_year: '2020', won: 'true' }),
      line({ national_id: id, draw_year: '2021', won: 'true' }),
    ])

    const rows = await rowsOf(cookie, batchId)
    for (const row of rows) expect(codesOn(row)).toContain('CONFLICTING_CHRONOLOGY_IN_FILE')
  })
})

describe('duplicates against the database', () => {
  it('reports an identical existing record safely, and writes nothing for it', async () => {
    const participant = await aParticipant()
    await participationHistoryService.create({
      participantId: participant.id,
      communeId: geo.communeA1.id,
      drawYear: YEAR,
      participated: true,
      won: false,
      source: 'LEGACY_IMPORT',
      verified: true,
    })

    const { executed } = await importFully([line({ national_id: participant.nationalId })])

    expect(executed.status).toBe(200)
    expect(executed.body.historicalRecordsCreated).toBe(0)
    expect(executed.body.rowsAlreadyPresent).toBe(1)
    expect(await prisma.participationHistory.count({ where: { participantId: participant.id } })).toBe(1)
  })

  it('blocks a record that disagrees with the ledger, and never overwrites it', async () => {
    const { cookie } = await superAdmin()
    const participant = await aParticipant()
    const existing = await participationHistoryService.create({
      participantId: participant.id,
      communeId: geo.communeA1.id,
      drawYear: YEAR,
      participated: true,
      won: false,
      source: 'LEGACY_IMPORT',
      verified: true,
    })

    const batchId = await stage(cookie, [line({ national_id: participant.nationalId, won: 'true' })])

    const [row] = await rowsOf(cookie, batchId)
    expect(codesOn(row!)).toContain('CONFLICTS_WITH_EXISTING_HISTORY')
    expect(row!.status).toBe('CONFLICT')

    const unchanged = await prisma.participationHistory.findUniqueOrThrow({ where: { id: existing.id } })
    expect(unchanged.won).toBe(false)
  })
})

describe('identity matching', () => {
  it('flags a name or date of birth that disagrees with the registry', async () => {
    const { cookie } = await superAdmin()
    const participant = await aParticipant({
      firstNameLatin: 'Ahmed',
      lastNameLatin: 'Ben Ali',
      dob: '1980-05-10',
    })

    const batchId = await stage(cookie, [
      line({
        national_id: participant.nationalId,
        first_name_latin: 'Ahmed',
        last_name_latin: 'Ali',
        dob: '1981-05-10',
      }),
    ])

    const [row] = await rowsOf(cookie, batchId)
    expect(codesOn(row!)).toContain('IDENTITY_CONFLICT')
    expect(row!.status).toBe('CONFLICT')
  })

  it('treats case and spacing as transcription noise rather than a different person', async () => {
    const { cookie } = await superAdmin()
    const participant = await aParticipant({ firstNameLatin: 'Ahmed', lastNameLatin: 'Ben Ali' })

    const batchId = await stage(cookie, [
      line({
        national_id: participant.nationalId,
        first_name_latin: '  ahmed ',
        last_name_latin: '  ben   ali ',
      }),
    ])

    const [row] = await rowsOf(cookie, batchId)
    expect(codesOn(row!)).not.toContain('IDENTITY_CONFLICT')
  })

  it('never overwrites an existing participant', async () => {
    const participant = await aParticipant({
      firstNameLatin: 'Ahmed',
      lastNameLatin: 'Ben Ali',
      dob: '1980-05-10',
    })

    // The name matches, so nothing blocks; the register's own spelling and phone
    // still must not revise the registry.
    const { executed } = await importFully([
      line({
        national_id: participant.nationalId,
        first_name_latin: 'AHMED',
        last_name_latin: 'BEN ALI',
        dob: '1980-05-10',
      }),
    ])

    expect(executed.status).toBe(200)
    const after = await prisma.participant.findUniqueOrThrow({ where: { id: participant.id } })
    expect(after.lastNameLatin).toBe('Ben Ali')
    expect(after.updatedAt.getTime()).toBe(participant.updatedAt.getTime())
  })

  it('creates a participant only when the import actually runs', async () => {
    const { cookie } = await superAdmin()
    const reviewer = await superAdmin()
    const before = await prisma.participant.count()

    const batchId = await stage(cookie, [line(), line()])
    expect(await prisma.participant.count()).toBe(before)

    await request(app)
      .post(`/api/admin/imports/${batchId}/approve`)
      .set('Cookie', reviewer.cookie)
      .send({ reason: 'Verified against the register' })

    // Approved, and still nothing written.
    expect(await prisma.participant.count()).toBe(before)

    await request(app).post(`/api/admin/imports/${batchId}/execute`).set('Cookie', reviewer.cookie).send({})
    expect(await prisma.participant.count()).toBe(before + 2)
  })
})

describe('staging touches nothing authoritative', () => {
  it('writes no participant, history or winner state', async () => {
    const { cookie } = await superAdmin()

    await stage(cookie, [line({ won: 'true' }), line()])

    expect(await prisma.participant.count()).toBe(0)
    expect(await prisma.participationHistory.count()).toBe(0)
    expect(await prisma.legacyWinner.count()).toBe(0)
    expect(await prisma.importRow.count()).toBe(2)
  })

  it('refuses to execute an import nobody approved', async () => {
    const { cookie } = await superAdmin()
    const reviewer = await superAdmin()
    const batchId = await stage(cookie, [line()])

    const response = await request(app)
      .post(`/api/admin/imports/${batchId}/execute`)
      .set('Cookie', reviewer.cookie)
      .send({})

    expect(response.status).toBe(409)
    expect(response.body.code).toBe('IMPORT_NOT_IN_STATE')
    expect(await prisma.participant.count()).toBe(0)
  })

  it('refuses to import a batch that still has conflicts', async () => {
    const { cookie } = await superAdmin()
    const reviewer = await superAdmin()
    const id = nationalId()

    const batchId = await stage(cookie, [
      line({ national_id: id, won: 'false' }),
      line({ national_id: id, won: 'true' }),
    ])

    const summary = await summaryOf(cookie, batchId)
    expect(summary.conflicts).toBe(2)
    expect(summary.importable).toBe(false)

    await request(app)
      .post(`/api/admin/imports/${batchId}/approve`)
      .set('Cookie', reviewer.cookie)
      .send({ reason: 'Approved in error' })

    const response = await request(app)
      .post(`/api/admin/imports/${batchId}/execute`)
      .set('Cookie', reviewer.cookie)
      .send({})

    expect(response.status).toBe(409)
    expect(response.body.code).toBe('IMPORT_HAS_CONFLICTS')
    expect(await prisma.participationHistory.count()).toBe(0)
  })
})

describe('who may approve and import', () => {
  it('lets a national administrator approve somebody else’s upload', async () => {
    const { cookie } = await superAdmin()
    const reviewer = await superAdmin()
    const batchId = await stage(cookie, [line()])

    const response = await request(app)
      .post(`/api/admin/imports/${batchId}/approve`)
      .set('Cookie', reviewer.cookie)
      .send({ reason: 'Checked against the paper register' })

    expect(response.status).toBe(200)
    expect(response.body.status).toBe('APPROVED')
    expect(response.body.approvedBy.id).toBe(reviewer.user.id)
  })

  it('refuses to let anybody approve their own import', async () => {
    const owner = await superAdmin()
    const batchId = await stage(owner.cookie, [line()])

    const response = await request(app)
      .post(`/api/admin/imports/${batchId}/approve`)
      .set('Cookie', owner.cookie)
      .send({ reason: 'It is mine and it is fine' })

    expect(response.status).toBe(403)
    expect(response.body.code).toBe('SELF_APPROVAL_FORBIDDEN')
  })

  it('refuses approval, rejection and execution to scoped administrators', async () => {
    const { cookie } = await superAdmin()
    const batchId = await stage(cookie, [line()])

    const wilaya = await wilayaAdmin(geo.wilayaA.id)
    const commune = await communeAdmin(geo.wilayaA.id, geo.communeA1.id)

    for (const scoped of [wilaya, commune]) {
      for (const action of ['approve', 'reject', 'execute']) {
        const response = await request(app)
          .post(`/api/admin/imports/${batchId}/${action}`)
          .set('Cookie', scoped.cookie)
          .send({ reason: 'I would like to' })

        expect(response.status).toBe(403)
        expect(response.body.code).toBe('FORBIDDEN_ROLE')
      }
    }

    expect(await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } })).toMatchObject({
      status: 'READY_FOR_REVIEW',
      approvedByUserId: null,
    })
  })

  it('demands a reason for a decision', async () => {
    const { cookie } = await superAdmin()
    const reviewer = await superAdmin()
    const batchId = await stage(cookie, [line()])

    for (const body of [{}, { reason: '   ' }]) {
      const response = await request(app)
        .post(`/api/admin/imports/${batchId}/reject`)
        .set('Cookie', reviewer.cookie)
        .send(body)

      expect(response.status).toBe(400)
    }
  })

  it('makes a rejection permanent', async () => {
    const { cookie } = await superAdmin()
    const reviewer = await superAdmin()
    const batchId = await stage(cookie, [line()])

    const rejected = await request(app)
      .post(`/api/admin/imports/${batchId}/reject`)
      .set('Cookie', reviewer.cookie)
      .send({ reason: 'The register pages were illegible' })
    expect(rejected.body.status).toBe('REJECTED')

    const second = await request(app)
      .post(`/api/admin/imports/${batchId}/approve`)
      .set('Cookie', reviewer.cookie)
      .send({ reason: 'Changed my mind' })

    expect(second.status).toBe(409)
    expect(isTerminalBatchStatus('REJECTED')).toBe(true)
    expect(canTransitionBatch('REJECTED', 'APPROVED')).toBe(false)
  })

  it('knows what a batch may do next', () => {
    expect(canTransitionBatch('UPLOADED', 'VALIDATING')).toBe(true)
    expect(canTransitionBatch('VALIDATING', 'READY_FOR_REVIEW')).toBe(true)
    expect(canTransitionBatch('READY_FOR_REVIEW', 'IMPORTED')).toBe(false)
    expect(canTransitionBatch('APPROVED', 'IMPORTED')).toBe(true)
    for (const terminal of ['IMPORTED', 'REJECTED', 'FAILED'] as const) {
      expect(isTerminalBatchStatus(terminal)).toBe(true)
    }
  })

  it('refuses to re-open a completed batch, at the database', async () => {
    const { batchId, executed } = await importFully([line()])
    expect(executed.status).toBe(200)

    await expect(
      prisma.importBatch.update({ where: { id: batchId }, data: { status: 'APPROVED' } }),
    ).rejects.toThrow()
    await expect(prisma.importBatch.delete({ where: { id: batchId } })).rejects.toThrow()
  })
})

describe('the import itself', () => {
  it('writes participants, ledger rows and provenance in one go', async () => {
    const { batchId, executed } = await importFully([line(), line({ won: 'true' })])

    expect(executed.status).toBe(200)
    expect(executed.body).toMatchObject({
      batchId,
      participantsCreated: 2,
      participantsReused: 0,
      historicalRecordsCreated: 2,
      legacyWinnersRecorded: 1,
    })

    const history = await prisma.participationHistory.findMany()
    expect(history).toHaveLength(2)
    // The source is decided here, never by the file.
    expect(history.every((record) => record.source === 'LEGACY_IMPORT')).toBe(true)

    // Every row points back at what it produced, and forward from the register.
    const rows = await prisma.importRow.findMany({ where: { importBatchId: batchId } })
    expect(rows.every((row) => row.participantId !== null && row.participationHistoryId !== null)).toBe(true)
  })

  it('marks approved history verified, per the documented policy', async () => {
    await importFully([line()])

    const record = await prisma.participationHistory.findFirstOrThrow()
    // Reviewed by a national administrator who did not upload it — which is the
    // act this flag records. An approved import that counted for nothing would be
    // an approval that approved nothing.
    expect(record.verified).toBe(true)
  })

  it('feeds the existing streak calculation without changing it', async () => {
    const id = nationalId()

    await importFully([
      line({ national_id: id, draw_year: '2020', last_name_latin: 'Patient Person' }),
      line({ national_id: id, draw_year: '2021', last_name_latin: 'Patient Person' }),
      line({ national_id: id, draw_year: '2022', last_name_latin: 'Patient Person' }),
      line({ national_id: id, draw_year: '2023', last_name_latin: 'Patient Person' }),
    ])

    const participant = await prisma.participant.findUniqueOrThrow({ where: { nationalId: id } })
    const streak = await participationHistoryService.calculateConsecutiveNonWinningYears(participant.id, 2024)

    // Four authoritative years of waiting, consumed by the untouched streak walk.
    expect(streak.consecutiveNonWinningYears).toBe(4)
  })

  it('leaves the whole batch unwritten when anything fails', async () => {
    const owner = await superAdmin()
    const reviewer = await superAdmin()
    const winner = await aParticipant()

    const batchId = await stage(owner.cookie, [
      line({ national_id: winner.nationalId, won: 'true' }),
      line({ last_name_latin: 'Somebody Entirely New' }),
    ])

    await request(app)
      .post(`/api/admin/imports/${batchId}/approve`)
      .set('Cookie', reviewer.cookie)
      .send({ reason: 'Checked' })

    // A real draw concludes between approval and execution, and this person wins.
    await prisma.participant.update({ where: { id: winner.id }, data: { hasWonHajj: true } })

    const response = await request(app)
      .post(`/api/admin/imports/${batchId}/execute`)
      .set('Cookie', reviewer.cookie)
      .send({})

    expect(response.status).toBe(409)
    expect(response.body.code).toBe('IMPORT_HAS_CONFLICTS')

    // Nothing at all: not the other row's participant, not a single ledger row,
    // and not the claim on the batch.
    expect(await prisma.participant.count({ where: { lastNameLatin: 'Somebody Entirely New' } })).toBe(0)
    expect(await prisma.participationHistory.count()).toBe(0)
    expect(await prisma.legacyWinner.count()).toBe(0)
    expect(await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } })).toMatchObject({
      status: 'APPROVED',
      importedAt: null,
    })
  })

  it('ignores everything a client puts in the execute body', async () => {
    const owner = await superAdmin()
    const reviewer = await superAdmin()
    const batchId = await stage(owner.cookie, [line()])

    await request(app)
      .post(`/api/admin/imports/${batchId}/approve`)
      .set('Cookie', reviewer.cookie)
      .send({ reason: 'Checked' })

    const response = await request(app)
      .post(`/api/admin/imports/${batchId}/execute`)
      .set('Cookie', reviewer.cookie)
      .send({ verified: false, source: 'APPLICATION', skipConflicts: true, hasWonHajj: true })

    expect(response.status).toBe(200)
    const record = await prisma.participationHistory.findFirstOrThrow()
    expect(record.source).toBe('LEGACY_IMPORT')
    expect(record.verified).toBe(true)
  })
})

describe('legacy winners', () => {
  it('excludes a legacy winner for life', async () => {
    const id = nationalId()
    await importFully([line({ national_id: id, won: 'true' })])

    const participant = await prisma.participant.findUniqueOrThrow({ where: { nationalId: id } })
    expect(participant.hasWonHajj).toBe(true)

    const legacy = await prisma.legacyWinner.findUniqueOrThrow({ where: { participantId: participant.id } })
    expect(legacy.drawYear).toBe(YEAR)
    expect(legacy.communeId).toBe(geo.communeA1.id)
  })

  it('keeps the provenance of a legacy win', async () => {
    const { batchId } = await importFully([line({ won: 'true' })])

    const legacy = await prisma.legacyWinner.findFirstOrThrow({
      include: { importRow: true, participationHistory: true },
    })

    expect(legacy.importBatchId).toBe(batchId)
    expect(legacy.importRow.importBatchId).toBe(batchId)
    expect(legacy.participationHistory.won).toBe(true)
    expect(legacy.participationHistory.source).toBe('LEGACY_IMPORT')
  })

  it('manufactures no web-era draw records for a legacy win', async () => {
    await importFully([line({ won: 'true' })])

    // A legacy win is a different kind of fact. Nothing pretends a lottery ran.
    expect(await prisma.drawResult.count()).toBe(0)
    expect(await prisma.drawWinner.count()).toBe(0)
    expect(await prisma.drawSelectionEvent.count()).toBe(0)
    expect(await prisma.winnerArchive.count()).toBe(0)
    expect(await prisma.drawPool.count()).toBe(0)
  })

  it('refuses a second lifetime win for somebody already recorded as a winner', async () => {
    const { cookie } = await superAdmin()
    const participant = await aParticipant()
    await prisma.participant.update({ where: { id: participant.id }, data: { hasWonHajj: true } })

    const batchId = await stage(cookie, [
      line({ national_id: participant.nationalId, draw_year: '2021', won: 'true' }),
    ])

    const [row] = await rowsOf(cookie, batchId)
    expect(codesOn(row!)).toContain('ALREADY_A_WINNER')
    expect(row!.status).toBe('CONFLICT')
    // And the source row survives: it is the evidence for the conflict.
    expect(await prisma.importRow.count({ where: { importBatchId: batchId } })).toBe(1)
  })

  it('never clears an existing lifetime exclusion', async () => {
    const participant = await aParticipant()
    await participationHistoryService.create({
      participantId: participant.id,
      communeId: geo.communeA1.id,
      drawYear: 2021,
      participated: true,
      won: true,
      source: 'LEGACY_IMPORT',
      verified: true,
    })
    await prisma.participant.update({ where: { id: participant.id }, data: { hasWonHajj: true } })

    // Losing in a year *before* the win is perfectly coherent history.
    const { executed } = await importFully([
      line({ national_id: participant.nationalId, draw_year: '2020', won: 'false' }),
    ])

    expect(executed.status).toBe(200)
    const after = await prisma.participant.findUniqueOrThrow({ where: { id: participant.id } })
    expect(after.hasWonHajj).toBe(true)
  })

  it('blocks participation recorded after a win the system already knows about', async () => {
    const { cookie } = await superAdmin()
    const participant = await aParticipant()
    await participationHistoryService.create({
      participantId: participant.id,
      communeId: geo.communeA1.id,
      drawYear: 2020,
      participated: true,
      won: true,
      source: 'LEGACY_IMPORT',
      verified: true,
    })
    await prisma.participant.update({ where: { id: participant.id }, data: { hasWonHajj: true } })

    const batchId = await stage(cookie, [
      line({ national_id: participant.nationalId, draw_year: '2022', won: 'false' }),
    ])

    const [row] = await rowsOf(cookie, batchId)
    expect(codesOn(row!)).toContain('CONTRADICTS_WINNER_CHRONOLOGY')
  })

  it('refuses to rewrite a legacy winner record, at the database', async () => {
    await importFully([line({ won: 'true' })])
    const legacy = await prisma.legacyWinner.findFirstOrThrow()

    await expect(
      prisma.legacyWinner.update({ where: { id: legacy.id }, data: { drawYear: 2019 } }),
    ).rejects.toThrow()
    await expect(prisma.legacyWinner.delete({ where: { id: legacy.id } })).rejects.toThrow()
  })
})

describe('geographic scoping', () => {
  it('refuses rows outside a scoped uploader’s territory', async () => {
    const commune = await communeAdmin(geo.wilayaA.id, geo.communeA1.id)

    const batchId = await stage(commune.cookie, [
      line({ commune_code: '90101' }),
      line({ commune_code: '90102' }),
      line({ commune_code: '90201' }),
    ])

    const rows = await rowsOf(commune.cookie, batchId)
    expect(rows[0]!.status).toBe('VALID')
    // Their own commune only: the other two are refused per row, so the
    // overreach is visible rather than silently dropped.
    expect(codesOn(rows[1]!)).toContain('OUT_OF_SCOPE_COMMUNE')
    expect(codesOn(rows[2]!)).toContain('OUT_OF_SCOPE_COMMUNE')
  })

  it('lets a wilaya administrator prepare their whole wilaya and no more', async () => {
    const wilaya = await wilayaAdmin(geo.wilayaA.id)

    const batchId = await stage(wilaya.cookie, [
      line({ commune_code: '90101' }),
      line({ commune_code: '90102' }),
      line({ commune_code: '90201' }),
    ])

    const rows = await rowsOf(wilaya.cookie, batchId)
    expect(rows[0]!.status).toBe('VALID')
    expect(rows[1]!.status).toBe('VALID')
    expect(codesOn(rows[2]!)).toContain('OUT_OF_SCOPE_COMMUNE')
  })

  it('shows a scoped reviewer only the rows in their own territory', async () => {
    const national = await superAdmin()
    const batchId = await stage(national.cookie, [
      line({ commune_code: '90101' }),
      line({ commune_code: '90102' }),
      line({ commune_code: '90201' }),
    ])

    const commune = await communeAdmin(geo.wilayaA.id, geo.communeA1.id)
    const wilaya = await wilayaAdmin(geo.wilayaA.id)

    expect(await rowsOf(commune.cookie, batchId)).toHaveLength(1)
    expect(await rowsOf(wilaya.cookie, batchId)).toHaveLength(2)
    expect(await rowsOf(national.cookie, batchId)).toHaveLength(3)

    // And the counts follow the rows, so a summary tells nobody the size of
    // another territory's import.
    expect((await summaryOf(commune.cookie, batchId)).rows).toBe(1)
    expect((await summaryOf(national.cookie, batchId)).rows).toBe(3)
  })

  it('does not reveal a batch that touches nothing in the caller’s territory', async () => {
    const national = await superAdmin()
    const batchId = await stage(national.cookie, [line({ commune_code: '90201' })])

    const outsider = await communeAdmin(geo.wilayaA.id, geo.communeA1.id)

    const found = await request(app).get(`/api/admin/imports/${batchId}`).set('Cookie', outsider.cookie)
    const invented = await request(app)
      .get('/api/admin/imports/does-not-exist')
      .set('Cookie', outsider.cookie)

    // Byte-identical, so an id cannot be probed for existence.
    expect(found.status).toBe(404)
    expect(found.body).toEqual(invented.body)

    const listed = await request(app).get('/api/admin/imports').set('Cookie', outsider.cookie)
    expect(listed.body.items).toEqual([])
  })

  it('lets an uploader see their own batch entirely', async () => {
    const commune = await communeAdmin(geo.wilayaA.id, geo.communeA1.id)
    const batchId = await stage(commune.cookie, [line({ commune_code: '99999' })])

    // The row resolved to no commune at all; its uploader still has to be able
    // to see why their file failed.
    const rows = await rowsOf(commune.cookie, batchId)
    expect(rows).toHaveLength(1)
    expect(codesOn(rows[0]!)).toContain('UNKNOWN_COMMUNE')
  })

  it('exposes no import route publicly', async () => {
    const listed = await request(app).get('/api/admin/imports')
    expect(listed.status).toBe(401)

    const attempted = await request(app).post('/api/admin/imports')
    expect(attempted.status).toBe(401)
  })
})

describe('re-uploading the same register', () => {
  it('reports the batch that already holds those exact bytes', async () => {
    const { cookie } = await superAdmin()
    const rows = [line(), line()]
    const bytes = csv(rows)

    const first = await upload(cookie, bytes)
    expect(first.status).toBe(201)

    const second = await upload(cookie, bytes)
    expect(second.status).toBe(409)
    expect(second.body.code).toBe('DUPLICATE_IMPORT_SOURCE')
    expect(second.body.error).toContain(first.body.id)

    expect(await prisma.importBatch.count()).toBe(1)
  })

  it('still catches a duplicate the checksum cannot see', async () => {
    const id = nationalId()
    await importFully([line({ national_id: id })])

    // A different file — a re-typed page, an extra note column — carrying the
    // same claim. The checksum says nothing about it; the row check does.
    const { cookie } = await superAdmin()
    const batchId = await stage(
      cookie,
      [[...line({ national_id: id }), 'second transcription of page 4']],
      [...HEADER, 'notes'],
    )

    const [row] = await rowsOf(cookie, batchId)
    expect(codesOn(row!)).toContain('ALREADY_RECORDED')
  })
})

describe('auditing', () => {
  it('records the whole lifecycle, without recording the register', async () => {
    const owner = await superAdmin()
    const reviewer = await superAdmin()
    const id = nationalId()

    const batchId = await stage(owner.cookie, [line({ national_id: id, won: 'true' })])
    await request(app)
      .post(`/api/admin/imports/${batchId}/approve`)
      .set('Cookie', reviewer.cookie)
      .send({ reason: 'Cross-checked against the 2022 register' })
    await request(app).post(`/api/admin/imports/${batchId}/execute`).set('Cookie', reviewer.cookie).send({})

    const trail = await prisma.auditLog.findMany({
      where: { targetType: 'IMPORT_BATCH', targetId: batchId },
      orderBy: { createdAt: 'asc' },
    })

    expect(trail.map((entry) => entry.action)).toEqual([
      'LEGACY_IMPORT_CREATED',
      'LEGACY_IMPORT_APPROVED',
      'LEGACY_IMPORT_COMPLETED',
    ])

    const created = trail[0]!
    const approved = trail[1]!
    expect(created.actorUserId).toBe(owner.user.id)
    expect(approved.actorUserId).toBe(reviewer.user.id)
    expect(approved.reason).toBe('Cross-checked against the 2022 register')

    // The checksum is provenance and belongs in the trail. The register's
    // contents do not: no national ID, no name, no date of birth, ever.
    const serialized = JSON.stringify(trail)
    expect(serialized).toContain('sourceChecksum')
    expect(serialized).not.toContain(id)
    expect(serialized).not.toContain('Amine')
    expect(serialized).not.toContain('Belkacem')
    expect(serialized).not.toContain('أمين')
    expect(serialized).not.toContain('1980-04-12')
  })

  it('records a rejection, with its reason', async () => {
    const owner = await superAdmin()
    const reviewer = await superAdmin()
    const batchId = await stage(owner.cookie, [line()])

    await request(app)
      .post(`/api/admin/imports/${batchId}/reject`)
      .set('Cookie', reviewer.cookie)
      .send({ reason: 'The register pages were illegible' })

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'LEGACY_IMPORT_REJECTED', targetId: batchId },
    })

    expect(entry.actorUserId).toBe(reviewer.user.id)
    expect(entry.reason).toBe('The register pages were illegible')
  })

  it('files a scoped administrator’s import under their own territory', async () => {
    const commune = await communeAdmin(geo.wilayaA.id, geo.communeA1.id)
    const batchId = await stage(commune.cookie, [line()])

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'LEGACY_IMPORT_CREATED', targetId: batchId },
    })

    // Their reach is provably the file's coverage: a row naming anywhere else is
    // refused, so they can see their own upload in the trail.
    expect(entry.communeId).toBe(geo.communeA1.id)
    expect(entry.wilayaId).toBe(geo.wilayaA.id)
  })
})

describe('the summary an administrator reviews', () => {
  it('counts what the batch would do', async () => {
    const { cookie } = await superAdmin()
    const existing = await aParticipant()
    const conflicting = nationalId()

    const batchId = await stage(cookie, [
      line(),
      line(),
      line({
        national_id: existing.nationalId,
        first_name_latin: existing.firstNameLatin,
        last_name_latin: existing.lastNameLatin,
        dob: '1980-04-12',
        won: 'true',
      }),
      line({ national_id: conflicting, won: 'false' }),
      line({ national_id: conflicting, won: 'true' }),
      line({ commune_code: '99999' }),
    ])

    const summary = await summaryOf(cookie, batchId)

    expect(summary).toMatchObject({
      rows: 6,
      conflicts: 2,
      invalid: 1,
      newParticipants: 2,
      existingParticipants: 1,
      historicalRecords: 3,
      winners: 1,
      importable: false,
    })
    expect(summary.batch.id).toBe(batchId)
  })
})

describe('a failed upload leaves a record', () => {
  it('marks a file that cannot be staged as failed rather than losing it', async () => {
    const { cookie } = await superAdmin()

    const response = await upload(cookie, csv([], HEADER))

    expect(response.status).toBe(400)
    expect(response.body.code).toBe('MALFORMED_IMPORT_FILE')

    const batch = await prisma.importBatch.findFirstOrThrow()
    expect(batch.status).toBe('FAILED')
    expect(batch.failureReason).toBeTruthy()
  })
})
