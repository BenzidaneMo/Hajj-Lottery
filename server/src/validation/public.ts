import { PUBLIC_PAGE_SIZE_DEFAULT, PUBLIC_PAGE_SIZE_MAX } from '@hajj-lottery/shared'
import { z } from 'zod'

import { normalizeApplicationReference } from '../lib/application-reference.js'
import { normalizePhoneNumber } from '../lib/phone.js'

/**
 * What a public request may say.
 *
 * These are the only schemas in the system parsing input from a caller nobody
 * has authenticated, so they are deliberately narrow. Every string is bounded,
 * every page size is clamped rather than trusted, and every object is `.strict()`
 * so an unexpected field is a 400 instead of something quietly ignored.
 */

/**
 * The status lookup body.
 *
 * Both values are normalized here rather than in the service, so the service
 * only ever compares canonical forms — the same rule national IDs follow. A
 * reference typed in lowercase and a number written `0555 12 34 56` reach the
 * lookup in exactly the form they were stored in, because a formatting
 * difference telling somebody their own application does not exist would be a
 * worse failure than most real ones.
 *
 * Neither field is *validated* beyond its length. A malformed reference is
 * looked up and fails like any other wrong one: refusing it with a distinct
 * error would tell a caller which shapes are worth trying.
 */
export const applicationStatusLookupSchema = z
  .object({
    applicationReference: z
      .string({ required_error: 'Enter your application reference' })
      .min(1)
      .max(64)
      .transform(normalizeApplicationReference),
    phoneNumber: z
      .string({ required_error: 'Enter the mobile number on the application' })
      .min(1)
      .max(32)
      .transform(normalizePhoneNumber),
  })
  .strict()

export type ApplicationStatusLookupInput = z.infer<typeof applicationStatusLookupSchema>

/**
 * A page number and size from a query string.
 *
 * `pageSize` is clamped, not rejected: a caller asking for ten million rows is
 * usually a broken client rather than an attacker, and serving them a hundred is
 * more useful than a validation error. The clamp is what actually bounds the
 * response, so it lives here rather than in each service.
 */
const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).optional().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .catch(PUBLIC_PAGE_SIZE_DEFAULT)
    .optional()
    .default(PUBLIC_PAGE_SIZE_DEFAULT)
    .transform((value) => Math.min(value, PUBLIC_PAGE_SIZE_MAX)),
})

/**
 * Geographic and annual filters, by official code.
 *
 * Codes rather than ids throughout — a public URL names a commune the way a
 * citizen does. An unknown code is not an error: it simply matches nothing, so
 * a caller cannot use the difference between "no such wilaya" and "no results
 * there yet" to map the reference data, which is public anyway but need not be
 * enumerable through this route as well.
 */
const geographicFilterSchema = z.object({
  drawYear: z.coerce.number().int().min(2000).max(2200).optional(),
  wilayaCode: z.string().min(1).max(10).optional(),
  communeCode: z.string().min(1).max(10).optional(),
})

export const publicResultsQuerySchema = geographicFilterSchema.merge(paginationSchema).strict()
export type PublicResultsQuery = z.infer<typeof publicResultsQuerySchema>

export const publicDrawStatusQuerySchema = geographicFilterSchema.merge(paginationSchema).strict()
export type PublicDrawStatusQuery = z.infer<typeof publicDrawStatusQuerySchema>

/** The path parameters addressing one commune's published result. */
export const publicResultParamsSchema = z
  .object({
    drawYear: z.coerce.number().int().min(2000).max(2200),
    wilayaCode: z.string().min(1).max(10),
    communeCode: z.string().min(1).max(10),
  })
  .strict()
