import { ABANDONMENT_REASONS, MAX_REASON_LENGTH } from '@hajj-lottery/shared'
import { z } from 'zod'

/**
 * Request shapes for the reserve lifecycle.
 *
 * `.strict()` throughout, and what it refuses here is the point. There is no
 * field on any of these that could name a participant, a winner to promote out
 * of turn, a reserve position to prefer, or an administrator other than the one
 * signed in — and a body that carries one is a **400**, not a silently ignored
 * extra. The ordering comes from the lottery and the actor comes from the
 * session; both are things a request must be unable to influence.
 */

/**
 * A human's account of what happened.
 *
 * Trimmed before it is measured, so whitespace cannot pass as an explanation.
 * Somebody has been removed from a pilgrimage they were told they had won, or
 * has turned one down — an entry nobody had to justify is indistinguishable from
 * a mistake once everyone involved has moved on.
 */
const explanationSchema = z
  .string({
    required_error: 'An explanation is required',
    invalid_type_error: 'An explanation must be text',
  })
  .trim()
  .min(1, 'An explanation is required')
  .max(MAX_REASON_LENGTH, `An explanation must be at most ${MAX_REASON_LENGTH} characters`)

/** A 1-based position from the path: a selection order, or a reserve position. */
export const positionParamSchema = z.coerce
  .number({ invalid_type_error: 'That is not a position' })
  .int('A position is a whole number')
  .min(1, 'Positions start at 1')

/**
 * POST /api/admin/commune-draws/:id/winners/:selectionOrder/abandon
 *
 * The reason is a controlled category *and* an explanation, because neither
 * alone is enough: a category can be filed and counted, and the sentence beside
 * it is what an investigator reads three years later. Note that the software
 * asserts nothing by accepting `DEATH` or `MEDICAL` — an official is recording a
 * fact established somewhere else.
 */
export const abandonWinnerSchema = z
  .object({
    reason: z.enum(ABANDONMENT_REASONS, { required_error: 'A reason category is required' }),
    explanation: explanationSchema,
  })
  .strict()

/**
 * POST /api/admin/commune-draws/:id/reserves/:reservePosition/call
 *
 * Names the place being filled, by the original selection order of the winner
 * who gave it up. It does not — and cannot — name the reserve: that comes from
 * the path, and the service refuses it unless it is the next one waiting.
 */
export const callReserveSchema = z
  .object({
    winnerSelectionOrder: z
      .number({ required_error: 'The abandoned winner’s selection order is required' })
      .int('A selection order is a whole number')
      .min(1, 'Selection orders start at 1'),
  })
  .strict()

/** POST /api/admin/commune-draws/:id/reserves/:reservePosition/decline */
export const declineReserveSchema = z.object({ explanation: explanationSchema }).strict()

export type AbandonWinnerInput = z.infer<typeof abandonWinnerSchema>
export type CallReserveInput = z.infer<typeof callReserveSchema>
export type DeclineReserveInput = z.infer<typeof declineReserveSchema>
