/**
 * Deterministic seed for the geographic foundation (wilayas + communes).
 * Source of truth: prisma/seed-data/{wilayas,communes}.json, produced from
 * algeria_cities.sql by prisma/seed-data/build.mjs (see that file for
 * provenance and the corrections applied to the upstream dump).
 *
 * Safe to re-run: every record is upserted by its official code.
 */
import { PrismaClient } from '@prisma/client'

import communeData from './seed-data/communes.json' with { type: 'json' }
import wilayaData from './seed-data/wilayas.json' with { type: 'json' }

interface WilayaSeed {
  code: string
  nameAr: string
  nameFr: string
}

interface CommuneSeed {
  wilayaCode: string
  code: string
  nameAr: string
  nameFr: string
}

const wilayas = wilayaData as WilayaSeed[]
const communes = communeData as CommuneSeed[]

const prisma = new PrismaClient()

function validate(): void {
  const wilayaCodes = new Set<string>()
  for (const w of wilayas) {
    if (wilayaCodes.has(w.code)) {
      throw new Error(`Seed data invalid: duplicate wilaya code "${w.code}".`)
    }
    wilayaCodes.add(w.code)
  }

  const communeKeys = new Set<string>()
  for (const c of communes) {
    if (!wilayaCodes.has(c.wilayaCode)) {
      throw new Error(
        `Seed data invalid: commune "${c.nameFr}" (${c.code}) references unknown wilaya code "${c.wilayaCode}".`,
      )
    }
    const key = `${c.wilayaCode}|${c.code}`
    if (communeKeys.has(key)) {
      throw new Error(
        `Seed data invalid: duplicate commune code "${c.code}" within wilaya "${c.wilayaCode}".`,
      )
    }
    communeKeys.add(key)
  }
}

async function main(): Promise<void> {
  validate()

  console.log(`Seeding ${wilayas.length} wilayas...`)
  const wilayaIdByCode = new Map<string, string>()
  for (const w of wilayas) {
    const record = await prisma.wilaya.upsert({
      where: { code: w.code },
      update: { nameAr: w.nameAr, nameFr: w.nameFr, nameEn: w.nameFr },
      create: { code: w.code, nameAr: w.nameAr, nameFr: w.nameFr, nameEn: w.nameFr },
    })
    wilayaIdByCode.set(w.code, record.id)
  }

  console.log(`Seeding ${communes.length} communes...`)
  let seeded = 0
  for (const c of communes) {
    const wilayaId = wilayaIdByCode.get(c.wilayaCode)
    if (!wilayaId) {
      // Guarded by validate() above; kept here so a failure is attributable
      // to a specific record rather than surfacing as a foreign-key error.
      throw new Error(`No seeded wilaya found for code "${c.wilayaCode}" (commune "${c.nameFr}").`)
    }
    await prisma.commune.upsert({
      where: { wilayaId_code: { wilayaId, code: c.code } },
      update: { nameAr: c.nameAr, nameFr: c.nameFr, nameEn: c.nameFr },
      create: { wilayaId, code: c.code, nameAr: c.nameAr, nameFr: c.nameFr, nameEn: c.nameFr },
    })
    seeded++
  }

  console.log(`Done: ${wilayaIdByCode.size} wilayas, ${seeded} communes.`)
}

main()
  .catch((error) => {
    console.error('Seed failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
