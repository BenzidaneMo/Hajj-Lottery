import {
  isImportWarning,
  MAX_IMPORT_CELL_CHARACTERS,
  MAX_IMPORT_NOTE_CHARACTERS,
  type ImportColumn,
  type ImportIssueCode,
  type ImportRowStatus,
} from '@hajj-lottery/shared'

import { isValidNationalId, normalizeNationalId } from './national-id.js'
import { isValidPhoneNumber, normalizePhoneNumber } from './phone.js'
import {
  parseImportBoolean,
  parseImportDate,
  parseImportInteger,
  type RawImportRow,
} from './import-template.js'

/**
 * What an uploaded register is allowed to claim, as pure functions.
 *
 * No database, no clock, no randomness — every fact these rules need arrives in
 * the context they are given. That is what makes an import re-checkable: the
 * same file and the same database state produce the same verdicts, in the same
 * order, whether they are being staged for review or re-checked inside the
 * transaction that is about to write them.
 *
 * Three principles run through all of it.
 *
 * **Unknown is not false.** An empty participation cell is a gap in the register,
 * not a claim that somebody stayed home. Coercing it would manufacture a positive
 * statement the ledger treats as authoritative and the streak walk treats as a
 * year of patience the person never had. Missing required values are errors.
 *
 * **Nothing is repaired.** A name that disagrees with the identity registry, a
 * year that disagrees with an existing historical record, a win that disagrees
 * with a lifetime exclusion — every one of them is reported and blocks, and none
 * of them is resolved by preferring one source over the other. Choosing between
 * two accounts of a person's history is an administrator's decision, and the
 * evidence for it is both rows sitting next to each other.
 *
 * **The national ID is the person.** Name and date of birth corroborate; they
 * never identify. A row whose name disagrees is a conflict on that person's
 * record, never a second person with the same national ID.
 */

export interface ImportIssue {
  code: ImportIssueCode
  column: ImportColumn | null
  detail: string | null
}

/** One row's values, normalized by the same utilities the rest of the API uses. */
export interface StagedValues {
  nationalId: string | null
  fullName: string | null
  dob: Date | null
  phoneNumber: string | null
  communeCode: string
  communeId: string | null
  drawYear: number | null
  participated: boolean | null
  won: boolean | null
  notes: string | null
}

export interface StagedRow {
  rowNumber: number
  values: StagedValues
  issues: ImportIssue[]
}

/** What the surrounding system knows, at the moment of checking. */
export interface StagingContext {
  /** Commune id by official code. Resolution is by code, never by name. */
  communeIdByCode: ReadonlyMap<string, string>
  /** The latest year a draw could have concluded in. Nothing later is history. */
  referenceDrawYear: number
  /**
   * The communes the uploader administers, or null for a national administrator.
   * A scoped administrator's file may only speak about their own territory.
   */
  allowedCommuneIds: ReadonlySet<string> | null
}

/** One year of one person's existing ledger. */
export interface KnownHistoryYear {
  participated: boolean
  won: boolean
  communeId: string
}

/** A person the registry already knows, and everything the checks need about them. */
export interface KnownParticipant {
  id: string
  fullName: string
  dob: Date
  phoneNumber: string | null
  hasWonHajj: boolean
  /** The year they won, from either provenance, when the system can name it. */
  winningYear: number | null
  history: ReadonlyMap<number, KnownHistoryYear>
}

const issue = (code: ImportIssueCode, column: ImportColumn | null, detail: string | null = null) =>
  ({ code, column, detail }) satisfies ImportIssue

/**
 * Converts and checks one row on its own.
 *
 * Everything here is about the row in isolation: is it well-formed, does it name
 * a real commune, is its year one a draw could have happened in. Agreements and
 * disagreements with other rows and with the database come later, because they
 * need the whole file and the whole registry to be visible.
 */
export function stageRow(raw: RawImportRow, context: StagingContext): StagedRow {
  const issues: ImportIssue[] = []
  const cells = raw.cells

  for (const [column, value] of Object.entries(cells)) {
    if (value.length > MAX_IMPORT_CELL_CHARACTERS) {
      issues.push(issue('CELL_TOO_LONG', column as ImportColumn, `${value.length} characters`))
    }
    // A cell that still carries a formula reached us as a formula: refused, never
    // evaluated. There is no legitimate register in which somebody's national ID
    // is computed from another cell.
    if (value.startsWith('=')) {
      issues.push(issue('FORMULA_CELL', column as ImportColumn))
    }
  }

  const nationalId = stageNationalId(cells.national_id, issues)
  const fullName = stageFullName(cells.full_name, issues)
  const dob = stageDob(cells.dob, issues, context.referenceDrawYear)
  const phoneNumber = stagePhone(cells.phone_number, issues)
  const { communeCode, communeId } = stageCommune(cells.commune_code, issues, context)
  const drawYear = stageDrawYear(cells.draw_year, issues, context.referenceDrawYear)
  const { participated, won } = stageOutcome(cells.participated, cells.won, issues)

  const notes = cells.notes?.slice(0, MAX_IMPORT_NOTE_CHARACTERS) ?? null

  return {
    rowNumber: raw.rowNumber,
    values: {
      nationalId,
      fullName,
      dob,
      phoneNumber,
      communeCode,
      communeId,
      drawYear,
      participated,
      won,
      notes,
    },
    issues,
  }
}

function stageNationalId(raw: string | undefined, issues: ImportIssue[]): string | null {
  if (raw === undefined) {
    issues.push(issue('MISSING_NATIONAL_ID', 'national_id'))
    return null
  }

  // The same normalization every other path into the system uses. A register
  // written in Arabic-Indic digits must resolve to the person already known by
  // the ASCII form, not to a second identity for the same human being.
  const normalized = normalizeNationalId(raw)
  if (!isValidNationalId(normalized)) {
    issues.push(
      issue('INVALID_NATIONAL_ID', 'national_id', `${normalized.length} digits after normalization`),
    )
    return null
  }

  return normalized
}

function stageFullName(raw: string | undefined, issues: ImportIssue[]): string | null {
  const value = raw?.trim()
  if (!value) {
    issues.push(issue('MISSING_FULL_NAME', 'full_name'))
    return null
  }
  return value
}

function stageDob(raw: string | undefined, issues: ImportIssue[], referenceYear: number): Date | null {
  const parsed = parseImportDate(raw)

  if (parsed === undefined) {
    issues.push(issue('MISSING_DOB', 'dob'))
    return null
  }
  if (parsed === null) {
    issues.push(issue('INVALID_DOB', 'dob', 'expected YYYY-MM-DD or DD/MM/YYYY'))
    return null
  }
  // A pilgrim born after the last draw, or in 1850, is a transcription error
  // rather than a fact about a person.
  const year = parsed.getUTCFullYear()
  if (year < referenceYear - 130 || year > referenceYear) {
    issues.push(issue('INVALID_DOB', 'dob', `year ${year} is outside the plausible range`))
    return null
  }

  return parsed
}

/**
 * A phone number, which is never load-bearing.
 *
 * Optional, because a register from 2009 has none, and a warning rather than an
 * error when it will not parse: nothing dials it, nothing authenticates on it,
 * and refusing an entire historical record over a mistyped mobile number would
 * cost somebody a year of priority to protect a field that does nothing.
 */
function stagePhone(raw: string | undefined, issues: ImportIssue[]): string | null {
  if (raw === undefined) return null

  const normalized = normalizePhoneNumber(raw)
  if (!isValidPhoneNumber(normalized)) {
    issues.push(issue('INVALID_PHONE_NUMBER', 'phone_number', 'not a recognisable Algerian mobile number'))
    return null
  }

  return normalized
}

/**
 * The commune, resolved by official code.
 *
 * By code and never by name. Commune names are transliterated inconsistently,
 * renamed over decades, and repeated across wilayas; matching on them would
 * attach somebody's history to the wrong territory in a way nobody would notice.
 * A code the reference data does not hold is an error, and no commune is created
 * to accommodate it.
 */
function stageCommune(
  raw: string | undefined,
  issues: ImportIssue[],
  context: StagingContext,
): { communeCode: string; communeId: string | null } {
  const communeCode = raw?.trim() ?? ''

  if (communeCode.length === 0) {
    issues.push(issue('MISSING_COMMUNE_CODE', 'commune_code'))
    return { communeCode, communeId: null }
  }

  const communeId = context.communeIdByCode.get(normalizeCommuneCode(communeCode)) ?? null
  if (!communeId) {
    issues.push(issue('UNKNOWN_COMMUNE', 'commune_code', communeCode))
    return { communeCode, communeId: null }
  }

  // A scoped administrator may prepare their own territory's register and no
  // one else's. Refused per row rather than per file, so a reviewer can see
  // exactly which lines overreached.
  if (context.allowedCommuneIds && !context.allowedCommuneIds.has(communeId)) {
    issues.push(issue('OUT_OF_SCOPE_COMMUNE', 'commune_code', communeCode))
  }

  return { communeCode, communeId }
}

/** Codes are official numbers written without leading zeros; `05` is `5`. */
export function normalizeCommuneCode(raw: string): string {
  const digits = raw.trim().replace(/^0+(?=\d)/, '')
  return digits
}

function stageDrawYear(raw: string | undefined, issues: ImportIssue[], referenceYear: number): number | null {
  const parsed = parseImportInteger(raw)

  if (parsed === undefined) {
    issues.push(issue('MISSING_DRAW_YEAR', 'draw_year'))
    return null
  }
  if (parsed === null || parsed < 2000 || parsed > 2200) {
    issues.push(issue('INVALID_DRAW_YEAR', 'draw_year', raw ?? null))
    return null
  }
  // History is a record of draws that have happened. A future year has no
  // outcome to transcribe, whatever the file says.
  if (parsed > referenceYear) {
    issues.push(issue('FUTURE_DRAW_YEAR', 'draw_year', String(parsed)))
    return null
  }

  return parsed
}

/**
 * Participation and outcome, neither of which may be inferred.
 *
 * The whole rule in one line: a blank cell is an error, not a `false`. The ledger
 * distinguishes "no record" from "a record saying they did not take part", and an
 * import that filled gaps with `false` would convert every silence in a paper
 * register into an authoritative negative claim.
 */
function stageOutcome(
  participatedCell: string | undefined,
  wonCell: string | undefined,
  issues: ImportIssue[],
): { participated: boolean | null; won: boolean | null } {
  const participated = parseImportBoolean(participatedCell)
  const won = parseImportBoolean(wonCell)

  if (participated === undefined) issues.push(issue('MISSING_PARTICIPATION', 'participated'))
  if (participated === null)
    issues.push(issue('INVALID_PARTICIPATION', 'participated', participatedCell ?? null))
  if (won === undefined) issues.push(issue('MISSING_OUTCOME', 'won'))
  if (won === null) issues.push(issue('INVALID_OUTCOME', 'won', wonCell ?? null))

  if (participated === false && won === true) {
    issues.push(issue('WON_WITHOUT_PARTICIPATION', 'won'))
  }

  return { participated: participated ?? null, won: won ?? null }
}

/**
 * Disagreements between rows of the same file.
 *
 * Two kinds. The same person and year appearing twice, where identical rows are
 * a transcription artefact worth consolidating and differing rows are a question
 * nobody but an administrator can answer. And a sequence that cannot have
 * happened: winning the Hajj lottery is a lifetime entitlement, so a person
 * cannot win twice, and cannot take part in a year after the one they won.
 *
 * Nothing is resolved here — a conflicting pair is flagged on *both* rows, so a
 * reviewer sees the disagreement rather than a survivor.
 */
export function detectFileConflicts(rows: StagedRow[]): void {
  const byPerson = new Map<string, StagedRow[]>()

  for (const row of rows) {
    const nationalId = row.values.nationalId
    if (!nationalId) continue
    const group = byPerson.get(nationalId)
    if (group) group.push(row)
    else byPerson.set(nationalId, [row])
  }

  for (const group of byPerson.values()) {
    detectDuplicateYears(group)
    detectChronology(group)
  }
}

function detectDuplicateYears(group: StagedRow[]): void {
  const byYear = new Map<number, StagedRow[]>()

  for (const row of group) {
    const year = row.values.drawYear
    if (year === null) continue
    const rows = byYear.get(year)
    if (rows) rows.push(row)
    else byYear.set(year, [row])
  }

  for (const [year, rows] of byYear) {
    if (rows.length < 2) continue

    const first = rows[0] as StagedRow
    const identical = rows.every((row) => sameClaim(row, first))

    if (identical) {
      // Two transcriptions of one line. The first is kept and the rest are
      // reported as consolidated — a warning, because nothing is in dispute.
      for (const row of rows.slice(1)) {
        row.issues.push(issue('DUPLICATE_ROW_IN_FILE', null, `identical to row ${first.rowNumber}`))
      }
      continue
    }

    // Two accounts of one person's year. Both are flagged: which one is right is
    // exactly what a reviewer has to decide, and hiding one would hide the choice.
    const lines = rows.map((row) => row.rowNumber).join(', ')
    for (const row of rows) {
      row.issues.push(issue('CONFLICTING_DUPLICATE_IN_FILE', null, `year ${year} also on rows ${lines}`))
    }
  }
}

function sameClaim(a: StagedRow, b: StagedRow): boolean {
  return (
    a.values.participated === b.values.participated &&
    a.values.won === b.values.won &&
    a.values.communeId === b.values.communeId
  )
}

/**
 * A person's years, read as a sequence.
 *
 * Two wins is impossible. So is taking part after winning — the entitlement is
 * spent, and a register showing 2024 won followed by 2025 participated is either
 * two different people conflated under one national ID or a transcription error.
 * Either way it is not something to average out.
 */
function detectChronology(group: StagedRow[]): void {
  const wins = group.filter((row) => row.values.won === true && row.values.drawYear !== null)

  if (wins.length > 1) {
    const years = wins.map((row) => row.values.drawYear).join(', ')
    for (const row of wins) {
      row.issues.push(issue('CONFLICTING_CHRONOLOGY_IN_FILE', 'won', `wins recorded in ${years}`))
    }
    return
  }

  const win = wins[0]
  if (!win) return

  const winningYear = win.values.drawYear as number

  for (const row of group) {
    if (row === win || row.values.drawYear === null) continue
    if (row.values.drawYear > winningYear && row.values.participated === true) {
      row.issues.push(
        issue(
          'CONFLICTING_CHRONOLOGY_IN_FILE',
          'draw_year',
          `participation in ${row.values.drawYear} follows a win in ${winningYear}`,
        ),
      )
    }
  }
}

/**
 * Disagreements between the file and what the database already holds.
 *
 * The identity registry and the participation ledger are authoritative; an
 * uploaded register is a claim about them. So nothing here overwrites: a row that
 * disagrees is flagged, and a row that agrees with an existing historical record
 * is marked as already present and will be skipped rather than written twice.
 *
 * `known` is keyed by canonical national ID and holds only the people this file
 * mentions — the registry is queried for the file, never loaded wholesale.
 */
export function detectDatabaseConflicts(
  rows: StagedRow[],
  known: ReadonlyMap<string, KnownParticipant>,
): void {
  for (const row of rows) {
    const nationalId = row.values.nationalId
    if (!nationalId) continue

    const participant = known.get(nationalId)
    if (!participant) continue

    checkIdentity(row, participant)
    checkExistingHistory(row, participant)
    checkWinnerCoherence(row, participant)
  }
}

/**
 * The corroborating attributes, against the registry.
 *
 * A national ID identifies; a name and a date of birth confirm. When they
 * disagree the row is a conflict on that person's record — never a second
 * participant with the same national ID, which the unique index forbids anyway,
 * and never a quiet update of the registry from a spreadsheet somebody uploaded.
 */
function checkIdentity(row: StagedRow, participant: KnownParticipant): void {
  const name = row.values.fullName
  const dob = row.values.dob

  const nameDiffers = name !== null && normalizeName(name) !== normalizeName(participant.fullName)
  const dobDiffers = dob !== null && !sameDay(dob, participant.dob)

  if (nameDiffers || dobDiffers) {
    // The differing values are deliberately not repeated in the detail: a
    // reviewer sees both records side by side, and the issue list is rendered in
    // places the registry's own values do not belong.
    row.issues.push(
      issue(
        'IDENTITY_CONFLICT',
        nameDiffers ? 'full_name' : 'dob',
        nameDiffers && dobDiffers
          ? 'the name and date of birth differ from the identity registry'
          : nameDiffers
            ? 'the name differs from the identity registry'
            : 'the date of birth differs from the identity registry',
      ),
    )
  }

  // A phone number that moved on is not a conflict — people change numbers. It
  // is reported so a reviewer knows the file is not the source of truth for it,
  // and the stored number is never replaced from an uploaded register.
  if (
    row.values.phoneNumber &&
    participant.phoneNumber &&
    row.values.phoneNumber !== participant.phoneNumber
  ) {
    row.issues.push(issue('PHONE_NUMBER_DIFFERS', 'phone_number', 'the registry holds a different number'))
  }
}

function checkExistingHistory(row: StagedRow, participant: KnownParticipant): void {
  const year = row.values.drawYear
  if (year === null) return

  const existing = participant.history.get(year)
  if (!existing) return

  const identical =
    existing.participated === row.values.participated &&
    existing.won === row.values.won &&
    existing.communeId === row.values.communeId

  if (identical) {
    // Nothing to do and nothing wrong: the ledger already says this. Reported so
    // the summary's counts are honest about how much of the file is new.
    row.issues.push(issue('ALREADY_RECORDED', null, `${year} is already recorded identically`))
    return
  }

  row.issues.push(
    issue(
      'CONFLICTS_WITH_EXISTING_HISTORY',
      null,
      `the ledger already records ${year} differently for this person`,
    ),
  )
}

/**
 * The file, against a lifetime entitlement that has already been used.
 *
 * Three cases, and only the middle one is benign:
 *
 * - the file records a *second* win — blocked, always. One person, one Hajj.
 * - the file records a loss in a year *before* the win — coherent, and exactly
 *   the history an import exists to establish.
 * - the file records participation in a year *after* the win — blocked. The
 *   entitlement was spent; either the file or the winner record is wrong, and
 *   the import is not entitled to decide which.
 *
 * What never happens: `has_won_hajj` being cleared. A permanent exclusion is not
 * something an uploaded spreadsheet gets to reverse by omission.
 */
function checkWinnerCoherence(row: StagedRow, participant: KnownParticipant): void {
  if (!participant.hasWonHajj) return

  if (row.values.won === true) {
    row.issues.push(
      issue('ALREADY_A_WINNER', 'won', 'this person is already recorded as having won the Hajj lottery'),
    )
    return
  }

  const year = row.values.drawYear
  if (year === null || participant.winningYear === null) return

  if (year > participant.winningYear) {
    row.issues.push(
      issue(
        'CONTRADICTS_WINNER_CHRONOLOGY',
        'draw_year',
        `participation in ${year} follows a recorded win in ${participant.winningYear}`,
      ),
    )
  }
}

/** The verdict for a row, from everything found on it. */
export function resolveRowStatus(issues: readonly ImportIssue[]): ImportRowStatus {
  if (issues.length === 0) return 'VALID'

  const blocking = issues.filter((found) => !isImportWarning(found.code))
  if (blocking.length === 0) return 'WARNING'

  // A row that disagrees with something is a question for a person; a row that is
  // simply unusable is not. Both stop the import, and the difference is what a
  // reviewer is being asked to do about it.
  return blocking.every((found) => CONFLICT_CODES.includes(found.code)) ? 'CONFLICT' : 'INVALID'
}

const CONFLICT_CODES: readonly ImportIssueCode[] = [
  'CONFLICTING_DUPLICATE_IN_FILE',
  'CONFLICTING_CHRONOLOGY_IN_FILE',
  'IDENTITY_CONFLICT',
  'CONFLICTS_WITH_EXISTING_HISTORY',
  'ALREADY_A_WINNER',
  'CONTRADICTS_WINNER_CHRONOLOGY',
  'OUT_OF_SCOPE_COMMUNE',
]

/** True when this row has nothing left to write: the ledger already holds it. */
export function isAlreadyRecorded(issues: readonly ImportIssue[]): boolean {
  return issues.some((found) => found.code === 'ALREADY_RECORDED')
}

/** Case and spacing are transcription noise; anything else is a different name. */
function normalizeName(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')
}

function sameDay(a: Date, b: Date): boolean {
  return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10)
}
