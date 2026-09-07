import type { RequestHandler } from 'express'

import { NotFoundError } from '../lib/errors.js'
import { toCommuneDto, toWilayaDto } from '../lib/geo-dto.js'
import { getAuthenticatedUser } from '../middleware/require-authenticated-user.js'
import { authorizationService } from '../services/authorization.service.js'

/**
 * The administrator's view of geography, limited to their own territory.
 *
 * Distinct from the public `/api/wilayas` and `/api/communes`, which serve the
 * registration form and are intentionally unrestricted: a citizen must be able
 * to pick any commune. These endpoints answer "what may *I* administer?".
 *
 * Out-of-scope ids return 404, exactly as a nonexistent id does, so the
 * response cannot be used to discover which records exist.
 */

/** GET /api/admin/wilayas */
export const listWilayas: RequestHandler = async (req, res) => {
  const wilayas = await authorizationService.listWilayas(getAuthenticatedUser(req), {
    wilayaId: queryString(req.query.wilayaId),
  })
  res.json(wilayas.map(toWilayaDto))
}

/** GET /api/admin/wilayas/:id */
export const getWilaya: RequestHandler = async (req, res) => {
  const wilaya = await authorizationService.findWilaya(getAuthenticatedUser(req), req.params.id ?? '')
  if (!wilaya) throw new NotFoundError('WILAYA_NOT_FOUND', 'Wilaya not found')
  res.json(toWilayaDto(wilaya))
}

/** GET /api/admin/communes */
export const listCommunes: RequestHandler = async (req, res) => {
  const communes = await authorizationService.listCommunes(getAuthenticatedUser(req), {
    wilayaId: queryString(req.query.wilayaId),
    communeId: queryString(req.query.communeId),
  })
  res.json(communes.map(toCommuneDto))
}

/** GET /api/admin/communes/:id */
export const getCommune: RequestHandler = async (req, res) => {
  const commune = await authorizationService.findCommune(getAuthenticatedUser(req), req.params.id ?? '')
  if (!commune) throw new NotFoundError('COMMUNE_NOT_FOUND', 'Commune not found')
  res.json(toCommuneDto(commune))
}

function queryString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
