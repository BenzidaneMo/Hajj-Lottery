import type { RequestHandler } from 'express'

import { BadRequestError } from '../lib/errors.js'
import { getAuthenticatedUser } from '../middleware/require-authenticated-user.js'
import { auditActor } from '../services/audit.service.js'
import { reserveService } from '../services/reserve.service.js'
import {
  abandonWinnerSchema,
  callReserveSchema,
  declineReserveSchema,
  positionParamSchema,
} from '../validation/reserve.js'
import { readResultDto, scopedCommuneDraw } from './admin-draw-result.controller.js'

/**
 * The reserve lifecycle, over HTTP.
 *
 * Four operations, all national. A draw's reserve list is the mechanism that
 * decides who goes to Mecca when somebody cannot, and every one of these acts
 * either removes a place from the person holding it or awards one to somebody
 * else — the same reasons executing and publishing a draw are SUPER_ADMIN work
 * apply here in full. Scoped administrators read their commune's winners and
 * reserves through `GET .../result`, which is where they can check the list and
 * see who has been called, and that is the whole of their authority over it.
 *
 * The narrowest authority is deliberate rather than settled. Whether a wilaya
 * office should be able to record an abandonment in its own territory is a
 * policy question nobody has answered, and the way to leave it open is to refuse
 * for now: widening an authority later is a decision, while narrowing one is a
 * retraction — see docs/reserves-and-replacements.md.
 *
 * Every handler resolves the commune draw through the caller's own scope first,
 * so another territory's draw is *not found* rather than refused, exactly as an
 * id that was never issued would be. And every one answers with the draw's whole
 * new state, read back from the records that were written.
 */

/** A 1-based position from the path, or a 400 that says so. */
function positionFrom(raw: string | undefined, label: string): number {
  const parsed = positionParamSchema.safeParse(raw)
  if (!parsed.success) throw new BadRequestError('VALIDATION_FAILED', `Invalid ${label}`)

  return parsed.data
}

/**
 * POST /api/admin/commune-draws/:id/winners/:selectionOrder/abandon — SUPER_ADMIN.
 *
 * Records that an original winner has given up their place, and stops there. It
 * promotes nobody: calling the next reserve is a separate, separately audited
 * decision, so that the record shows two acts by two named people rather than
 * one button that quietly did both.
 *
 * It also takes nothing away. The winner keeps their place in the draw's
 * history, keeps their archive row, and keeps `has_won_hajj` — a place that was
 * awarded and given up was still awarded, and there is no operation anywhere in
 * this system that turns a lifetime exclusion back off.
 */
export const abandonWinner: RequestHandler = async (req, res) => {
  const parsed = abandonWinnerSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new BadRequestError('VALIDATION_FAILED', 'Invalid abandonment', parsed.error.flatten())
  }

  const communeDraw = await scopedCommuneDraw(req)
  const selectionOrder = positionFrom(req.params.selectionOrder, 'selection order')

  await reserveService.recordAbandonment(
    communeDraw,
    selectionOrder,
    parsed.data,
    auditActor(getAuthenticatedUser(req)),
  )

  res.status(201).json(await readResultDto(communeDraw))
}

/**
 * POST /api/admin/commune-draws/:id/reserves/:reservePosition/call — SUPER_ADMIN.
 *
 * Offers a vacated place to the next reserve in the lottery's order.
 *
 * The position in the path is a confirmation, not a choice. The service refuses
 * anything but the first waiting reserve, so an administrator cannot reach past
 * reserve #1 to reserve #7 — the order was decided by the draw, and choosing
 * within it would be choosing a winner. Naming the position anyway means two
 * administrators working from the same list cannot both believe they called
 * somebody different.
 */
export const callReserve: RequestHandler = async (req, res) => {
  const parsed = callReserveSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new BadRequestError('VALIDATION_FAILED', 'Invalid reserve call', parsed.error.flatten())
  }

  const communeDraw = await scopedCommuneDraw(req)
  const reservePosition = positionFrom(req.params.reservePosition, 'reserve position')

  await reserveService.callNextReserve(
    communeDraw,
    reservePosition,
    parsed.data.winnerSelectionOrder,
    auditActor(getAuthenticatedUser(req)),
  )

  res.json(await readResultDto(communeDraw))
}

/**
 * POST /api/admin/commune-draws/:id/reserves/:reservePosition/accept — SUPER_ADMIN.
 *
 * The moment a reserve becomes a winner: archive row, lifetime exclusion,
 * finalized application and corrected ledger, in one transaction with the audit
 * record. The body is ignored entirely — there is nothing a caller could
 * usefully say and a great deal they must not be able to.
 *
 * The original draw is untouched. No winner row is written, no selection order
 * moves, and the published result still says exactly what the lottery did; the
 * reserve stays reserve #N of this draw and separately holds a place.
 */
export const acceptReserve: RequestHandler = async (req, res) => {
  const communeDraw = await scopedCommuneDraw(req)
  const reservePosition = positionFrom(req.params.reservePosition, 'reserve position')

  await reserveService.promoteReserve(communeDraw, reservePosition, auditActor(getAuthenticatedUser(req)))

  res.json(await readResultDto(communeDraw))
}

/**
 * POST /api/admin/commune-draws/:id/reserves/:reservePosition/decline — SUPER_ADMIN.
 *
 * Records that a called reserve refused. The place becomes vacant again and the
 * next reserve may be called for it; this one is not asked twice.
 *
 * There is no automatic version of this. Nothing expires a call, and silence is
 * never taken for an answer — an administrator records what the citizen actually
 * said, with an explanation, or records nothing.
 */
export const declineReserve: RequestHandler = async (req, res) => {
  const parsed = declineReserveSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new BadRequestError('VALIDATION_FAILED', 'Invalid refusal', parsed.error.flatten())
  }

  const communeDraw = await scopedCommuneDraw(req)
  const reservePosition = positionFrom(req.params.reservePosition, 'reserve position')

  await reserveService.declineReserve(
    communeDraw,
    reservePosition,
    parsed.data.explanation,
    auditActor(getAuthenticatedUser(req)),
  )

  res.json(await readResultDto(communeDraw))
}
