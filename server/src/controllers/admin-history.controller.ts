import type {
  ParticipantHistoryDto,
  ParticipationHistoryDto,
  ParticipationSource,
} from '@hajj-lottery/shared'
import type { RequestHandler } from 'express'

import { NotFoundError } from '../lib/errors.js'
import { getAuthenticatedUser } from '../middleware/require-authenticated-user.js'
import { authorizationService } from '../services/authorization.service.js'
import { drawConfigurationService } from '../services/draw-configuration.service.js'
import {
  participationHistoryService,
  type HistoryRecordWithPlace,
} from '../services/participation-history.service.js'

/**
 * The administrative view of the participation ledger.
 *
 * Read-only for now, and deliberately minimal: enough to inspect what the
 * service records, not a management dashboard. Corrections exist as a service
 * operation but are not yet exposed over HTTP — that waits for the approval
 * and audit workflow, which this design leaves room for.
 */

/**
 * GET /api/admin/participants/:id/history
 *
 * A participant belongs to no commune, so there is nothing here to authorize
 * *as a participant*. The records are filtered by the caller's scope instead:
 * an administrator sees this person's years in their own territory and is
 * never told that other years exist.
 */
export const getParticipantHistory: RequestHandler = async (req, res) => {
  const user = getAuthenticatedUser(req)
  const participantId = req.params.id ?? ''

  const records = await authorizationService.listParticipantHistory(user, participantId)

  const body: ParticipantHistoryDto = {
    records: records.map(toHistoryDto),
    streak: await streakFor(user.role, participantId),
  }

  res.json(body)
}

/**
 * GET /api/admin/history/:id
 *
 * Authorized on the record's own commune. Out of scope is 404, identical to an
 * id that was never issued, so the ledger cannot be probed for who appears in
 * it.
 */
export const getHistoryRecord: RequestHandler = async (req, res) => {
  const record = await authorizationService.findHistoryRecord(getAuthenticatedUser(req), req.params.id ?? '')
  if (!record) throw new NotFoundError('HISTORY_NOT_FOUND', 'Historical record not found')

  res.json(toHistoryDto(record))
}

/**
 * The streak, for callers whose view is national.
 *
 * A streak is computed across every year a person has, wherever they took
 * part. Reporting one to a scoped administrator would leak participation
 * outside their territory — the number itself would reveal that years they
 * cannot see exist. So they get null rather than a figure narrowed until it is
 * wrong.
 */
async function streakFor(role: string, participantId: string) {
  if (role !== 'SUPER_ADMIN') return null

  const drawYear = await drawConfigurationService.referenceDrawYear()
  return participationHistoryService.calculateConsecutiveNonWinningYears(participantId, drawYear)
}

function toHistoryDto(record: HistoryRecordWithPlace): ParticipationHistoryDto {
  const { commune } = record

  return {
    id: record.id,
    drawYear: record.drawYear,
    participated: record.participated,
    won: record.won,
    source: record.source as ParticipationSource,
    verified: record.verified,
    notes: record.notes,
    commune: {
      code: commune.code,
      nameAr: commune.nameAr,
      nameFr: commune.nameFr,
      nameEn: commune.nameEn,
    },
    wilaya: {
      code: commune.wilaya.code,
      nameAr: commune.wilaya.nameAr,
      nameFr: commune.wilaya.nameFr,
      nameEn: commune.wilaya.nameEn,
    },
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}
