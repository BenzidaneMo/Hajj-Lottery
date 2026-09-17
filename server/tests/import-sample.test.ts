import { OPTIONAL_IMPORT_COLUMNS, REQUIRED_IMPORT_COLUMNS } from '@hajj-lottery/shared'
import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import { buildSampleCsv, buildSampleWorkbook } from '../src/lib/import-sample.js'
import { AdminRole, createAdminAndSignIn, ensureTestGeography, type TestGeography } from './helpers/admins.js'

const prisma = new PrismaClient()

let app: ReturnType<typeof createApp>
let geo: TestGeography

const superAdmin = () => createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })
const wilayaAdmin = (wilayaId: string) =>
  createAdminAndSignIn(app, prisma, { role: AdminRole.WILAYA_ADMIN, wilayaId })

/**
 * The sample's own commune codes (Adrar wilaya, real national reference
 * data) — upserted here rather than assumed present, since the test database
 * carries only migrations, not the full geographic seed. Any real deployment
 * has this wilaya and these two communes already.
 */
async function seedSampleGeography(): Promise<void> {
  const wilaya = await prisma.wilaya.upsert({
    where: { code: '1' },
    update: {},
    create: { code: '1', nameAr: 'أدرار', nameFr: 'Adrar', nameEn: 'Adrar' },
  })
  for (const [code, name] of [
    ['101', 'Adrar'],
    ['102', 'Tamest'],
  ] as const) {
    await prisma.commune.upsert({
      where: { wilayaId_code: { wilayaId: wilaya.id, code } },
      update: {},
      create: { wilayaId: wilaya.id, code, nameAr: name, nameFr: name, nameEn: name },
    })
  }
}

beforeAll(async () => {
  await prisma.$connect()
})

beforeEach(async () => {
  app = createApp()
  await seedSampleGeography()
  geo = await ensureTestGeography(prisma)
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('the import sample template', () => {
  it('carries exactly the required and optional columns, in that order', () => {
    const header = buildSampleCsv().split('\r\n')[0]?.split(',')
    expect(header).toEqual([...REQUIRED_IMPORT_COLUMNS, ...OPTIONAL_IMPORT_COLUMNS])
  })

  it('re-validates cleanly as a CSV upload — the strongest guarantee it matches the real schema', async () => {
    const { cookie } = await superAdmin()

    const response = await request(app)
      .post('/api/admin/imports')
      .set('Cookie', cookie)
      .attach('file', Buffer.from(buildSampleCsv(), 'utf8'), {
        filename: 'sample.csv',
        contentType: 'text/csv',
      })

    expect(response.status).toBe(201)
    expect(response.body.status).toBe('READY_FOR_REVIEW')

    const rows = await request(app).get(`/api/admin/imports/${response.body.id}/rows`).set('Cookie', cookie)
    expect(rows.body.items).toHaveLength(2)
    expect(rows.body.items.every((row: { status: string }) => row.status === 'VALID')).toBe(true)
  })

  it('re-validates cleanly as an XLSX upload', async () => {
    const { cookie } = await superAdmin()
    const workbook = await buildSampleWorkbook()

    const response = await request(app)
      .post('/api/admin/imports')
      .set('Cookie', cookie)
      .attach('file', workbook, {
        filename: 'sample.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })

    expect(response.status).toBe(201)
    expect(response.body.status).toBe('READY_FOR_REVIEW')
  })
})

describe('the sample download routes', () => {
  it('serves the CSV as an attachment', async () => {
    const { cookie } = await superAdmin()

    const response = await request(app).get('/api/admin/imports/template.csv').set('Cookie', cookie)

    expect(response.status).toBe(200)
    expect(response.headers['content-disposition']).toContain('attachment')
    expect(response.headers['content-type']).toContain('text/csv')
    expect(response.text).toBe(buildSampleCsv())
  })

  it('serves the XLSX as an attachment', async () => {
    const { cookie } = await superAdmin()

    const response = await request(app).get('/api/admin/imports/template.xlsx').set('Cookie', cookie)

    expect(response.status).toBe(200)
    expect(response.headers['content-disposition']).toContain('attachment')
    expect(response.headers['content-type']).toContain('spreadsheetml')
  })

  it('refuses an unauthenticated caller, like every other admin route', async () => {
    expect((await request(app).get('/api/admin/imports/template.csv')).status).toBe(401)
    expect((await request(app).get('/api/admin/imports/template.xlsx')).status).toBe(401)
  })

  it('stays available to a scoped administrator — the template carries no data, just column names', async () => {
    const { cookie } = await wilayaAdmin(geo.wilayaA.id)

    expect((await request(app).get('/api/admin/imports/template.csv').set('Cookie', cookie)).status).toBe(200)
    expect((await request(app).get('/api/admin/imports/template.xlsx').set('Cookie', cookie)).status).toBe(
      200,
    )
  })
})
