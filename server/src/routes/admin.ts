import { Router } from 'express'

import {
  getApplicationEligibility,
  getApplicationWeight,
} from '../controllers/admin-application.controller.js'
import { getCommune, getWilaya, listCommunes, listWilayas } from '../controllers/admin-geo.controller.js'
import { getHistoryRecord, getParticipantHistory } from '../controllers/admin-history.controller.js'
import { asyncHandler } from '../middleware/error-handler.js'
import { requireAuthenticatedUser } from '../middleware/require-authenticated-user.js'

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
