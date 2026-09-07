import type { EligibilityReasonCode, EligibilityResult } from '@hajj-lottery/shared'

import { ApiError, BadRequestError, ConflictError } from './errors.js'

/**
 * Turns an internal verdict into what a citizen is allowed to be told.
 *
 * The reason codes never cross this line. `SECONDARY_PARTICIPANT_HAS_ALREADY_WON`
 * would confirm that a specific national ID belongs to a past winner, and
 * `DUPLICATE_ANNUAL_APPLICATION` would confirm that someone is registered —
 * either turns a public form into a lookup service for other people's lives.
 * So several distinct reasons deliberately collapse onto one vague message.
 *
 * The message text is carried by the *code*: the client maps it to a
 * translation key (see client/src/pages/Register.tsx), so what the citizen
 * reads is in their own language rather than the server's.
 */

/**
 * Which reason wins when an application fails several rules at once.
 *
 * Ordered from "the form is malformed" to "the person cannot take part", so
 * the citizen is told about the thing they can actually fix first. Fixed
 * rather than discovery-ordered, so the same application always produces the
 * same response.
 */
const REASON_PRECEDENCE: readonly EligibilityReasonCode[] = [
  'PARTICIPANT_NOT_FOUND',
  'SECONDARY_PARTICIPANT_NOT_FOUND',
  'APPLICATION_INCOMPLETE',
  'ENTRY_TYPE_MISMATCH',
  'DUPLICATE_APPLICANTS',
  'INVALID_COMMUNE',
  'DRAW_YEAR_INVALID',
  'PARTICIPANT_HAS_ALREADY_WON',
  'SECONDARY_PARTICIPANT_HAS_ALREADY_WON',
  'DUPLICATE_ANNUAL_APPLICATION',
  'SECONDARY_ALREADY_REGISTERED',
]

/**
 * The public error for a refused registration.
 *
 * Throwing the returned error is the caller's job — building it is not a side
 * effect, and an eligible result has no error to build.
 */
export function registrationErrorFor(result: EligibilityResult): ApiError {
  const reason = REASON_PRECEDENCE.find((code) => result.reasons.includes(code))

  switch (reason) {
    case 'INVALID_COMMUNE':
      return new BadRequestError('INVALID_COMMUNE', 'Select a commune from the chosen wilaya')

    case 'DRAW_YEAR_INVALID':
      // Unreachable through the public form, which never supplies a year: the
      // server sets it. It would mean the window moved mid-submission.
      return new ApiError(503, 'REGISTRATION_CLOSED', 'Registration is not currently open')

    case 'PARTICIPANT_HAS_ALREADY_WON':
    case 'SECONDARY_PARTICIPANT_HAS_ALREADY_WON':
      // Names neither applicant nor the reason. A citizen knows their own
      // history; nobody else learns anything from this.
      return new ApiError(
        422,
        'APPLICANT_NOT_ELIGIBLE',
        'This application cannot be accepted because an applicant is not eligible to take part',
      )

    case 'DUPLICATE_ANNUAL_APPLICATION':
    case 'SECONDARY_ALREADY_REGISTERED':
      // Identical to what a lost race produces, because both mean the same
      // thing to the applicant: someone here already has an application.
      return new ConflictError(
        'ALREADY_APPLIED',
        'An application already exists for this draw year for one of the applicants',
      )

    default:
      // Structural problems the form should have caught, plus the impossible
      // case of no reason at all. Deliberately says nothing specific.
      return new BadRequestError('VALIDATION_FAILED', 'Please check the details you entered')
  }
}
