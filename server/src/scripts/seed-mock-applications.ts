/**
 * Mock applicant generator, for exercising the lottery end to end
 * (registration -> eligibility -> weighting -> pool -> draw) with more data
 * than `prisma/seed.ts`'s three DEV_PARTICIPANTS provide.
 *
 *   npm run seed:mock-applications --workspace server
 *   npm run seed:mock-applications --workspace server -- --wilaya=16 --perCommune=25
 *
 * With no `--wilaya`, this registers into every active wilaya's communes --
 * the whole country. Pass `--wilaya` to scope it to one, as the second
 * example above does. Either way, `--perCommune` (default 40) is applicants
 * per commune, so a nationwide run is 1541 communes x that number of
 * registrations; expect it to take a while, and watch the per-wilaya
 * progress lines rather than assuming it has hung.
 *
 * Registers every applicant through `RegistrationService.register` -- the
 * same path `POST /api/applications` uses -- so eligibility, weighting and
 * the one-application-per-year guarantee are all real, never faked by
 * inserting rows directly. Every national ID starts with a fixed marker
 * prefix followed by a strictly increasing sequence (no real Algerian ID
 * scheme is checked beyond digit count, but this keeps every mock record
 * obviously synthetic to a human reading the database), and every name comes
 * from a small fixed pool that repeats on purpose. These are not real people.
 *
 * Requires the dev draw year and commune draws to already exist
 * (`npm run prisma:seed`); this script registers into whichever draw year is
 * open and whichever commune draws are still accepting entries -- it does
 * not create either.
 */
import { prisma } from '../lib/prisma.js'
import { registrationService } from '../services/registration.service.js'
import { createApplicationSchema } from '../validation/application.js'

const NATIONAL_ID_PREFIX = '01'

function arg(name: string): string | undefined {
  const flag = `--${name}=`
  const found = process.argv.find((value) => value.startsWith(flag))
  return found ? found.slice(flag.length) : undefined
}

/** Undefined means every active wilaya -- the nationwide default. */
const WILAYA_CODE = arg('wilaya')
const PER_COMMUNE = Number(arg('perCommune') ?? '40')

interface NamePart {
  ar: string
  latin: string
}

const MALE_FIRST_NAMES: NamePart[] = [
  { ar: 'أحمد', latin: 'Ahmed' },
  { ar: 'محمد', latin: 'Mohamed' },
  { ar: 'يوسف', latin: 'Youcef' },
  { ar: 'كريم', latin: 'Karim' },
  { ar: 'رشيد', latin: 'Rachid' },
  { ar: 'بلال', latin: 'Bilal' },
  { ar: 'مراد', latin: 'Mourad' },
  { ar: 'سفيان', latin: 'Sofiane' },
]

const FEMALE_FIRST_NAMES: NamePart[] = [
  { ar: 'فاطمة', latin: 'Fatima' },
  { ar: 'خديجة', latin: 'Khadija' },
  { ar: 'أمينة', latin: 'Amina' },
  { ar: 'سارة', latin: 'Sara' },
  { ar: 'مريم', latin: 'Meriem' },
  { ar: 'نور', latin: 'Nour' },
  { ar: 'سعاد', latin: 'Souad' },
  { ar: 'ليلى', latin: 'Leila' },
]

const LAST_NAMES: NamePart[] = [
  { ar: 'بن علي', latin: 'Benali' },
  { ar: 'بوزيد', latin: 'Bouzid' },
  { ar: 'مرابط', latin: 'Merabet' },
  { ar: 'حداد', latin: 'Haddad' },
  { ar: 'بلحاج', latin: 'Belhadj' },
  { ar: 'تومي', latin: 'Toumi' },
  { ar: 'عمراني', latin: 'Amrani' },
  { ar: 'شريف', latin: 'Cherif' },
]

/** SINGLE male / SINGLE female 45+ / PAIRED female+Mahram, in a fixed 4-slot rotation. */
const MALE_AGES = [19, 22, 25, 28, 31, 35, 40, 45, 50, 55, 60, 65, 70]
const FEMALE_SOLO_AGES = [45, 48, 52, 56, 60, 65, 70]
const FEMALE_PAIRED_AGES = [20, 24, 27, 30, 33, 37, 41, 44]
const MAHRAM_AGES = [22, 26, 30, 35, 40, 45, 50]

let sequence = 0

function nextNationalId(): string {
  sequence += 1
  return `${NATIONAL_ID_PREFIX}${String(sequence).padStart(16, '0')}`
}

function nextPhoneNumber(): string {
  return `+2135${String(sequence % 100000000).padStart(8, '0')}`
}

/**
 * Exact age in completed years as of today, immune to when in the year the
 * script runs (a fixed month/day like "-06-15" would silently be one year
 * off for half the calendar).
 */
function dobForAge(age: number): string {
  const now = new Date()
  const year = now.getUTCFullYear() - age
  const month = now.getUTCMonth() + 1
  // Clamped so Feb 29 against a birth year that isn't a leap year never
  // produces an impossible calendar date.
  const day = month === 2 ? Math.min(now.getUTCDate(), 28) : now.getUTCDate()
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

interface MockApplicant {
  nationalId: string
  firstNameAr: string
  lastNameAr: string
  firstNameLatin: string
  lastNameLatin: string
  dob: string
  gender: 'MALE' | 'FEMALE'
  phoneNumber: string
}

function buildApplicant(
  firstPool: NamePart[],
  index: number,
  age: number,
  gender: 'MALE' | 'FEMALE',
): MockApplicant {
  const first = firstPool[index % firstPool.length]!
  const last = LAST_NAMES[(index + 3) % LAST_NAMES.length]!
  return {
    nationalId: nextNationalId(),
    firstNameAr: first.ar,
    lastNameAr: last.ar,
    firstNameLatin: first.latin,
    lastNameLatin: last.latin,
    dob: dobForAge(age),
    gender,
    phoneNumber: nextPhoneNumber(),
  }
}

async function main(): Promise<void> {
  const wilayas = WILAYA_CODE
    ? await prisma.wilaya.findMany({ where: { code: WILAYA_CODE } })
    : await prisma.wilaya.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } })

  if (WILAYA_CODE && wilayas.length === 0) throw new Error(`No wilaya with code "${WILAYA_CODE}"`)
  if (wilayas.length === 0) throw new Error('No active wilayas found')

  console.log(
    WILAYA_CODE
      ? `Registering ${PER_COMMUNE} mock applications per commune in wilaya ${WILAYA_CODE}...`
      : `Registering ${PER_COMMUNE} mock applications per commune across all ${wilayas.length} wilayas...`,
  )

  let registered = 0
  let skipped = 0

  for (const wilaya of wilayas) {
    const communes = await prisma.commune.findMany({
      where: { wilayaId: wilaya.id },
      orderBy: { code: 'asc' },
    })

    for (const commune of communes) {
      for (let i = 0; i < PER_COMMUNE; i += 1) {
        const slot = i % 4
        let primary: MockApplicant
        let secondary: MockApplicant | undefined

        if (slot === 2) {
          // SINGLE female, 45+: eligible alone, no Mahram required.
          primary = buildApplicant(
            FEMALE_FIRST_NAMES,
            i,
            FEMALE_SOLO_AGES[i % FEMALE_SOLO_AGES.length]!,
            'FEMALE',
          )
        } else if (slot === 3) {
          // PAIRED: female under 45 with a male Mahram.
          primary = buildApplicant(
            FEMALE_FIRST_NAMES,
            i,
            FEMALE_PAIRED_AGES[i % FEMALE_PAIRED_AGES.length]!,
            'FEMALE',
          )
          secondary = buildApplicant(MALE_FIRST_NAMES, i + 1, MAHRAM_AGES[i % MAHRAM_AGES.length]!, 'MALE')
        } else {
          // SINGLE male.
          primary = buildApplicant(MALE_FIRST_NAMES, i, MALE_AGES[i % MALE_AGES.length]!, 'MALE')
        }

        const input = createApplicationSchema.parse({
          entryType: secondary ? 'PAIRED' : 'SINGLE',
          wilayaId: wilaya.id,
          communeId: commune.id,
          primary,
          secondary,
        })

        try {
          const receipt = await registrationService.register(input)
          registered += receipt.applicantCount
        } catch (error) {
          skipped += 1
          const message = error instanceof Error ? error.message : String(error)
          console.warn(`  skipped one application in ${commune.nameFr}: ${message}`)
        }
      }
    }

    // A nationwide run takes a while -- one line per wilaya is how an
    // operator tells "still working" from "hung" without per-commune noise.
    if (!WILAYA_CODE) {
      console.log(
        `  wilaya ${wilaya.code} (${wilaya.nameFr}): ${communes.length} communes done, ` +
          `${registered} applicants registered so far`,
      )
    }
  }

  console.log(`Done: ${registered} applicants registered, ${skipped} applications skipped.`)
}

main()
  .catch((error) => {
    console.error('Mock application seeding failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
