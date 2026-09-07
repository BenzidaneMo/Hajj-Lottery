import { Router } from 'express'

import { getCommune, getWilaya, listCommunes, listWilayas } from '../controllers/admin-geo.controller.js'
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
