import type { ApplicationEligibilityDto } from '@hajj-lottery/shared'
import type { RequestHandler } from 'express'

import { NotFoundError } from '../lib/errors.js'
import { getAuthenticatedUser } from '../middleware/require-authenticated-user.js'
import { authorizationService } from '../services/authorization.service.js'
import { eligibilityService } from '../services/eligibility.service.js'

/**
 * GET /api/admin/applications/:id/eligibility
 *
 * Why an application stands where it does, for the administrator responsible
 * for it. Deliberately narrow: this is a review endpoint, not the application
 * management dashboard, and it returns a verdict rather than a person.
 *
 * The evaluation is recomputed on request rather than read from a stored
 * summary, so it always reflects the facts as they are now — if a participant
 * has since been recorded as a past winner, the answer changes accordingly,
 * whatever `status` still says.
 */
export const getApplicationEligibility: RequestHandler = async (req, res) => {
  // Scope is applied inside the query. An application in another
  // administrator's territory is not found here, which is the same answer an
  // id that was never issued gets — ids cannot be probed for existence.
  const application = await authorizationService.findApplication(
    getAuthenticatedUser(req),
    req.params.id ?? '',
  )
  if (!application) throw new NotFoundError('APPLICATION_NOT_FOUND', 'Application not found')

  const evaluation = await eligibilityService.evaluateApplication(application.id)
  // Only a deletion between those two queries could produce this, and the
  // answer to "it is gone now" is the same as "it was never yours".
  if (!evaluation) throw new NotFoundError('APPLICATION_NOT_FOUND', 'Application not found')

  const { commune } = application
  const body: ApplicationEligibilityDto = {
    applicationReference: application.applicationReference,
    drawYear: application.drawYear,
    entryType: application.entryType,
    storedStatus: application.status,
    evaluation,
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
    evaluatedAt: new Date().toISOString(),
  }

  res.json(body)
}
