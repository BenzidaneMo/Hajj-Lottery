import type { CommuneDrawDto, CommuneDrawStatus, DrawYearDto, DrawYearStatus } from '@hajj-lottery/shared'
import type { DrawYear } from '@prisma/client'
import type { RequestHandler } from 'express'

import { BadRequestError, NotFoundError } from '../lib/errors.js'
import { getAuthenticatedUser } from '../middleware/require-authenticated-user.js'
import { auditActor } from '../services/audit.service.js'
import { authorizationService } from '../services/authorization.service.js'
import {
  drawConfigurationService,
  type CommuneDrawWithPlace,
} from '../services/draw-configuration.service.js'
import {
  createCommuneDrawSchema,
  createDrawYearSchema,
  updateCommuneDrawSchema,
  updateDrawYearSchema,
} from '../validation/draw-configuration.js'

/**
 * Draw configuration for administrators.
 *
 * Reads are open to any administrator and narrowed to their territory. Writes
 * are SUPER_ADMIN-only, gated at the route — allocation is a national
 * decision, and a wilaya or commune administrator awarding their own
 * pilgrimage places is exactly the conflict of interest the roles exist to
 * prevent.
 */

// --- The national cycle ------------------------------------------------------

/**
 * GET /api/admin/draw-years
 *
 * Unscoped, deliberately: a draw year is national, has no commune, and reveals
 * nothing about any territory. Which *communes* are configured within it is a
 * separate, scoped question.
 */
export const listDrawYears: RequestHandler = async (_req, res) => {
  const years = await drawConfigurationService.listDrawYears()

  res.json(years.map(toDrawYearDto))
}

/** GET /api/admin/draw-years/:year — addressed by calendar year, not by id. */
export const getDrawYear: RequestHandler = async (req, res) => {
  const year = Number(req.params.year)
  if (!Number.isInteger(year)) throw new NotFoundError('DRAW_YEAR_NOT_FOUND', 'Draw year not found')

  const drawYear = await drawConfigurationService.findDrawYear(year)
  if (!drawYear) throw new NotFoundError('DRAW_YEAR_NOT_FOUND', 'Draw year not found')

  res.json(toDrawYearDto(drawYear))
}

/** POST /api/admin/draw-years — SUPER_ADMIN only. Always created as a draft. */
export const createDrawYear: RequestHandler = async (req, res) => {
  const parsed = createDrawYearSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new BadRequestError(
      'VALIDATION_FAILED',
      'Please check the draw year',
      parsed.error.flatten().fieldErrors,
    )
  }

  const created = await drawConfigurationService.createDrawYear(
    parsed.data.year,
    auditActor(getAuthenticatedUser(req)),
  )

  res.status(201).json(toDrawYearDto({ ...created, _count: { communeDraws: 0 } }))
}

/**
 * PATCH /api/admin/draw-years/:id — SUPER_ADMIN only.
 *
 * Status only, and only along a transition the lifecycle permits. Opening
 * registration for a second year while one is already open is refused by the
 * database, not merely by a prior check.
 */
export const updateDrawYear: RequestHandler = async (req, res) => {
  const parsed = updateDrawYearSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new BadRequestError(
      'VALIDATION_FAILED',
      'Please check the requested status',
      parsed.error.flatten().fieldErrors,
    )
  }

  const updated = await drawConfigurationService.updateDrawYearStatus(
    req.params.id ?? '',
    parsed.data.status as DrawYearStatus,
    auditActor(getAuthenticatedUser(req)),
  )
  const withCount = await drawConfigurationService.findDrawYear(updated.year)

  res.json(toDrawYearDto(withCount ?? { ...updated, _count: { communeDraws: 0 } }))
}

// --- One commune's draw ------------------------------------------------------

/**
 * GET /api/admin/commune-draws
 *
 * Scoped: the caller's ceiling is part of the query, so a commune draw outside
 * their territory is simply not in the result rather than filtered out
 * afterwards. `drawYearId` and `communeId` narrow it further and can only ever
 * remove rows.
 */
export const listCommuneDraws: RequestHandler = async (req, res) => {
  const draws = await authorizationService.listCommuneDraws(getAuthenticatedUser(req), {
    drawYearId: queryString(req.query.drawYearId),
    communeId: queryString(req.query.communeId),
  })

  res.json(drawConfigurationService.sortByCommuneCode(draws).map(toCommuneDrawDto))
}

/** GET /api/admin/commune-draws/:id — 404 for out-of-scope, as for missing. */
export const getCommuneDraw: RequestHandler = async (req, res) => {
  const draw = await authorizationService.findCommuneDraw(getAuthenticatedUser(req), req.params.id ?? '')
  if (!draw) throw new NotFoundError('COMMUNE_DRAW_NOT_FOUND', 'Commune draw not found')

  res.json(toCommuneDrawDto(draw))
}

/** POST /api/admin/commune-draws — SUPER_ADMIN only. */
export const createCommuneDraw: RequestHandler = async (req, res) => {
  const parsed = createCommuneDrawSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new BadRequestError(
      'VALIDATION_FAILED',
      'Please check the draw configuration',
      parsed.error.flatten().fieldErrors,
    )
  }

  const created = await drawConfigurationService.createCommuneDraw(
    parsed.data,
    auditActor(getAuthenticatedUser(req)),
  )

  res.status(201).json(toCommuneDrawDto(created))
}

/**
 * PATCH /api/admin/commune-draws/:id — SUPER_ADMIN only.
 *
 * The allocation may move while the draw is still configurable and not after:
 * once locked, the number of places is the published terms of a lottery.
 */
export const updateCommuneDraw: RequestHandler = async (req, res) => {
  const parsed = updateCommuneDrawSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new BadRequestError(
      'VALIDATION_FAILED',
      'Please check the draw configuration',
      parsed.error.flatten().fieldErrors,
    )
  }

  const updated = await drawConfigurationService.updateCommuneDraw(
    req.params.id ?? '',
    {
      ...(parsed.data.allocatedSpots === undefined ? {} : { allocatedSpots: parsed.data.allocatedSpots }),
      ...(parsed.data.status === undefined ? {} : { status: parsed.data.status as CommuneDrawStatus }),
    },
    auditActor(getAuthenticatedUser(req)),
  )

  res.json(toCommuneDrawDto(updated))
}

function toDrawYearDto(year: DrawYear & { _count: { communeDraws: number } }): DrawYearDto {
  return {
    id: year.id,
    year: year.year,
    status: year.status,
    communeDrawCount: year._count.communeDraws,
    createdAt: year.createdAt.toISOString(),
    updatedAt: year.updatedAt.toISOString(),
  }
}

function toCommuneDrawDto(draw: CommuneDrawWithPlace): CommuneDrawDto {
  const { commune } = draw

  return {
    id: draw.id,
    drawYear: draw.drawYear.year,
    allocatedSpots: draw.allocatedSpots,
    status: draw.status,
    commune: {
      id: commune.id,
      code: commune.code,
      nameAr: commune.nameAr,
      nameFr: commune.nameFr,
      nameEn: commune.nameEn,
    },
    wilaya: {
      id: commune.wilaya.id,
      code: commune.wilaya.code,
      nameAr: commune.wilaya.nameAr,
      nameFr: commune.wilaya.nameFr,
      nameEn: commune.wilaya.nameEn,
    },
    createdAt: draw.createdAt.toISOString(),
    updatedAt: draw.updatedAt.toISOString(),
  }
}

function queryString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
