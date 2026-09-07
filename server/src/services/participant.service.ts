import type { ParticipantDto } from '@hajj-lottery/shared'
import { Prisma, type Participant, type PrismaClient } from '@prisma/client'

import { ConflictError, NotFoundError } from '../lib/errors.js'
import { isValidNationalId, normalizeNationalId } from '../lib/national-id.js'
import { prisma as defaultPrisma } from '../lib/prisma.js'

export interface CreateParticipantData {
  /** Canonical national ID — already normalized by the validation schema. */
  nationalId: string
  fullName: string
  dob: Date
}

/**
 * Owns participant identity: one record per national ID, for the whole
 * system. Controllers, the seed and future import/registration flows all go
 * through this service rather than touching `prisma.participant` directly,
 * so normalization and duplicate handling exist in exactly one place.
 */
export class ParticipantService {
  private readonly db: PrismaClient

  constructor(db: PrismaClient = defaultPrisma) {
    this.db = db
  }

  /**
   * Looks a participant up by national ID in any typed form. Returns null
   * rather than throwing when the ID is unusable, since callers of a lookup
   * treat "not a valid ID" and "no such person" the same way.
   */
  async findByNationalId(rawNationalId: string): Promise<Participant | null> {
    const nationalId = normalizeNationalId(rawNationalId)
    if (!isValidNationalId(nationalId)) return null

    return this.db.participant.findUnique({ where: { nationalId } })
  }

  async findById(id: string): Promise<Participant | null> {
    return this.db.participant.findUnique({ where: { id } })
  }

  /** Same as `findById`, but throws the API's 404 when absent. */
  async getById(id: string): Promise<Participant> {
    const participant = await this.findById(id)
    if (!participant) {
      throw new NotFoundError('PARTICIPANT_NOT_FOUND', 'Participant not found')
    }
    return participant
  }

  /**
   * Creates a new identity record. Throws `ConflictError` if the national ID
   * is already registered — including when a concurrent request wins the
   * race, which surfaces as Prisma's P2002 rather than a failed pre-check.
   */
  async create(data: CreateParticipantData): Promise<Participant> {
    try {
      return await this.db.participant.create({ data })
    } catch (error) {
      if (isUniqueNationalIdViolation(error)) {
        throw new ConflictError('DUPLICATE_NATIONAL_ID', 'A participant with this national ID already exists')
      }
      throw error
    }
  }

  /**
   * The identity lookup future registration flows need: reuse the person if
   * they are already known, otherwise register them. Never produces a second
   * record for the same national ID, even under concurrent calls.
   */
  async findOrCreate(data: CreateParticipantData): Promise<{ participant: Participant; created: boolean }> {
    const existing = await this.db.participant.findUnique({
      where: { nationalId: data.nationalId },
    })
    if (existing) return { participant: existing, created: false }

    try {
      return { participant: await this.db.participant.create({ data }), created: true }
    } catch (error) {
      if (isUniqueNationalIdViolation(error)) {
        // Lost the race — the winner's record is the identity for this person.
        const winner = await this.db.participant.findUnique({
          where: { nationalId: data.nationalId },
        })
        if (winner) return { participant: winner, created: false }
      }
      throw error
    }
  }
}

function isUniqueNationalIdViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

/** Serializes a participant for the API, with dates as plain ISO strings. */
export function toParticipantDto(participant: Participant): ParticipantDto {
  return {
    id: participant.id,
    nationalId: participant.nationalId,
    fullName: participant.fullName,
    dob: participant.dob.toISOString().slice(0, 10),
    hasWonHajj: participant.hasWonHajj,
    createdAt: participant.createdAt.toISOString(),
    updatedAt: participant.updatedAt.toISOString(),
  }
}

/** Shared instance used by the HTTP layer. */
export const participantService = new ParticipantService()
