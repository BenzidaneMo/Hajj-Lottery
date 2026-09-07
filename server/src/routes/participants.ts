import { AdminRole } from '@prisma/client'
import { Router } from 'express'

import {
  createParticipant,
  getParticipantById,
  getParticipantByNationalId,
} from '../controllers/participant.controller.js'
import { asyncHandler } from '../middleware/error-handler.js'
import { requireAuthenticatedUser } from '../middleware/require-authenticated-user.js'
import { requireRole } from '../middleware/require-role.js'

export const participantsRouter = Router()

/*
 * Participant identity is deliberately national: a participant record has no
 * commune of its own, because a person is not tied to one — they are reached
 * through the annual application that names a commune, and applications do not
 * exist yet.
 *
 * So there is no meaningful wilaya/commune narrowing to apply here, and these
 * endpoints are restricted to SUPER_ADMIN rather than given a scope filter
 * that would be fictional. When applications land, participant access for
 * WILAYA_ADMIN and COMMUNE_ADMIN should be granted *through* them, not by
 * loosening this rule.
 */
participantsRouter.use(requireAuthenticatedUser, requireRole(AdminRole.SUPER_ADMIN))

participantsRouter.post('/', asyncHandler(createParticipant))
participantsRouter.get('/by-national-id/:nationalId', asyncHandler(getParticipantByNationalId))
participantsRouter.get('/:id', asyncHandler(getParticipantById))
