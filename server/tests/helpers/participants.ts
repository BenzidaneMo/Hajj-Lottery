/**
 * A shared applicant fixture, replacing the near-identical local `applicant()`
 * function several test files used to declare on their own.
 *
 * Returns a plain object shaped like a registration request's applicant —
 * raw, pre-normalization values, exactly what `POST /api/applications` or a
 * direct `prisma.participant.create` expects — not a DB-writing factory.
 */
export function buildApplicant(
  nationalId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    nationalId,
    // Deliberately not "Test" anything — several suites' geography fixtures
    // are literally named "Test Wilaya A"/"Test Commune A1", and a name that
    // shares that word would make a "nothing leaked" assertion collide with
    // legitimate, expected content.
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

/**
 * Default field values for a direct `prisma.participant.create`/`upsert`,
 * spreadable with overrides. `lastNameLatin` is the usual place to give a
 * fixture a distinguishing, human-readable label — the same role `fullName`
 * used to play — since nothing in these tests asserts on the Arabic fields.
 */
export function participantFixture(
  nationalId: string,
  overrides: Partial<{
    firstNameAr: string
    lastNameAr: string
    firstNameLatin: string
    lastNameLatin: string
    dob: Date
    gender: 'MALE' | 'FEMALE'
    phoneNumber: string
    hasWonHajj: boolean
  }> = {},
) {
  return {
    nationalId,
    firstNameAr: 'ياسين',
    lastNameAr: 'بلقاسم',
    firstNameLatin: 'Yanis',
    lastNameLatin: 'Subject',
    dob: new Date('1985-04-12T00:00:00.000Z'),
    gender: 'MALE' as const,
    phoneNumber: '+213555123456',
    ...overrides,
  }
}
