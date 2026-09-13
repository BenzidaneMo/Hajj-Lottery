import type { ImportBatchStatus, ImportColumn, ImportExecutionDto } from '@hajj-lottery/shared'
import { Prisma, type ImportBatch, type ImportRow, type PrismaClient, type User } from '@prisma/client'

import { normalizeAuditReason } from '../lib/audit-payload.js'
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../lib/errors.js'
import { readImportFile, type UploadedImportFile } from '../lib/import-file.js'
import { canTransitionBatch } from '../lib/import-lifecycle.js'
import { mapHeaders, toRawRows } from '../lib/import-template.js'
import {
  detectDatabaseConflicts,
  detectFileConflicts,
  isAlreadyRecorded,
  normalizeCommuneCode,
  resolveRowStatus,
  stageRow,
  type ImportIssue,
  type KnownHistoryYear,
  type KnownParticipant,
  type StagedRow,
  type StagingContext,
} from '../lib/import-validation.js'
import { prisma as defaultPrisma } from '../lib/prisma.js'
import { resolveScope } from '../lib/scope.js'
import { auditService, AuditService, type AuditActor, type AuditScope } from './audit.service.js'
import { drawConfigurationService, DrawConfigurationService } from './draw-configuration.service.js'

/** A batch with the administrators needed to present it. */
export type ImportBatchWithUsers = ImportBatch & {
  uploadedBy: Pick<User, 'id' | 'username'>
  approvedBy: Pick<User, 'id' | 'username'> | null
}

const BATCH_INCLUDE = {
  uploadedBy: { select: { id: true, username: true } },
  approvedBy: { select: { id: true, username: true } },
} as const

/**
 * Rows are written and read in chunks rather than all at once.
 *
 * A national register is tens of thousands of lines. One statement per row would
 * be tens of thousands of round trips inside a transaction holding locks; one
 * statement for all of them would be a query larger than the server will parse.
 * A thousand at a time is neither.
 */
const CHUNK = 1000

/** The disposition of one staged row when the batch is finally imported. */
type RowPlan =
  | { kind: 'write'; row: ImportRow }
  /** Already in the ledger, identically, or a duplicate of a row already kept. */
  | { kind: 'skip'; row: ImportRow }

/**
 * The legacy historical import.
 *
 * Everything before this platform existed is on paper, and that paper is the only
 * evidence of who has been waiting how long. The weighting engine turns those
 * years into priority and the winner records turn them into lifetime exclusion,
 * so an import is not a data-loading convenience: it is the single largest
 * unilateral change anybody can make to who wins future lotteries.
 *
 * The shape of the answer is staging plus separation of duties.
 *
 * **Nothing authoritative moves before the end.** An upload creates a batch and a
 * pile of staged rows and touches no participant, no historical record and
 * nobody's winner status. Those rows are checked against the file and against the
 * database, an administrator reads the conflicts, a *different* national
 * administrator approves, and only then does one transaction write everything.
 *
 * **Nothing is silently repaired.** A name that disagrees with the registry, a
 * year that disagrees with the ledger, a win that disagrees with a lifetime
 * exclusion — each is reported and blocks the batch. Choosing between two
 * accounts of a person's history is a decision with consequences for that person,
 * and it belongs to a human who can look at the register.
 *
 * **The file is never the source of truth about a person.** An existing
 * participant is reused exactly as they are: no name, date of birth or phone
 * number is ever overwritten from an uploaded spreadsheet, and no
 * `has_won_hajj` is ever cleared by one.
 */
export class LegacyImportService {
  private readonly db: PrismaClient
  private readonly audit: AuditService
  private readonly configuration: DrawConfigurationService

  constructor(
    db: PrismaClient = defaultPrisma,
    audit: AuditService = auditService,
    configuration: DrawConfigurationService = drawConfigurationService,
  ) {
    this.db = db
    this.audit = audit
    this.configuration = configuration
  }

  // --- Upload and staging -------------------------------------------------

  /**
   * Accepts a register, stages it, and checks it.
   *
   * Deliberately *not* one transaction. Creating the batch commits first so that
   * a file which then fails to stage leaves a record of having been uploaded
   * rather than vanishing; and VALIDATING is a state an administrator can
   * genuinely observe, including the case where a process died halfway through a
   * large file and left a batch that needs attention.
   */
  async upload(user: User, actor: AuditActor, file: UploadedImportFile): Promise<ImportBatchWithUsers> {
    const source = await readImportFile(file)

    // The checksum answers "have we seen these exact bytes?" and nothing more.
    // It is not a security control and it does not prove the *contents* are new —
    // row-level duplicate detection still runs on every import, because two
    // different files can carry the same rows.
    const existing = await this.db.importBatch.findUnique({
      where: { sourceChecksum: source.checksum },
      select: { id: true, status: true },
    })
    if (existing) {
      throw new ConflictError(
        'DUPLICATE_IMPORT_SOURCE',
        `Identical source file already processed as import ${existing.id} (${existing.status}). Review that batch instead.`,
      )
    }

    const mapping = mapHeaders(source.header)
    if (mapping.missing.length > 0) {
      throw new BadRequestError(
        'INVALID_IMPORT_TEMPLATE',
        `The file is missing required columns: ${mapping.missing.join(', ')}`,
        { missing: mapping.missing, ignored: mapping.ignored },
      )
    }

    const batch = await this.db.$transaction(async (tx) => {
      const created = await tx.importBatch.create({
        data: {
          sourceFilename: file.filename.slice(0, 255),
          sourceFormat: source.format,
          sourceChecksum: source.checksum,
          status: 'UPLOADED',
          uploadedByUserId: user.id,
        },
        include: BATCH_INCLUDE,
      })

      await this.audit.record(
        {
          action: 'LEGACY_IMPORT_CREATED',
          actor,
          targetType: 'IMPORT_BATCH',
          targetId: created.id,
          scope: uploaderScope(user),
          metadata: {
            sourceFormat: source.format,
            sourceChecksum: source.checksum,
            sourceFilename: created.sourceFilename,
          },
        },
        tx,
      )

      return created
    })

    try {
      await this.transition(batch.id, 'UPLOADED', 'VALIDATING')
      return await this.stage(batch, user, source.matrix, mapping)
    } catch (error) {
      // A file that cannot be staged is a dead batch, not a retryable one: its
      // checksum is taken, and the administrator's next move is a corrected file.
      await this.fail(batch.id, error)
      throw error
    }
  }

  /**
   * Converts, checks and writes the staged rows.
   *
   * Three passes, in this order and for this reason: each row is checked on its
   * own first, then against the rest of the file, then against the database.
   * Later passes need the earlier ones to have normalized the national IDs — a
   * register written in Arabic-Indic digits must collide with the same person
   * written in ASCII, both within the file and against the registry.
   */
  private async stage(
    batch: ImportBatch,
    user: User,
    matrix: readonly (readonly string[])[],
    mapping: ReturnType<typeof mapHeaders>,
  ): Promise<ImportBatchWithUsers> {
    const raw = toRawRows(matrix, mapping)
    if (raw.length === 0) {
      throw new BadRequestError('MALFORMED_IMPORT_FILE', 'The file has a header but no rows')
    }

    const context = await this.stagingContext(user, mapping)
    const rows = raw.map((line) => stageRow(line, context))

    detectFileConflicts(rows)

    const known = await this.knownParticipants(
      this.db,
      rows.map((row) => row.values.nationalId).filter((id): id is string => id !== null),
    )
    detectDatabaseConflicts(rows, known)

    for (let index = 0; index < rows.length; index += CHUNK) {
      await this.db.importRow.createMany({
        data: rows.slice(index, index + CHUNK).map((row) => ({
          importBatchId: batch.id,
          rowNumber: row.rowNumber,
          nationalId: row.values.nationalId,
          firstNameAr: row.values.firstNameAr,
          lastNameAr: row.values.lastNameAr,
          firstNameLatin: row.values.firstNameLatin,
          lastNameLatin: row.values.lastNameLatin,
          dob: row.values.dob,
          phoneNumber: row.values.phoneNumber,
          communeCode: row.values.communeCode,
          communeId: row.values.communeId,
          drawYear: row.values.drawYear,
          participated: row.values.participated,
          won: row.values.won,
          notes: row.values.notes,
          gender: row.values.gender,
          status: resolveRowStatus(row.issues),
          issues: row.issues as unknown as Prisma.InputJsonValue,
        })),
      })
    }

    // The span is derived from what the file turned out to contain, not declared
    // by whoever uploaded it.
    const years = rows.map((row) => row.values.drawYear).filter((year): year is number => year !== null)

    await this.db.importBatch.update({
      where: { id: batch.id },
      data: {
        status: 'READY_FOR_REVIEW',
        drawYearStart: years.length > 0 ? Math.min(...years) : null,
        drawYearEnd: years.length > 0 ? Math.max(...years) : null,
      },
    })

    return this.getById(batch.id)
  }

  /**
   * What the checks are allowed to know.
   *
   * `allowedCommuneIds` is where a scoped administrator's reach becomes a
   * property of the *file*: a COMMUNE_ADMIN may prepare their own commune's
   * register, and a row naming anywhere else is refused rather than silently
   * dropped, so the reviewer sees that the file overreached.
   */
  private async stagingContext(user: User, mapping: ReturnType<typeof mapHeaders>): Promise<StagingContext> {
    const communes = await this.db.commune.findMany({ select: { id: true, code: true, wilayaId: true } })
    const communeIdByCode = new Map(
      communes.map((commune) => [normalizeCommuneCode(commune.code), commune.id]),
    )

    const scope = resolveScope(user)
    const allowedCommuneIds =
      scope.kind === 'national'
        ? null
        : new Set(
            communes
              .filter((commune) =>
                scope.kind === 'wilaya'
                  ? commune.wilayaId === scope.wilayaId
                  : commune.id === scope.communeId,
              )
              .map((commune) => commune.id),
          )

    return {
      communeIdByCode,
      referenceDrawYear: await this.configuration.referenceDrawYear(),
      allowedCommuneIds,
      presentColumns: new Set(
        (Object.keys(mapping.columns) as ImportColumn[]).filter(
          (column) => mapping.columns[column] !== undefined,
        ),
      ),
    }
  }

  /**
   * Everything the database already knows about the people a file names.
   *
   * Queried for the file rather than loaded wholesale, and in chunks, because a
   * national register names tens of thousands of people and `IN (...)` has limits
   * that a 12,000-element list finds.
   */
  private async knownParticipants(
    db: Pick<PrismaClient, 'participant' | 'participationHistory' | 'winnerArchive' | 'legacyWinner'>,
    nationalIds: readonly string[],
  ): Promise<Map<string, KnownParticipant>> {
    const unique = [...new Set(nationalIds)]
    const known = new Map<string, KnownParticipant>()
    // The rules read a ReadonlyMap; building one needs the mutable original.
    const byId = new Map<
      string,
      Omit<KnownParticipant, 'history'> & { history: Map<number, KnownHistoryYear> }
    >()

    for (let index = 0; index < unique.length; index += CHUNK) {
      const participants = await db.participant.findMany({
        where: { nationalId: { in: unique.slice(index, index + CHUNK) } },
        select: {
          id: true,
          nationalId: true,
          firstNameAr: true,
          lastNameAr: true,
          firstNameLatin: true,
          lastNameLatin: true,
          dob: true,
          phoneNumber: true,
          hasWonHajj: true,
        },
      })

      for (const participant of participants) {
        const entry = {
          id: participant.id,
          firstNameAr: participant.firstNameAr,
          lastNameAr: participant.lastNameAr,
          firstNameLatin: participant.firstNameLatin,
          lastNameLatin: participant.lastNameLatin,
          dob: participant.dob,
          phoneNumber: participant.phoneNumber,
          hasWonHajj: participant.hasWonHajj,
          winningYear: null as number | null,
          history: new Map<number, KnownHistoryYear>(),
        }
        known.set(participant.nationalId, entry)
        byId.set(participant.id, entry)
      }
    }

    const ids = [...byId.keys()]

    for (let index = 0; index < ids.length; index += CHUNK) {
      const slice = ids.slice(index, index + CHUNK)

      const [history, archived, legacy] = await Promise.all([
        db.participationHistory.findMany({
          where: { participantId: { in: slice } },
          select: { participantId: true, drawYear: true, participated: true, won: true, communeId: true },
        }),
        db.winnerArchive.findMany({
          where: { participantId: { in: slice } },
          select: { participantId: true, drawYear: true },
        }),
        db.legacyWinner.findMany({
          where: { participantId: { in: slice } },
          select: { participantId: true, drawYear: true },
        }),
      ])

      for (const record of history) {
        const entry = byId.get(record.participantId)
        if (!entry) continue
        entry.history.set(record.drawYear, {
          participated: record.participated,
          won: record.won,
          communeId: record.communeId,
        })
        // A ledger row saying they won names the year even when no winner record
        // does — a correction, or a previous import.
        if (record.won) entry.winningYear = maxYear(entry.winningYear, record.drawYear)
      }

      // Either provenance names the year authoritatively; both are consulted
      // because a person may have won before this platform existed or after.
      for (const record of [...archived, ...legacy]) {
        const entry = byId.get(record.participantId)
        if (entry) entry.winningYear = maxYear(entry.winningYear, record.drawYear)
      }
    }

    return known
  }

  // --- Review -------------------------------------------------------------

  /** One batch, unscoped. Administrators reach batches through AuthorizationService. */
  async findById(id: string): Promise<ImportBatchWithUsers | null> {
    return this.db.importBatch.findUnique({ where: { id }, include: BATCH_INCLUDE })
  }

  private async getById(id: string): Promise<ImportBatchWithUsers> {
    const batch = await this.findById(id)
    if (!batch) throw new NotFoundError('IMPORT_BATCH_NOT_FOUND', 'Import batch not found')
    return batch
  }

  /**
   * What a batch would do, counted over the rows the caller may see.
   *
   * Computed per request rather than stored, and that is the point: the counts
   * are *scoped*. A COMMUNE_ADMIN reviewing a national register is told what it
   * does to their commune and learns nothing about the size of anybody else's
   * import. A stored summary would be one set of numbers for everybody, which
   * would either leak or be useless.
   */
  async summarize(
    batchId: string,
    scope: Prisma.ImportRowWhereInput,
  ): Promise<{
    rows: number
    valid: number
    warnings: number
    conflicts: number
    invalid: number
    newParticipants: number
    existingParticipants: number
    historicalRecords: number
    winners: number
    importable: boolean
  }> {
    const where: Prisma.ImportRowWhereInput = { importBatchId: batchId, ...scope }

    const grouped = await this.db.importRow.groupBy({ by: ['status'], where, _count: { _all: true } })
    const count = (status: string) => grouped.find((group) => group.status === status)?._count._all ?? 0

    const usable = await this.db.importRow.findMany({
      where: { ...where, status: { in: ['VALID', 'WARNING'] } },
      select: { nationalId: true, won: true, issues: true },
    })

    // What the import would actually write: rows that are neither already in the
    // ledger nor a duplicate of a row that will be kept.
    const writable = usable.filter((row) => {
      const issues = storedIssues(row)
      return !issues.some(
        (found) => found.code === 'ALREADY_RECORDED' || found.code === 'DUPLICATE_ROW_IN_FILE',
      )
    })

    const nationalIds = [
      ...new Set(writable.map((row) => row.nationalId).filter((id): id is string => id !== null)),
    ]
    let existingParticipants = 0

    for (let index = 0; index < nationalIds.length; index += CHUNK) {
      existingParticipants += await this.db.participant.count({
        where: { nationalId: { in: nationalIds.slice(index, index + CHUNK) } },
      })
    }

    return {
      rows: grouped.reduce((total, group) => total + group._count._all, 0),
      valid: count('VALID'),
      warnings: count('WARNING'),
      conflicts: count('CONFLICT'),
      invalid: count('INVALID'),
      newParticipants: nationalIds.length - existingParticipants,
      existingParticipants,
      historicalRecords: writable.length,
      winners: writable.filter((row) => row.won === true).length,
      importable: count('CONFLICT') === 0 && count('INVALID') === 0,
    }
  }

  /**
   * Accepts a batch — and still writes nothing authoritative.
   *
   * Approval and execution are separate because they answer different questions:
   * "is this register trustworthy?" and "write it now". Collapsing them would
   * mean a reviewer's judgement and a long transaction over tens of thousands of
   * rows share a fate, so a lock timeout would look like a rejection.
   */
  async approve(
    actor: AuditActor,
    uploader: User,
    batchId: string,
    reason: string,
  ): Promise<ImportBatchWithUsers> {
    const justification = normalizeAuditReason('LEGACY_IMPORT_APPROVED', reason)
    const batch = await this.getById(batchId)

    this.assertNotUploader(actor, batch)
    this.assertState(batch, 'APPROVED')

    return this.decide(batch, uploader, {
      status: 'APPROVED',
      approvedByUserId: actor.id,
      reviewReason: justification,
      action: 'LEGACY_IMPORT_APPROVED',
      actor,
    })
  }

  /** Refuses a batch, permanently. A corrected register is a new upload. */
  async reject(
    actor: AuditActor,
    uploader: User,
    batchId: string,
    reason: string,
  ): Promise<ImportBatchWithUsers> {
    const justification = normalizeAuditReason('LEGACY_IMPORT_REJECTED', reason)
    const batch = await this.getById(batchId)

    this.assertNotUploader(actor, batch)
    this.assertState(batch, 'REJECTED')

    return this.decide(batch, uploader, {
      status: 'REJECTED',
      approvedByUserId: null,
      reviewReason: justification,
      action: 'LEGACY_IMPORT_REJECTED',
      actor,
    })
  }

  private async decide(
    batch: ImportBatchWithUsers,
    uploader: User,
    decision: {
      status: Extract<ImportBatchStatus, 'APPROVED' | 'REJECTED'>
      approvedByUserId: string | null
      reviewReason: string | null
      action: 'LEGACY_IMPORT_APPROVED' | 'LEGACY_IMPORT_REJECTED'
      actor: AuditActor
    },
  ): Promise<ImportBatchWithUsers> {
    return this.db.$transaction(async (tx) => {
      // Conditional, like every other decision in this system: two reviewers
      // arriving together serialize on the row and the second matches nothing
      // rather than overwriting the first's judgement.
      const claimed = await tx.importBatch.updateMany({
        where: { id: batch.id, status: 'READY_FOR_REVIEW' },
        data: {
          status: decision.status,
          approvedByUserId: decision.approvedByUserId,
          reviewReason: decision.reviewReason,
          reviewedAt: new Date(),
        },
      })

      if (claimed.count !== 1) {
        throw new ConflictError('IMPORT_NOT_IN_STATE', 'This import has already been reviewed')
      }

      const counts = await this.counts(tx, batch.id)

      await this.audit.record(
        {
          action: decision.action,
          actor: decision.actor,
          targetType: 'IMPORT_BATCH',
          targetId: batch.id,
          scope: uploaderScope(uploader),
          reason: decision.reviewReason,
          metadata: {
            sourceChecksum: batch.sourceChecksum,
            drawYearStart: batch.drawYearStart,
            drawYearEnd: batch.drawYearEnd,
            ...counts,
          },
        },
        tx,
      )

      const decided = await tx.importBatch.findUnique({ where: { id: batch.id }, include: BATCH_INCLUDE })
      if (!decided) throw new NotFoundError('IMPORT_BATCH_NOT_FOUND', 'Import batch not found')
      return decided
    })
  }

  // --- The import itself --------------------------------------------------

  /**
   * Writes an approved batch, all of it or none of it.
   *
   * One transaction: claim, re-check, participants, ledger, legacy winners,
   * lifetime exclusion, provenance, audit. Any failure unwinds every part of it
   * including the claim, leaving the batch APPROVED and retryable — because the
   * alternative, a batch half-imported, would mean some people have their waiting
   * years and others do not, with no way to tell which from the outside.
   *
   * The claim is the concurrency guard, and it is a conditional update rather
   * than a lock held in this process: two executions arriving together serialize
   * on the row, and the loser writes nothing. Production may run many instances,
   * and an in-memory guard would protect exactly one of them.
   *
   * Everything is re-checked here even though it was checked at staging. Time
   * passed in between — a real draw may have concluded and made somebody a
   * winner, another batch may have written the same year — and the check that
   * matters is the one made against the state being written into.
   */
  async execute(actor: AuditActor, uploader: User, batchId: string): Promise<ImportExecutionDto> {
    return this.db.$transaction(
      async (tx) => {
        const batch = await tx.importBatch.findUnique({ where: { id: batchId } })
        if (!batch) throw new NotFoundError('IMPORT_BATCH_NOT_FOUND', 'Import batch not found')

        const importedAt = new Date()
        const claimed = await tx.importBatch.updateMany({
          where: { id: batchId, status: 'APPROVED' },
          data: { status: 'IMPORTED', importedAt },
        })

        if (claimed.count !== 1) {
          throw new ConflictError(
            'IMPORT_NOT_IN_STATE',
            batch.status === 'IMPORTED'
              ? 'This import has already been completed'
              : `An approved import is required, and this one is ${batch.status}`,
          )
        }

        const rows = await tx.importRow.findMany({
          where: { importBatchId: batchId },
          orderBy: { rowNumber: 'asc' },
        })

        const plan = await this.plan(tx, rows)
        const writable = plan.filter(
          (entry): entry is { kind: 'write'; row: ImportRow } => entry.kind === 'write',
        )

        const participants = await this.resolveParticipants(tx, writable)
        const history = await this.writeHistory(tx, writable, participants, batch)
        const winners = await this.writeLegacyWinners(tx, writable, participants, history, batch)

        await this.linkRows(tx, writable, participants, history)

        const counts = {
          participantsCreated: participants.created,
          participantsReused: participants.reused,
          historicalRecordsCreated: history.size,
          rowsAlreadyPresent: plan.length - writable.length,
          legacyWinnersRecorded: winners,
        }

        await this.audit.record(
          {
            action: 'LEGACY_IMPORT_COMPLETED',
            actor,
            targetType: 'IMPORT_BATCH',
            targetId: batchId,
            scope: uploaderScope(uploader),
            metadata: {
              sourceChecksum: batch.sourceChecksum,
              drawYearStart: batch.drawYearStart,
              drawYearEnd: batch.drawYearEnd,
              rows: rows.length,
              ...counts,
            },
          },
          tx,
        )

        await this.assertComplete(tx, batchId, history.size, winners)

        return { batchId, ...counts, importedAt: importedAt.toISOString() }
      },
      // A national register is tens of thousands of rows; the default five
      // seconds is a limit on convenience, not on correctness.
      { maxWait: 15_000, timeout: 180_000 },
    )
  }

  /**
   * What each staged row will do, re-checked against the database as it is now.
   *
   * A stored CONFLICT or INVALID blocks outright — that verdict was reached when
   * a human was looking at it. Everything else is re-run: the registry and the
   * ledger may have moved since approval, and a row that has become a conflict in
   * the meantime must stop the import rather than overwrite what changed.
   */
  private async plan(tx: Prisma.TransactionClient, rows: readonly ImportRow[]): Promise<RowPlan[]> {
    const blocked = rows.filter((row) => row.status === 'CONFLICT' || row.status === 'INVALID')
    if (blocked.length > 0) {
      throw new ConflictError(
        'IMPORT_HAS_CONFLICTS',
        `${blocked.length} row(s) still have unresolved conflicts; this import cannot be completed`,
      )
    }

    const staged: StagedRow[] = rows.map(toStagedRow)
    const known = await this.knownParticipants(
      tx,
      staged.map((row) => row.values.nationalId).filter((id): id is string => id !== null),
    )
    detectDatabaseConflicts(staged, known)

    const plan: RowPlan[] = []

    for (const [index, row] of rows.entries()) {
      const rechecked = staged[index] as StagedRow
      const status = resolveRowStatus(rechecked.issues)

      if (status === 'CONFLICT' || status === 'INVALID') {
        throw new ConflictError(
          'IMPORT_HAS_CONFLICTS',
          `Row ${row.rowNumber} conflicts with data that changed since this import was approved`,
        )
      }

      // Two reasons to write nothing: the ledger already records this year
      // identically, or an identical earlier row in the same file already covers
      // it. Both were warnings at staging, and neither is an error now.
      const duplicate = storedIssues(row).some((found) => found.code === 'DUPLICATE_ROW_IN_FILE')
      const present =
        isAlreadyRecorded(rechecked.issues) || storedIssues(row).some((f) => f.code === 'ALREADY_RECORDED')

      plan.push({ kind: duplicate || present ? 'skip' : 'write', row })
    }

    return plan
  }

  /**
   * Reuses the people already known and registers the rest.
   *
   * An existing participant is reused *untouched*. Their name, date of birth and
   * phone number are whatever the registry says; a spreadsheet somebody uploaded
   * does not get to revise a person's identity, and any disagreement was already
   * raised as a conflict rather than resolved here.
   */
  private async resolveParticipants(
    tx: Prisma.TransactionClient,
    rows: readonly { row: ImportRow }[],
  ): Promise<{ idByNationalId: Map<string, string>; created: number; reused: number }> {
    interface StagedIdentity {
      firstNameAr: string
      lastNameAr: string
      firstNameLatin: string
      lastNameLatin: string
      dob: Date
      phoneNumber: string | null
      gender: 'MALE' | 'FEMALE' | null
    }

    const identities = new Map<string, StagedIdentity>()

    for (const { row } of rows) {
      if (
        !row.nationalId ||
        !row.firstNameAr ||
        !row.lastNameAr ||
        !row.firstNameLatin ||
        !row.lastNameLatin
      ) {
        continue
      }
      if (!row.dob) continue
      if (!identities.has(row.nationalId)) {
        identities.set(row.nationalId, {
          firstNameAr: row.firstNameAr,
          lastNameAr: row.lastNameAr,
          firstNameLatin: row.firstNameLatin,
          lastNameLatin: row.lastNameLatin,
          dob: row.dob,
          phoneNumber: row.phoneNumber,
          gender: row.gender,
        })
      }
    }

    const nationalIds = [...identities.keys()]
    const idByNationalId = new Map<string, string>()

    for (let index = 0; index < nationalIds.length; index += CHUNK) {
      const found = await tx.participant.findMany({
        where: { nationalId: { in: nationalIds.slice(index, index + CHUNK) } },
        select: { id: true, nationalId: true },
      })
      for (const participant of found) idByNationalId.set(participant.nationalId, participant.id)
    }

    const reused = idByNationalId.size
    const missing = nationalIds.filter((nationalId) => !idByNationalId.has(nationalId))

    for (let index = 0; index < missing.length; index += CHUNK) {
      await tx.participant.createMany({
        data: missing.slice(index, index + CHUNK).map((nationalId) => {
          const identity = identities.get(nationalId) as StagedIdentity

          // Gender and phone should already be guaranteed present for any row
          // that reaches here — validation blocks a new-participant row that
          // lacks either (MISSING_GENDER_FOR_NEW_PARTICIPANT /
          // MISSING_PHONE_NUMBER_FOR_NEW_PARTICIPANT) well before execution.
          // Checked again here rather than trusted, because a Participant
          // column being NOT NULL means a bug in that earlier check would
          // otherwise surface as an opaque database error instead of this
          // one, readable message.
          if (identity.gender === null || identity.phoneNumber === null) {
            throw new ConflictError(
              'IMPORT_HAS_CONFLICTS',
              `A new participant (national ID ending ${nationalId.slice(-4)}) is missing a gender or phone number`,
            )
          }

          return {
            nationalId,
            firstNameAr: identity.firstNameAr,
            lastNameAr: identity.lastNameAr,
            firstNameLatin: identity.firstNameLatin,
            lastNameLatin: identity.lastNameLatin,
            dob: identity.dob,
            gender: identity.gender,
            // Recorded because it is contact information the register carried.
            // `phone_verified_at` stays null: nobody verified anything, and a
            // number transcribed from paper is not evidence of a working phone.
            phoneNumber: identity.phoneNumber,
          }
        }),
      })
    }

    for (let index = 0; index < missing.length; index += CHUNK) {
      const created = await tx.participant.findMany({
        where: { nationalId: { in: missing.slice(index, index + CHUNK) } },
        select: { id: true, nationalId: true },
      })
      for (const participant of created) idByNationalId.set(participant.nationalId, participant.id)
    }

    return { idByNationalId, created: missing.length, reused }
  }

  /**
   * Writes the ledger rows, verified.
   *
   * `verified: true` is the documented policy, and it is the resolution of a real
   * tension. The ledger's rule is that unverified history does not count toward a
   * streak, precisely so that an unreviewed pile of legacy rows cannot inflate
   * somebody's priority. But this pile *has* been reviewed: a national
   * administrator who did not upload it read the conflicts and accepted it, which
   * is exactly the act the flag exists to record. Writing it unverified would
   * mean an approved import silently counted for nothing — an approval that
   * approved nothing. See docs/legacy-import.md.
   */
  private async writeHistory(
    tx: Prisma.TransactionClient,
    rows: readonly { row: ImportRow }[],
    participants: { idByNationalId: Map<string, string> },
    batch: ImportBatch,
  ): Promise<Map<string, string>> {
    const data = rows.map(({ row }) => {
      const participantId = participants.idByNationalId.get(row.nationalId as string)
      if (!participantId || !row.communeId || row.drawYear === null || row.participated === null) {
        throw new ConflictError(
          'IMPORT_HAS_CONFLICTS',
          `Row ${row.rowNumber} is missing values required to record a historical fact`,
        )
      }

      return {
        participantId,
        communeId: row.communeId,
        drawYear: row.drawYear,
        participated: row.participated,
        won: row.won ?? false,
        // Never a value the file chose. A register cannot declare itself to be
        // the output of a draw this platform ran.
        source: 'LEGACY_IMPORT' as const,
        verified: true,
        notes: row.notes ?? `Imported from ${batch.sourceFilename} (batch ${batch.id})`,
      }
    })

    for (let index = 0; index < data.length; index += CHUNK) {
      await tx.participationHistory.createMany({ data: data.slice(index, index + CHUNK) })
    }

    // Read back for the ids the provenance records need. Keyed by participant and
    // year, which is the ledger's own unique constraint.
    const wanted = new Set(data.map((record) => `${record.participantId}:${record.drawYear}`))
    const byKey = new Map<string, string>()
    const participantIds = [...new Set(data.map((record) => record.participantId))]
    const years = [...new Set(data.map((record) => record.drawYear))]

    for (let index = 0; index < participantIds.length; index += CHUNK) {
      const written = await tx.participationHistory.findMany({
        where: { participantId: { in: participantIds.slice(index, index + CHUNK) }, drawYear: { in: years } },
        select: { id: true, participantId: true, drawYear: true },
      })
      for (const record of written) {
        const key = `${record.participantId}:${record.drawYear}`
        if (wanted.has(key)) byKey.set(key, record.id)
      }
    }

    return byKey
  }

  /**
   * Records the legacy wins, and spends the entitlement.
   *
   * The `has_won_hajj` update is a compare-and-set on `hasWonHajj: false`, and the
   * count is checked. That is what closes the window between validation and here:
   * if a real draw selected one of these people in the meantime, the update
   * matches fewer rows than expected and the entire import rolls back rather than
   * quietly recording a second lifetime win.
   *
   * No `DrawResult` or `DrawWinner` is manufactured. Those describe a lottery this
   * system ran — a pool, a random value, a selection order — and a register from
   * 2011 has none of that. A legacy win is a different kind of fact and lives in
   * its own table, so nobody reading a draw result later has to wonder which of
   * its rows were real.
   */
  private async writeLegacyWinners(
    tx: Prisma.TransactionClient,
    rows: readonly { row: ImportRow }[],
    participants: { idByNationalId: Map<string, string> },
    history: ReadonlyMap<string, string>,
    batch: ImportBatch,
  ): Promise<number> {
    const winners = rows
      .map(({ row }) => row)
      .filter((row) => row.won === true)
      .map((row) => {
        const participantId = participants.idByNationalId.get(row.nationalId as string) as string
        const historyId = history.get(`${participantId}:${row.drawYear}`)
        if (!historyId) {
          throw new ConflictError(
            'IMPORT_HAS_CONFLICTS',
            `Row ${row.rowNumber} recorded a win with no matching historical record`,
          )
        }

        return {
          participantId,
          drawYear: row.drawYear as number,
          communeId: row.communeId as string,
          importBatchId: batch.id,
          importRowId: row.id,
          participationHistoryId: historyId,
        }
      })

    if (winners.length === 0) return 0

    for (let index = 0; index < winners.length; index += CHUNK) {
      await tx.legacyWinner.createMany({ data: winners.slice(index, index + CHUNK) })
    }

    const participantIds = winners.map((winner) => winner.participantId)
    const excluded = await tx.participant.updateMany({
      where: { id: { in: participantIds }, hasWonHajj: false },
      data: { hasWonHajj: true },
    })

    if (excluded.count !== participantIds.length) {
      throw new ConflictError(
        'IMPORT_HAS_CONFLICTS',
        'A person in this import has been recorded as a Hajj winner since it was approved',
      )
    }

    return winners.length
  }

  /**
   * Points each written row at what it produced.
   *
   * One statement per thousand rows rather than one per row: a `VALUES` join is
   * the difference between an import that takes a second and one that holds locks
   * for a minute while it makes twelve thousand round trips.
   */
  private async linkRows(
    tx: Prisma.TransactionClient,
    rows: readonly { row: ImportRow }[],
    participants: { idByNationalId: Map<string, string> },
    history: ReadonlyMap<string, string>,
  ): Promise<void> {
    const links = rows.map(({ row }) => {
      const participantId = participants.idByNationalId.get(row.nationalId as string) as string
      return {
        id: row.id,
        participantId,
        historyId: history.get(`${participantId}:${row.drawYear}`) as string,
      }
    })

    for (let index = 0; index < links.length; index += CHUNK) {
      const values = links
        .slice(index, index + CHUNK)
        .map((link) => Prisma.sql`(${link.id}, ${link.participantId}, ${link.historyId})`)

      await tx.$executeRaw`
        UPDATE "import_rows" AS r
        SET "participant_id" = v.participant_id, "participation_history_id" = v.history_id
        FROM (VALUES ${Prisma.join(values)}) AS v(id, participant_id, history_id)
        WHERE r."id" = v.id
      `
    }
  }

  /**
   * Confirms the import is whole while a rollback is still possible.
   *
   * Counted from the database rather than from the arrays that were sent to it,
   * because what matters is what was written. Afterwards nothing can be repaired:
   * legacy winner rows are immutable by trigger and the batch is terminal.
   */
  private async assertComplete(
    tx: Prisma.TransactionClient,
    batchId: string,
    expectedHistory: number,
    expectedWinners: number,
  ): Promise<void> {
    const [linked, winners] = await Promise.all([
      tx.importRow.count({ where: { importBatchId: batchId, participationHistoryId: { not: null } } }),
      tx.legacyWinner.count({ where: { importBatchId: batchId } }),
    ])

    if (linked !== expectedHistory || winners !== expectedWinners) {
      throw new ConflictError(
        'IMPORT_HAS_CONFLICTS',
        'The rows written did not match the import that produced them',
      )
    }
  }

  // --- Shared helpers -----------------------------------------------------

  /** Row counts for a batch, for an audit summary. Never row contents. */
  private async counts(
    tx: Pick<PrismaClient, 'importRow'>,
    batchId: string,
  ): Promise<{ rows: number; conflicts: number; invalid: number }> {
    const [rows, conflicts, invalid] = await Promise.all([
      tx.importRow.count({ where: { importBatchId: batchId } }),
      tx.importRow.count({ where: { importBatchId: batchId, status: 'CONFLICT' } }),
      tx.importRow.count({ where: { importBatchId: batchId, status: 'INVALID' } }),
    ])

    return { rows, conflicts, invalid }
  }

  private assertNotUploader(actor: AuditActor, batch: ImportBatch): void {
    if (batch.uploadedByUserId === actor.id) {
      throw new ForbiddenError(
        'SELF_APPROVAL_FORBIDDEN',
        'An administrator cannot review the import they uploaded. Another SUPER_ADMIN must review it.',
      )
    }
  }

  private assertState(batch: ImportBatch, to: ImportBatchStatus): void {
    if (!canTransitionBatch(batch.status, to)) {
      throw new ConflictError('IMPORT_NOT_IN_STATE', `An import that is ${batch.status} cannot become ${to}`)
    }
  }

  private async transition(batchId: string, from: ImportBatchStatus, to: ImportBatchStatus): Promise<void> {
    if (!canTransitionBatch(from, to)) {
      throw new ConflictError('IMPORT_NOT_IN_STATE', `An import cannot go from ${from} to ${to}`)
    }

    const moved = await this.db.importBatch.updateMany({
      where: { id: batchId, status: from },
      data: { status: to },
    })
    if (moved.count !== 1) {
      throw new ConflictError('IMPORT_NOT_IN_STATE', 'This import is no longer in the expected state')
    }
  }

  /**
   * Marks a batch unusable, recording why without recording the file.
   *
   * Best-effort on purpose: this runs while another error is already propagating,
   * and failing to record the failure must not replace the error that caused it.
   */
  private async fail(batchId: string, cause: unknown): Promise<void> {
    const reason = cause instanceof Error ? cause.message : 'The file could not be staged'

    try {
      await this.db.importBatch.updateMany({
        where: { id: batchId, status: { in: ['UPLOADED', 'VALIDATING'] } },
        data: { status: 'FAILED', failureReason: reason.slice(0, 500) },
      })
    } catch {
      // Swallowed deliberately. The caller is about to throw the real cause.
    }
  }
}

/**
 * The territory an import is filed under.
 *
 * Taken from the uploader's own reach rather than from the rows, which is a
 * narrow and deliberate exception to how audit scope is decided everywhere else.
 * The justification is that a scoped administrator's file *cannot* name anywhere
 * outside their reach — a row that tries is refused as OUT_OF_SCOPE_COMMUNE — so
 * their reach is the batch's actual coverage, and it is known before the rows are
 * staged, which is when the first event is recorded.
 *
 * A national administrator's import is filed nationally, which means scoped
 * administrators do not see it in the trail. That is the same rule the rest of
 * the trail follows: a national action is not shared data.
 */
function uploaderScope(user: Pick<User, 'role' | 'wilayaId' | 'communeId'>): AuditScope {
  return { wilayaId: user.wilayaId, communeId: user.communeId }
}

/** A stored row, back in the shape the pure rules read. */
function toStagedRow(row: ImportRow): StagedRow {
  return {
    rowNumber: row.rowNumber,
    values: {
      nationalId: row.nationalId,
      firstNameAr: row.firstNameAr,
      lastNameAr: row.lastNameAr,
      firstNameLatin: row.firstNameLatin,
      lastNameLatin: row.lastNameLatin,
      dob: row.dob,
      phoneNumber: row.phoneNumber,
      communeCode: row.communeCode,
      communeId: row.communeId,
      drawYear: row.drawYear,
      participated: row.participated,
      won: row.won,
      notes: row.notes,
      gender: row.gender,
    },
    issues: [],
  }
}

/** The issues recorded at staging, as they were stored. */
export function storedIssues(row: Pick<ImportRow, 'issues'>): ImportIssue[] {
  return Array.isArray(row.issues) ? (row.issues as unknown as ImportIssue[]) : []
}

function maxYear(current: number | null, candidate: number): number {
  return current === null ? candidate : Math.max(current, candidate)
}

export const legacyImportService = new LegacyImportService()
