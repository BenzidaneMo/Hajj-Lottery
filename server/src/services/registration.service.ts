import type { ApplicationReceiptDto } from '@hajj-lottery/shared'
import {
  ApplicationRole,
  EntryType,
  Prisma,
  type Application,
  type Commune,
  type Participant,
  type PrismaClient,
  type Wilaya,
} from '@prisma/client'

import { currentRegistrationWindow } from '../config/registration.js'
import { generateApplicationReference } from '../lib/application-reference.js'
import { registrationErrorFor } from '../lib/eligibility-errors.js'
import { ApiError, BadRequestError, ConflictError } from '../lib/errors.js'
import { prisma as defaultPrisma } from '../lib/prisma.js'
import { eligibilityService, EligibilityService } from './eligibility.service.js'
import type { CreateApplicationInput } from '../validation/application.js'

/** One applicant after validation: identity fields already canonical. */
interface ApplicantData {
  nationalId: string
  fullName: string
  dob: Date
  phoneNumber?: string | undefined
}

/**
 * How many times to retry when a generated reference collides. With ~10^9
 * possibilities per commune-year a single collision is already unlikely; two
 * in a row would mean the CSPRNG is broken, which is not worth looping over.
 */
const REFERENCE_ATTEMPTS = 3

export class RegistrationService {
  private readonly db: PrismaClient
  private readonly eligibility: EligibilityService

  constructor(db: PrismaClient = defaultPrisma, eligibility: EligibilityService = eligibilityService) {
    this.db = db
    this.eligibility = eligibility
  }

  /**
   * Registers one application for the server's current draw year.
   *
   * Registration decides two things and delegates the rest: whether intake is
   * running at all, and what the year is. Whether this particular application
   * may take part is EligibilityService's question — the rules live there, in
   * one place, so re-evaluating a stored application later cannot reach a
   * different conclusion than registration did.
   */
  async register(input: CreateApplicationInput): Promise<ApplicationReceiptDto> {
    const window = currentRegistrationWindow()
    if (!window.isOpen) {
      throw new ApiError(503, 'REGISTRATION_CLOSED', 'Registration is not currently open')
    }

    const commune = await this.loadCommune(input.communeId)

    const primary: ApplicantData = { ...input.primary }
    const secondary: ApplicantData | undefined = input.secondary && { ...input.secondary }

    const { application, commune: confirmed } = await this.createApplication(
      window.drawYear,
      input.wilayaId,
      commune,
      primary,
      secondary,
    )

    return toReceipt(application, confirmed, confirmed.wilaya)
  }

  /**
   * Loads the claimed commune, without judging it.
   *
   * Whether it is usable — active, in an active wilaya, and in the wilaya the
   * form claimed — is an eligibility rule, so it is decided there rather than
   * here. A commune id matching nothing yields null, which the rules read as
   * INVALID_COMMUNE exactly as a mismatched wilaya does; a caller cannot tell
   * the two apart and so cannot map commune ids to wilayas by probing.
   */
  private async loadCommune(communeId: string): Promise<(Commune & { wilaya: Wilaya }) | null> {
    return this.db.commune.findUnique({
      where: { id: communeId },
      include: { wilaya: true },
    })
  }

  /**
   * Creates the application and everything it depends on in one transaction,
   * retrying only when the citizen-facing reference collides.
   *
   * Participants are created inside the transaction too, so a refused
   * application never leaves a half-registered citizen behind. A participant
   * that already existed is reused untouched.
   */
  private async createApplication(
    drawYear: number,
    claimedWilayaId: string,
    commune: (Commune & { wilaya: Wilaya }) | null,
    primary: ApplicantData,
    secondary: ApplicantData | undefined,
  ): Promise<{ application: Application; commune: Commune & { wilaya: Wilaya } }> {
    for (let attempt = 1; attempt <= REFERENCE_ATTEMPTS; attempt += 1) {
      try {
        return await this.db.$transaction(async (tx) => {
          const primaryParticipant = await findOrCreateParticipant(tx, primary)
          const secondaryParticipant = secondary ? await findOrCreateParticipant(tx, secondary) : undefined

          const verdict = await this.eligibility.evaluateProposedApplication(tx, {
            drawYear,
            expectedDrawYear: drawYear,
            entryType: secondaryParticipant ? EntryType.PAIRED : EntryType.SINGLE,
            commune,
            claimedWilayaId,
            primary: primaryParticipant,
            secondary: secondaryParticipant,
          })

          if (!verdict.eligible) throw registrationErrorFor(verdict)

          // Unreachable: a null commune is an INVALID_COMMUNE reason, so the
          // verdict above would not have been eligible. Present so the
          // narrowing is the compiler's conclusion rather than a comment's.
          if (!commune)
            throw new BadRequestError('INVALID_COMMUNE', 'Select a commune from the chosen wilaya')

          const reference = generateApplicationReference(drawYear, commune.nameFr)

          const application = await tx.application.create({
            data: {
              applicationReference: reference,
              drawYear,
              communeId: commune.id,
              entryType: secondaryParticipant ? EntryType.PAIRED : EntryType.SINGLE,
              // The verdict this application was admitted on, written in the
              // same transaction that created it. Nothing is ever stored as
              // PENDING by this route: an unevaluated application would be a
              // state no code here can produce.
              status: verdict.status,
              primaryParticipantId: primaryParticipant.id,
              secondaryParticipantId: secondaryParticipant?.id ?? null,
              // Written in the same transaction as the application: these
              // rows are what make "one application per person per year" a
              // database guarantee rather than a hopeful check.
              //
              // `drawYear` is absent on purpose — it is part of the composite
              // foreign key back to the application, so Prisma fills it from
              // the parent and it cannot disagree with it.
              participants: {
                create: [
                  { participantId: primaryParticipant.id, role: ApplicationRole.PRIMARY },
                  ...(secondaryParticipant
                    ? [
                        {
                          participantId: secondaryParticipant.id,
                          role: ApplicationRole.SECONDARY,
                        },
                      ]
                    : []),
                ],
              },
            },
          })

          return { application, commune }
        })
      } catch (error) {
        if (isReferenceCollision(error) && attempt < REFERENCE_ATTEMPTS) continue
        throw translateRegistrationError(error)
      }
    }

    // Unreachable: the loop either returns or throws.
    throw new ApiError(500, 'INTERNAL_ERROR', 'Could not allocate an application reference')
  }
}

/**
 * Reuses an existing participant untouched, or creates one.
 *
 * An existing record is never modified — not the name, not the date of birth,
 * not the phone number. Two reasons. Overwriting identity from an unauthenticated
 * public form would let anyone who knows a national ID rewrite that person's
 * details or attach their own phone to them. And *reporting* a mismatch would
 * turn this endpoint into an oracle for which national IDs are registered.
 * Correcting a genuine mistake is an administrative workflow, deferred.
 */
async function findOrCreateParticipant(
  tx: Prisma.TransactionClient,
  applicant: ApplicantData,
): Promise<Participant> {
  const existing = await tx.participant.findUnique({
    where: { nationalId: applicant.nationalId },
  })
  if (existing) return existing

  return tx.participant.create({
    data: {
      nationalId: applicant.nationalId,
      fullName: applicant.fullName,
      dob: applicant.dob,
      phoneNumber: applicant.phoneNumber ?? null,
      // hasWonHajj and phoneVerifiedAt keep their defaults. Neither is
      // settable from a public form.
    },
  })
}

function uniqueTarget(error: unknown): string[] | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return undefined
  }
  const target = error.meta?.target
  return Array.isArray(target) ? (target as string[]) : typeof target === 'string' ? [target] : []
}

function isReferenceCollision(error: unknown): boolean {
  return uniqueTarget(error)?.some((column) => column.includes('application_reference')) ?? false
}

/**
 * Turns a database constraint violation into the message a citizen should
 * see. Losing a concurrent race and submitting a knowing duplicate arrive
 * here identically, which is correct: both mean the person already has an
 * application this year.
 */
function translateRegistrationError(error: unknown): unknown {
  if (error instanceof ApiError) return error

  const target = uniqueTarget(error)
  if (target) {
    // Any of the three uniqueness guarantees — the two on applications and
    // the participation primary key — mean the same thing to the applicant.
    return new ConflictError(
      'ALREADY_APPLIED',
      'An application already exists for this draw year for one of the applicants',
    )
  }

  return error
}

function toReceipt(application: Application, commune: Commune, wilaya: Wilaya): ApplicationReceiptDto {
  return {
    applicationReference: application.applicationReference,
    drawYear: application.drawYear,
    entryType: application.entryType,
    status: application.status,
    applicantCount: application.secondaryParticipantId ? 2 : 1,
    commune: {
      code: commune.code,
      nameAr: commune.nameAr,
      nameFr: commune.nameFr,
      nameEn: commune.nameEn,
    },
    wilaya: {
      code: wilaya.code,
      nameAr: wilaya.nameAr,
      nameFr: wilaya.nameFr,
      nameEn: wilaya.nameEn,
    },
    submittedAt: application.createdAt.toISOString(),
  }
}

export const registrationService = new RegistrationService()
