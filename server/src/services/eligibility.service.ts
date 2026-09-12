import type { EligibilityResult } from '@hajj-lottery/shared'
import type { Application, Commune, Participant, Prisma, PrismaClient, Wilaya } from '@prisma/client'

import { evaluateEligibility, type ApplicantState, type CommuneState } from '../lib/eligibility-rules.js'
import { prisma as defaultPrisma } from '../lib/prisma.js'

/**
 * The authoritative answer to "may this application take part?".
 *
 * Two responsibilities only: gather the state a verdict depends on, and hand
 * it to the rules. It deliberately does not calculate weight, rank anybody, or
 * select winners — those are later, separate operations, and mixing them here
 * would make eligibility depend on data it has no business reading.
 *
 * Evaluation never writes. Persisting a verdict is `applyEligibilityResult`,
 * called explicitly by a caller that means to change the record, so no
 * innocuous-looking read can quietly mutate an application.
 */
export class EligibilityService {
  private readonly db: PrismaClient

  constructor(db: PrismaClient = defaultPrisma) {
    this.db = db
  }

  /**
   * Evaluates a stored application. Returns null when there is no such
   * application — the caller decides what that means, since an administrator
   * asking about someone else's territory must not be able to tell "does not
   * exist" from "not yours".
   *
   * The stored record's year is a fact rather than a claim, so it is not
   * checked against the currently open draw year: a 2027 application does not
   * become ineligible in 2028.
   */
  async evaluateApplication(applicationId: string, client: Prisma.TransactionClient = this.db) {
    const application = await client.application.findUnique({
      where: { id: applicationId },
      include: {
        commune: { include: { wilaya: true } },
        primaryParticipant: true,
        secondaryParticipant: true,
      },
    })
    if (!application) return null

    const participation = await this.participationByParticipant(
      client,
      application.drawYear,
      participantIds(application.primaryParticipant, application.secondaryParticipant),
    )

    return evaluateEligibility({
      applicationId: application.id,
      drawYear: application.drawYear,
      expectedDrawYear: null,
      entryType: application.entryType,
      commune: communeState(application.commune),
      claimedWilayaId: null,
      primary: applicantState(application.primaryParticipant, participation),
      secondary: applicantState(application.secondaryParticipant, participation),
      registrationDate: application.createdAt,
    })
  }

  /**
   * Evaluates an application that does not exist yet, during registration.
   *
   * Runs inside the caller's transaction so it sees the participants that
   * transaction just created. Its duplicate check can still lose a race with a
   * concurrent submission; that is expected and harmless, because the database
   * constraint — not this verdict — is what guarantees one application per
   * person per year.
   */
  async evaluateProposedApplication(
    client: Prisma.TransactionClient,
    proposal: {
      drawYear: number
      expectedDrawYear: number
      entryType: 'SINGLE' | 'PAIRED'
      commune: (Commune & { wilaya: Wilaya }) | null
      claimedWilayaId: string
      primary: Participant
      secondary?: Participant | undefined
      registrationDate: Date
    },
  ): Promise<EligibilityResult> {
    const participation = await this.participationByParticipant(
      client,
      proposal.drawYear,
      participantIds(proposal.primary, proposal.secondary ?? null),
    )

    return evaluateEligibility({
      applicationId: null,
      drawYear: proposal.drawYear,
      expectedDrawYear: proposal.expectedDrawYear,
      entryType: proposal.entryType,
      commune: communeState(proposal.commune),
      claimedWilayaId: proposal.claimedWilayaId,
      primary: applicantState(proposal.primary, participation),
      secondary: applicantState(proposal.secondary ?? null, participation),
      registrationDate: proposal.registrationDate,
    })
  }

  /**
   * Writes a verdict onto an application. The only way a status changes.
   *
   * Separate from evaluation on purpose: a caller that wants to look must say
   * so, and a caller that wants to change the record must say that instead.
   * Nothing else about the application is touched — not the weight, which no
   * step calculates yet, and certainly not participant identity.
   */
  async applyEligibilityResult(
    applicationId: string,
    result: EligibilityResult,
    client: Prisma.TransactionClient = this.db,
  ): Promise<Application> {
    return client.application.update({
      where: { id: applicationId },
      data: { status: result.status },
    })
  }

  /**
   * Which applications each of these participants already occupies in the draw
   * year, in one query rather than one per person.
   *
   * Reads `application_participants` rather than `applications` because that
   * is the table where both roles are visible at once — someone's primary slot
   * and someone else's secondary slot are the same kind of row there.
   */
  private async participationByParticipant(
    client: Prisma.TransactionClient,
    drawYear: number,
    participantIdList: string[],
  ): Promise<Map<string, string[]>> {
    const byParticipant = new Map<string, string[]>()
    if (participantIdList.length === 0) return byParticipant

    const rows = await client.applicationParticipant.findMany({
      where: { drawYear, participantId: { in: participantIdList } },
      select: { participantId: true, applicationId: true },
    })

    for (const row of rows) {
      const existing = byParticipant.get(row.participantId)
      if (existing) existing.push(row.applicationId)
      else byParticipant.set(row.participantId, [row.applicationId])
    }

    return byParticipant
  }
}

function participantIds(...participants: (Participant | null | undefined)[]): string[] {
  return participants
    .filter((participant) => participant !== null && participant !== undefined)
    .map((p) => p.id)
}

function applicantState(
  participant: Participant | null | undefined,
  participation: Map<string, string[]>,
): ApplicantState | null {
  if (!participant) return null

  return {
    participantId: participant.id,
    hasWonHajj: participant.hasWonHajj,
    dob: participant.dob,
    gender: participant.gender,
    applicationIdsThisYear: participation.get(participant.id) ?? [],
  }
}

function communeState(commune: (Commune & { wilaya: Wilaya }) | null): CommuneState | null {
  if (!commune) return null

  return {
    id: commune.id,
    wilayaId: commune.wilayaId,
    isActive: commune.isActive,
    wilayaIsActive: commune.wilaya.isActive,
  }
}

export const eligibilityService = new EligibilityService()
