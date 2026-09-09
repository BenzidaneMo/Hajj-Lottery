import type {
  AdminApplicantDto,
  AdminApplicationDetailDto,
  AdminApplicationPageDto,
  AdminApplicationSummaryDto,
  AdminDashboardDto,
  AdminParticipantPageDto,
  AdminParticipantSummaryDto,
  AdminPlaceDto,
} from '@hajj-lottery/shared'
import type { Commune, Participant, Wilaya } from '@prisma/client'
import type { RequestHandler } from 'express'

import { BadRequestError, NotFoundError } from '../lib/errors.js'
import { getAuthenticatedUser } from '../middleware/require-authenticated-user.js'
import {
  adminConsoleService,
  type ApplicationWithApplicants,
  type ApplicationWithPlace,
} from '../services/admin-console.service.js'
import { adminApplicationQuerySchema, adminParticipantQuerySchema } from '../validation/admin-console.js'

/**
 * The administrative console's read surface.
 *
 * Everything here is scoped inside the service's query rather than checked
 * afterwards, so an out-of-scope application comes back as a 404 that is
 * byte-identical to one for an id that was never issued.
 */

/**
 * GET /api/admin/dashboard
 *
 * One request, deliberately. The alternative — listing commune draws and then
 * calling three endpoints per row — would be slow, would put every commune's
 * detail in the browser to render a handful of totals, and would compute in
 * React numbers the server is the authority on.
 */
export const getDashboard: RequestHandler = async (req, res) => {
  const reading = await adminConsoleService.dashboard(getAuthenticatedUser(req))

  const dto: AdminDashboardDto = {
    scope: reading.scope,
    wilaya: reading.wilaya ? toPlaceDto(reading.wilaya) : null,
    commune: reading.commune ? toPlaceDto(reading.commune) : null,
    drawYear: reading.drawYear
      ? { id: reading.drawYear.id, year: reading.drawYear.year, status: reading.drawYear.status }
      : null,
    counts: reading.counts,
    governance: reading.governance,
    generatedAt: reading.generatedAt.toISOString(),
  }

  res.json(dto)
}

/** GET /api/admin/applications — one page of the caller's own territory. */
export const listApplications: RequestHandler = async (req, res) => {
  const parsed = adminApplicationQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    throw new BadRequestError(
      'VALIDATION_FAILED',
      'Please check the filters',
      parsed.error.flatten().fieldErrors,
    )
  }

  const page = await adminConsoleService.listApplications(getAuthenticatedUser(req), parsed.data)

  const dto: AdminApplicationPageDto = {
    items: page.items.map(toApplicationSummaryDto),
    page: page.page,
    pageSize: page.pageSize,
    total: page.total,
    totalPages: page.totalPages,
  }

  res.json(dto)
}

/**
 * GET /api/admin/applications/:id
 *
 * Carries the applicants, because an administrator serving a citizen at a
 * counter needs to know who is on the application. It carries only the last
 * four digits of a national ID and no phone number at all: enough to confirm
 * the person in front of you, not enough to copy an identity out of a screen.
 */
export const getApplication: RequestHandler = async (req, res) => {
  const applicationId = req.params.id
  if (!applicationId) throw new NotFoundError('APPLICATION_NOT_FOUND', 'Application not found')

  const application = await adminConsoleService.findApplication(getAuthenticatedUser(req), applicationId)
  if (!application) throw new NotFoundError('APPLICATION_NOT_FOUND', 'Application not found')

  res.json(toApplicationDetailDto(application))
}

/**
 * GET /api/admin/participants — SUPER_ADMIN only, gated at the route.
 *
 * A participant belongs to no commune, so there is no scope that could narrow
 * this; the registry is national or it is nothing. That is precisely why a
 * scoped administrator must reach a person through a commune's applications or
 * ledger instead, where their territory is part of the query.
 */
export const listParticipants: RequestHandler = async (req, res) => {
  const parsed = adminParticipantQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    throw new BadRequestError(
      'VALIDATION_FAILED',
      'Please check the filters',
      parsed.error.flatten().fieldErrors,
    )
  }

  const page = await adminConsoleService.listParticipants(parsed.data)

  const dto: AdminParticipantPageDto = {
    items: page.items.map(toParticipantSummaryDto),
    page: page.page,
    pageSize: page.pageSize,
    total: page.total,
    totalPages: page.totalPages,
  }

  res.json(dto)
}

// --- Mapping -----------------------------------------------------------------

export function toPlaceDto(place: Wilaya | Commune): AdminPlaceDto {
  return {
    id: place.id,
    code: place.code,
    nameAr: place.nameAr,
    nameFr: place.nameFr,
    nameEn: place.nameEn,
  }
}

function toApplicationSummaryDto(application: ApplicationWithPlace): AdminApplicationSummaryDto {
  return {
    id: application.id,
    applicationReference: application.applicationReference,
    drawYear: application.drawYear,
    entryType: application.entryType,
    status: application.status,
    participantCount: application.secondaryParticipantId ? 2 : 1,
    calculatedWeight: application.calculatedWeight,
    commune: toPlaceDto(application.commune),
    wilaya: toPlaceDto(application.commune.wilaya),
    createdAt: application.createdAt.toISOString(),
  }
}

function toApplicationDetailDto(application: ApplicationWithApplicants): AdminApplicationDetailDto {
  return {
    ...toApplicationSummaryDto(application),
    applicants: application.participants.map((link): AdminApplicantDto => ({
      participantId: link.participantId,
      role: link.role,
      fullName: link.participant.fullName,
      nationalIdSuffix: link.participant.nationalId.slice(-4),
      dob: link.participant.dob.toISOString().slice(0, 10),
      hasWonHajj: link.participant.hasWonHajj,
    })),
    updatedAt: application.updatedAt.toISOString(),
  }
}

function toParticipantSummaryDto(participant: Participant): AdminParticipantSummaryDto {
  return {
    id: participant.id,
    fullName: participant.fullName,
    nationalId: participant.nationalId,
    dob: participant.dob.toISOString().slice(0, 10),
    phoneNumber: participant.phoneNumber,
    hasWonHajj: participant.hasWonHajj,
    createdAt: participant.createdAt.toISOString(),
  }
}
