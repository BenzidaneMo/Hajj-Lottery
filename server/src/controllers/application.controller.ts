import type { RegistrationWindowDto } from '@hajj-lottery/shared'
import type { RequestHandler } from 'express'

import { currentRegistrationWindow } from '../config/registration.js'
import { BadRequestError } from '../lib/errors.js'
import { registrationService } from '../services/registration.service.js'
import { createApplicationSchema } from '../validation/application.js'

/**
 * POST /api/applications — public citizen registration.
 *
 * Nothing about this request body is trusted beyond its shape: the draw year,
 * the commune's wilaya, whether the applicants already applied and whether
 * they are eligible are all decided by the service against the database.
 */
export const createApplication: RequestHandler = async (req, res) => {
  const parsed = createApplicationSchema.safeParse(req.body)
  if (!parsed.success) {
    // Field-level messages are safe: they describe the submitted form, not
    // anything about who else exists in the registry. The body itself is
    // never logged — it is full of national IDs.
    throw new BadRequestError(
      'VALIDATION_FAILED',
      'Please check the details you entered',
      parsed.error.flatten().fieldErrors,
    )
  }

  const receipt = await registrationService.register(parsed.data)
  res.status(201).json(receipt)
}

/**
 * GET /api/applications/registration-window — lets the form show the year it
 * is applying for, and close itself when intake is not running. The server
 * re-checks both on submission regardless.
 */
export const getRegistrationWindow: RequestHandler = (_req, res) => {
  const window = currentRegistrationWindow()
  const body: RegistrationWindowDto = { drawYear: window.drawYear, isOpen: window.isOpen }
  res.json(body)
}
