import { AdminRole } from '@prisma/client'
import { Router } from 'express'

import {
  getApplicationEligibility,
  getApplicationWeight,
} from '../controllers/admin-application.controller.js'
import {
  createCommuneDraw,
  createDrawYear,
  getCommuneDraw,
  getDrawYear,
  listCommuneDraws,
  listDrawYears,
  updateCommuneDraw,
  updateDrawYear,
} from '../controllers/admin-draw.controller.js'
import {
  freezePool,
  getPool,
  getPoolSummary,
  validatePool,
} from '../controllers/admin-draw-pool.controller.js'
import { executeDraw, getDrawResult } from '../controllers/admin-draw-result.controller.js'
import { getCommune, getWilaya, listCommunes, listWilayas } from '../controllers/admin-geo.controller.js'
import { getHistoryRecord, getParticipantHistory } from '../controllers/admin-history.controller.js'
import { asyncHandler } from '../middleware/error-handler.js'
import { requireAuthenticatedUser } from '../middleware/require-authenticated-user.js'
import { requireRole } from '../middleware/require-role.js'

export const adminRouter = Router()

// Identity for the whole admin surface. Role checks are added per route, and
// geographic scope is applied inside each query — never assumed here.
adminRouter.use(requireAuthenticatedUser)

// Any signed-in administrator may call these; what comes back is narrowed to
// their own territory, so no additional role gate is needed.
adminRouter.get('/wilayas', asyncHandler(listWilayas))
adminRouter.get('/wilayas/:id', asyncHandler(getWilaya))
adminRouter.get('/communes', asyncHandler(listCommunes))
adminRouter.get('/communes/:id', asyncHandler(getCommune))

// Same rule: no role gate, because every administrator reviews applications —
// but only the ones in their own territory, which the query enforces rather
// than this line.
adminRouter.get('/applications/:id/eligibility', asyncHandler(getApplicationEligibility))
// Inspection only: reading a weight never freezes one.
adminRouter.get('/applications/:id/weight', asyncHandler(getApplicationWeight))

// The participation ledger. Both are scoped by the *record's* commune, not by
// the participant — see the controller for why a participant id is not
// something that can be authorized.
adminRouter.get('/participants/:id/history', asyncHandler(getParticipantHistory))
adminRouter.get('/history/:id', asyncHandler(getHistoryRecord))

// Draw configuration. Reading is for every administrator, narrowed to their
// own territory by the query; changing it is national work, so the mutations
// carry an explicit role gate rather than relying on scope to be restrictive
// enough — a COMMUNE_ADMIN allocating their own commune's pilgrimage places is
// precisely the conflict of interest the roles exist to prevent.
adminRouter.get('/draw-years', asyncHandler(listDrawYears))
adminRouter.get('/draw-years/:year', asyncHandler(getDrawYear))
adminRouter.post('/draw-years', requireRole(AdminRole.SUPER_ADMIN), asyncHandler(createDrawYear))
adminRouter.patch('/draw-years/:id', requireRole(AdminRole.SUPER_ADMIN), asyncHandler(updateDrawYear))

adminRouter.get('/commune-draws', asyncHandler(listCommuneDraws))
adminRouter.get('/commune-draws/:id', asyncHandler(getCommuneDraw))
adminRouter.post('/commune-draws', requireRole(AdminRole.SUPER_ADMIN), asyncHandler(createCommuneDraw))
adminRouter.patch('/commune-draws/:id', requireRole(AdminRole.SUPER_ADMIN), asyncHandler(updateCommuneDraw))

// The draw pool. Inspecting and dry-running are scoped but unrestricted by
// role — seeing why your own commune cannot be frozen is not privileged.
// Freezing is national: it fixes the terms of a lottery permanently, and
// nobody should be able to close the input to a draw they are subject to.
adminRouter.post('/commune-draws/:id/validate-pool', asyncHandler(validatePool))
adminRouter.post(
  '/commune-draws/:id/freeze-pool',
  requireRole(AdminRole.SUPER_ADMIN),
  asyncHandler(freezePool),
)
adminRouter.get('/commune-draws/:id/pool', asyncHandler(getPool))
adminRouter.get('/commune-draws/:id/pool/summary', asyncHandler(getPoolSummary))

// Running the lottery. National, because it is irreversible and it excludes the
// people it selects from every future draw — nobody should be able to run a draw
// they are themselves subject to. Reading the result afterwards is ordinary
// scoped administrative work, so it carries no role gate.
adminRouter.post('/commune-draws/:id/execute', requireRole(AdminRole.SUPER_ADMIN), asyncHandler(executeDraw))
adminRouter.get('/commune-draws/:id/result', asyncHandler(getDrawResult))
