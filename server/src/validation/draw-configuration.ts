import {
  COMMUNE_DRAW_STATUSES,
  DRAW_YEAR_STATUSES,
  MAX_ALLOCATED_SPOTS,
  MIN_ALLOCATED_SPOTS,
} from '@hajj-lottery/shared'
import { z } from 'zod'

/**
 * Request shapes for draw configuration.
 *
 * `.strict()` throughout: a field nobody expects is a rejection, not something
 * quietly dropped. That is what stops a client from smuggling a status onto a
 * creation, or a `communeId` onto an update where the commune is already
 * settled.
 */

/**
 * A calendar year, bounded exactly as the database bounds it. Kept in step
 * with the CHECK constraint on `draw_years.year` deliberately — if the two
 * ever disagree the database wins, and the citizen sees a constraint violation
 * instead of a sentence.
 */
const drawYearSchema = z
  .number({ required_error: 'A draw year is required', invalid_type_error: 'A draw year must be a number' })
  .int('A draw year must be a whole number')
  .min(2000, 'That draw year is too far in the past')
  .max(2200, 'That draw year is too far in the future')

/**
 * The number of pilgrimage places a commune's draw may award.
 *
 * Zero is refused as firmly as a negative: a draw that can select nobody is a
 * cancelled draw expressed as arithmetic, and the lifecycle already has a
 * state that says that honestly.
 */
const allocatedSpotsSchema = z
  .number({
    required_error: 'Allocated spots are required',
    invalid_type_error: 'Allocated spots must be a number',
  })
  .int('Allocated spots must be a whole number')
  .min(MIN_ALLOCATED_SPOTS, 'A commune draw must allocate at least one spot')
  .max(MAX_ALLOCATED_SPOTS, 'That allocation is implausibly large')

/** POST /api/admin/draw-years — the year, and nothing else. */
export const createDrawYearSchema = z.object({ year: drawYearSchema }).strict()

/**
 * PATCH /api/admin/draw-years/:id — status only.
 *
 * The year itself is immutable. Changing which calendar year a cycle refers to
 * would silently reassign every application already filed under it.
 */
export const updateDrawYearSchema = z
  .object({ status: z.enum(DRAW_YEAR_STATUSES, { required_error: 'A status is required' }) })
  .strict()

/**
 * POST /api/admin/commune-draws.
 *
 * No `status`: a new configuration always starts as a draft, so a client
 * cannot create one already locked and skip the lifecycle.
 */
export const createCommuneDrawSchema = z
  .object({
    drawYearId: z.string({ required_error: 'A draw year is required' }).min(1).max(100),
    communeId: z.string({ required_error: 'A commune is required' }).min(1).max(100),
    allocatedSpots: allocatedSpotsSchema,
  })
  .strict()

/**
 * PATCH /api/admin/commune-draws/:id.
 *
 * Neither the year nor the commune can be changed: they are what the
 * configuration *is*, and moving either would rewrite which lottery an
 * allocation belonged to. Whether the requested change is permitted by the
 * lifecycle is decided by the service, not here — validation asks whether the
 * request is well-formed, not whether the domain allows it.
 */
export const updateCommuneDrawSchema = z
  .object({
    allocatedSpots: allocatedSpotsSchema.optional(),
    status: z.enum(COMMUNE_DRAW_STATUSES).optional(),
  })
  .strict()
  .refine((value) => value.allocatedSpots !== undefined || value.status !== undefined, {
    message: 'Provide an allocation, a status, or both',
  })

export type CreateDrawYearInput = z.infer<typeof createDrawYearSchema>
export type UpdateDrawYearInput = z.infer<typeof updateDrawYearSchema>
export type CreateCommuneDrawRequest = z.infer<typeof createCommuneDrawSchema>
export type UpdateCommuneDrawRequest = z.infer<typeof updateCommuneDrawSchema>
