import { Router } from 'express'

import {
  createParticipant,
  getParticipantById,
  getParticipantByNationalId,
} from '../controllers/participant.controller.js'
import { asyncHandler } from '../middleware/error-handler.js'
import { requireInternalApiKey } from '../middleware/require-internal-api-key.js'

export const participantsRouter = Router()

// Participant records carry personal data and must never be publicly
// enumerable — the gate applies to the whole router, not per route.
participantsRouter.use(requireInternalApiKey)

participantsRouter.post('/', asyncHandler(createParticipant))
participantsRouter.get('/by-national-id/:nationalId', asyncHandler(getParticipantByNationalId))
participantsRouter.get('/:id', asyncHandler(getParticipantById))
