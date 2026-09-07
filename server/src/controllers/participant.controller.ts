import type { RequestHandler } from 'express'

import { BadRequestError, NotFoundError } from '../lib/errors.js'
import { participantService, toParticipantDto } from '../services/participant.service.js'
import { createParticipantSchema } from '../validation/participant.js'

/** POST /api/participants — register a new identity record. */
export const createParticipant: RequestHandler = async (req, res) => {
  const parsed = createParticipantSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new BadRequestError(
      'VALIDATION_FAILED',
      'Invalid participant data',
      parsed.error.flatten().fieldErrors,
    )
  }

  const participant = await participantService.create(parsed.data)
  res.status(201).json(toParticipantDto(participant))
}

/** GET /api/participants/:id */
export const getParticipantById: RequestHandler = async (req, res) => {
  const participant = await participantService.getById(requireParam(req.params.id, 'id'))
  res.json(toParticipantDto(participant))
}

/** GET /api/participants/by-national-id/:nationalId */
export const getParticipantByNationalId: RequestHandler = async (req, res) => {
  const participant = await participantService.findByNationalId(
    requireParam(req.params.nationalId, 'nationalId'),
  )
  if (!participant) {
    throw new NotFoundError('PARTICIPANT_NOT_FOUND', 'Participant not found')
  }
  res.json(toParticipantDto(participant))
}

/** Express only routes here when the param matched, but the types allow undefined. */
function requireParam(value: string | undefined, name: string): string {
  if (!value) {
    throw new BadRequestError('VALIDATION_FAILED', `Missing path parameter "${name}"`)
  }
  return value
}
