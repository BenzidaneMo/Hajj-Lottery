import {
  calculateAgeAt,
  isImportWarning,
  isValidArabicName,
  isValidLatinName,
  MAHRAM_OPTIONAL_AGE,
  MAX_IMPORT_CELL_CHARACTERS,
  MAX_IMPORT_NOTE_CHARACTERS,
  MINIMUM_APPLICATION_AGE,
  normalizeArabicName,
  normalizeLatinName,
  type ImportColumn,
  type ImportIssueCode,
  type ImportRowStatus,
} from '@hajj-lottery/shared'

import { isValidNationalId, normalizeNationalId } from './national-id.js'
import { isValidPhoneNumber, normalizePhoneNumber } from './phone.js'
import {
  parseImportBoolean,
  parseImportDate,
  parseImportGender,
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
  firstNameAr: string | null
  lastNameAr: string | null
  firstNameLatin: string | null
  lastNameLatin: string | null
  dob: Date | null
  phoneNumber: string | null
  communeCode: string
  communeId: string | null
  drawYear: number | null
  participated: boolean | null
  won: boolean | null
  notes: string | null
  gender: 'MALE' | 'FEMALE' | null
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
  /**
   * Columns the file actually carried. An optional column that is absent from
   * the header is a schema-level gap (documented in the import guide), not a
   * per-row warning. The same column present but empty on a row *is* a gap on
   * that row.
   */
  presentColumns: ReadonlySet<ImportColumn>
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
  firstNameAr: string
  lastNameAr: string
  firstNameLatin: string
  lastNameLatin: string
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
  const firstNameAr = stageArabicName(cells.first_name_ar, 'first_name_ar', issues)
  const lastNameAr = stageArabicName(cells.last_name_ar, 'last_name_ar', issues)
  const firstNameLatin = stageLatinName(cells.first_name_latin, 'first_name_latin', issues)
  const lastNameLatin = stageLatinName(cells.last_name_latin, 'last_name_latin', issues)
  const dob = stageDob(cells.dob, issues, context.referenceDrawYear)
  const phoneNumber = stagePhone(cells.phone_number, issues)
  const { communeCode, communeId } = stageCommune(cells.commune_code, issues, context)
  const drawYear = stageDrawYear(cells.draw_year, issues, context.referenceDrawYear)
  const { participated, won } = stageOutcome(cells.participated, cells.won, issues)
  const gender = stageGender(cells.gender, issues, context)
  const registeredAt = stageRegisteredAt(cells.registered_at, issues, context)

  if (dob && registeredAt) {
    if (calculateAgeAt(dob, registeredAt) < MINIMUM_APPLICATION_AGE) {
      issues.push(
        issue(
          'UNDER_MINIMUM_AGE_AT_REGISTRATION',
          'registered_at',
          `younger than ${MINIMUM_APPLICATION_AGE} on the stated registration date`,
        ),
      )
    } else if (gender === 'FEMALE' && calculateAgeAt(dob, registeredAt) < MAHRAM_OPTIONAL_AGE) {
      // The canonical schema has no companion. A woman under 45 at the stated
      // date cannot be shown to have had a Mahram, and inventing one is refused.
      issues.push(issue('INSUFFICIENT_HISTORICAL_MAHRAM_EVIDENCE', 'gender'))
    }
  }

  const notes = cells.notes?.slice(0, MAX_IMPORT_NOTE_CHARACTERS) ?? null

  return {
    rowNumber: raw.rowNumber,
    values: {
      nationalId,
      firstNameAr,
      lastNameAr,
      firstNameLatin,
      lastNameLatin,
      dob,
      phoneNumber,
      communeCode,
      communeId,
      drawYear,
      participated,
      won,
      notes,
      gender,
    },
    issues,
  }
}

function stageRegisteredAt(
  raw: string | undefined,
  issues: ImportIssue[],
  context: StagingContext,
): Date | null {
  if (!context.presentColumns.has('registered_at')) return null
  if (raw === undefined) {
    issues.push(issue('INSUFFICIENT_HISTORICAL_AGE_EVIDENCE', 'registered_at'))
    return null
  }
  const parsed = parseImportDate(raw)
  if (!parsed) {
    issues.push(issue('INVALID_REGISTERED_AT', 'registered_at', 'expected YYYY-MM-DD or DD/MM/YYYY'))
    return null
  }
  return parsed
}

function stageGender(
  raw: string | undefined,
  issues: ImportIssue[],
  context: StagingContext,
): 'MALE' | 'FEMALE' | null {
  if (!context.presentColumns.has('gender')) return null
  if (raw === undefined) {
    issues.push(issue('INSUFFICIENT_HISTORICAL_GENDER_EVIDENCE', 'gender'))
    return null
  }
  const parsed = parseImportGender(raw)
  if (parsed === undefined || parsed === null) {
    issues.push(issue('INVALID_GENDER', 'gender', raw))
    return null
  }
  return parsed
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

const ARABIC_NAME_ISSUE_CODES = {
  first_name_ar: { missing: 'MISSING_FIRST_NAME_AR', invalid: 'INVALID_FIRST_NAME_AR' },
  last_name_ar: { missing: 'MISSING_LAST_NAME_AR', invalid: 'INVALID_LAST_NAME_AR' },
} as const satisfies Record<
  'first_name_ar' | 'last_name_ar',
  { missing: ImportIssueCode; invalid: ImportIssueCode }
>

const LATIN_NAME_ISSUE_CODES = {
  first_name_latin: { missing: 'MISSING_FIRST_NAME_LATIN', invalid: 'INVALID_FIRST_NAME_LATIN' },
  last_name_latin: { missing: 'MISSING_LAST_NAME_LATIN', invalid: 'INVALID_LAST_NAME_LATIN' },
} as const satisfies Record<
  'first_name_latin' | 'last_name_latin',
  { missing: ImportIssueCode; invalid: ImportIssueCode }
>

function stageArabicName(
  raw: string | undefined,
  column: 'first_name_ar' | 'last_name_ar',
  issues: ImportIssue[],
): string | null {
  const codes = ARABIC_NAME_ISSUE_CODES[column]
  const value = raw?.trim()
  if (!value) {
    issues.push(issue(codes.missing, column))
    return null
  }
  // A formula is already flagged FORMULA_CELL by the caller; script validation
  // would only add a confusing second issue to the same cell, and a reviewer
  // needs to see what the formula actually said, neutralized, not nothing.
  if (value.startsWith('=')) return value
  const normalized = normalizeArabicName(value)
  if (!isValidArabicName(normalized)) {
    issues.push(issue(codes.invalid, column, 'expected Arabic-script letters'))
    return null
  }
  return normalized
}

function stageLatinName(
  raw: string | undefined,
  column: 'first_name_latin' | 'last_name_latin',
  issues: ImportIssue[],
): string | null {
  const codes = LATIN_NAME_ISSUE_CODES[column]
  const value = raw?.trim()
  if (!value) {
    issues.push(issue(codes.missing, column))
    return null
  }
  if (value.startsWith('=')) return value
  const normalized = normalizeLatinName(value)
  if (!isValidLatinName(normalized)) {
    issues.push(issue(codes.invalid, column, 'expected Latin-script letters'))
    return null
  }
  return normalized
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
    if (!participant) {
      checkNewParticipantRequirements(row)
      continue
    }

    checkIdentity(row, participant)
    checkExistingHistory(row, participant)
    checkWinnerCoherence(row, participant)
  }
}

/**
 * A national ID matching nobody the registry already knows is about to
 * create a new participant, and every new participant needs a gender and a
 * phone number — neither of which a paper register always carries. Blocked
 * here rather than inferred, exactly as a fresh registration would refuse to
 * save without them.
 */
function checkNewParticipantRequirements(row: StagedRow): void {
  if (row.values.gender === null) {
    row.issues.push(issue('MISSING_GENDER_FOR_NEW_PARTICIPANT', 'gender'))
  }
  if (row.values.phoneNumber === null) {
    row.issues.push(issue('MISSING_PHONE_NUMBER_FOR_NEW_PARTICIPANT', 'phone_number'))
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
  const differing: ImportColumn[] = []

  const nameDiffers = (a: string, b: string) => normalizeForComparison(a) !== normalizeForComparison(b)

  if (row.values.firstNameAr !== null && nameDiffers(row.values.firstNameAr, participant.firstNameAr)) {
    differing.push('first_name_ar')
  }
  if (row.values.lastNameAr !== null && nameDiffers(row.values.lastNameAr, participant.lastNameAr)) {
    differing.push('last_name_ar')
  }
  if (
    row.values.firstNameLatin !== null &&
    nameDiffers(row.values.firstNameLatin, participant.firstNameLatin)
  ) {
    differing.push('first_name_latin')
  }
  if (row.values.lastNameLatin !== null && nameDiffers(row.values.lastNameLatin, participant.lastNameLatin)) {
    differing.push('last_name_latin')
  }

  const dob = row.values.dob
  if (dob !== null && !sameDay(dob, participant.dob)) differing.push('dob')

  if (differing.length > 0) {
    // The differing values are deliberately not repeated in the detail: a
    // reviewer sees both records side by side, and the issue list is rendered in
    // places the registry's own values do not belong.
    const first = differing[0] ?? null
    row.issues.push(
      issue(
        'IDENTITY_CONFLICT',
        first,
        differing.length === 1
          ? `${first} differs from the identity registry`
          : `${differing.join(', ')} differ from the identity registry`,
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

/**
 * Case and spacing are transcription noise; anything else is a different
 * name. Deliberately separate from `normalizeArabicName`/`normalizeLatinName`
 * (shared/src/name.ts): those preserve casing because it is meaningful in a
 * *stored* name ("McDonald"), but two transcriptions of the same person
 * should not conflict merely because one typed it in capitals.
 */
function normalizeForComparison(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')
}

function sameDay(a: Date, b: Date): boolean {
  return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10)
}
