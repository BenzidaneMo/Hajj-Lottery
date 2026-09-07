import { z } from 'zod'

import { isValidPhoneNumber, normalizePhoneNumber } from '../lib/phone.js'
import { dobSchema, fullNameSchema, nationalIdSchema } from './participant.js'

/**
 * Optional contact number, normalized to `+213XXXXXXXXX`. An empty string is
 * treated as "not supplied" rather than rejected, because a blank optional
 * input is what a browser sends for an untouched field.
 */
export const phoneNumberSchema = z
  .string()
  .transform((value) => value.trim())
  .transform((value) => (value === '' ? undefined : normalizePhoneNumber(value)))
  .refine((value) => value === undefined || isValidPhoneNumber(value), {
    message: 'Enter an Algerian mobile number, for example 0555 12 34 56',
  })

/** One applicant's identity, shared by the primary and secondary slots. */
const applicantSchema = z
  .object({
    nationalId: nationalIdSchema,
    fullName: fullNameSchema,
    dob: dobSchema,
    phoneNumber: phoneNumberSchema.optional(),
  })
  .strict()

/**
 * Body of POST /api/applications.
 *
 * There is no `drawYear` field on purpose — the server decides the year, and
 * `.strict()` means a client that tries to send one gets a validation error
 * rather than having it silently ignored.
 */
export const createApplicationSchema = z
  .object({
    entryType: z.enum(['SINGLE', 'PAIRED'], {
      required_error: 'Choose whether you are applying alone or as a pair',
    }),
    wilayaId: z.string({ required_error: 'Select a wilaya' }).min(1).max(100),
    communeId: z.string({ required_error: 'Select a commune' }).min(1).max(100),
    primary: applicantSchema,
    secondary: applicantSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.entryType === 'PAIRED' && !value.secondary) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['secondary'],
        message: 'A paired application needs a second applicant',
      })
    }

    if (value.entryType === 'SINGLE' && value.secondary) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['secondary'],
        message: 'A single application cannot include a second applicant',
      })
    }

    // Caught here as well as by the database, so the citizen gets a readable
    // message instead of a constraint violation.
    if (value.secondary && value.secondary.nationalId === value.primary.nationalId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['secondary', 'nationalId'],
        message: 'The two applicants must be different people',
      })
    }
  })

export type CreateApplicationInput = z.infer<typeof createApplicationSchema>
