import { z } from 'zod'

import { isValidNationalId, NATIONAL_ID_LENGTH, normalizeNationalId } from '../lib/national-id.js'

export const FULL_NAME_MIN_LENGTH = 2
export const FULL_NAME_MAX_LENGTH = 150

/**
 * Sanity floor for a date of birth. This is a typo guard, not an eligibility
 * rule: nobody applying for Hajj was born before 1900. Age-based eligibility
 * is deliberately not decided in this step.
 */
const EARLIEST_PLAUSIBLE_DOB = new Date('1900-01-01T00:00:00.000Z')

/**
 * A national ID in any form the user might type it. Normalized first, then
 * checked — so the schema's output is always the canonical stored form.
 */
export const nationalIdSchema = z
  .string({ required_error: 'National ID is required' })
  .transform(normalizeNationalId)
  .refine(isValidNationalId, {
    message: `National ID must be ${NATIONAL_ID_LENGTH} digits`,
  })

/**
 * Calendar date, `YYYY-MM-DD`. Parsed as UTC midnight so the stored DATE is
 * never shifted a day by the server's timezone.
 */
export const dobSchema = z
  .string({ required_error: 'Date of birth is required' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be formatted YYYY-MM-DD')
  // Checked against the original text, so an impossible calendar date such as
  // 2024-02-31 is rejected rather than silently rolled forward into March.
  .refine((value) => isRealCalendarDate(value), {
    message: 'Date of birth is not a valid calendar date',
  })
  .transform(toUtcDate)
  .refine((date) => date.getTime() <= Date.now(), 'Date of birth cannot be in the future')
  .refine((date) => date.getTime() >= EARLIEST_PLAUSIBLE_DOB.getTime(), 'Date of birth is implausibly early')

/** `YYYY-MM-DD` at UTC midnight; Invalid Date for impossible input. */
function toUtcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

/**
 * True only if `value` round-trips — rejecting both unparseable input
 * (2024-13-45) and dates JS silently rolls forward (2024-02-31 -> 2024-03-02).
 */
function isRealCalendarDate(value: string): boolean {
  const date = toUtcDate(value)
  if (Number.isNaN(date.getTime())) return false
  return date.toISOString().startsWith(value)
}

export const fullNameSchema = z
  .string({ required_error: 'Full name is required' })
  .transform((value) => value.trim().replace(/\s+/g, ' '))
  .refine((value) => value.length >= FULL_NAME_MIN_LENGTH, {
    message: `Full name must be at least ${FULL_NAME_MIN_LENGTH} characters`,
  })
  .refine((value) => value.length <= FULL_NAME_MAX_LENGTH, {
    message: `Full name must be at most ${FULL_NAME_MAX_LENGTH} characters`,
  })

/** Body of POST /api/participants. */
export const createParticipantSchema = z
  .object({
    nationalId: nationalIdSchema,
    fullName: fullNameSchema,
    dob: dobSchema,
  })
  .strict()

export type CreateParticipantInput = z.infer<typeof createParticipantSchema>
