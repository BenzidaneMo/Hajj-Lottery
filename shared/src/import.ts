/**
 * The legacy historical import.
 *
 * Paper registers from the years before this platform existed are the only
 * source of who has been waiting how long, and that waiting is what the
 * priority weighting is built on. So an import is not a bulk insert: it decides
 * who gets preference in future lotteries and who is excluded from them for
 * life.
 *
 * Everything here is deliberately a closed vocabulary — statuses, column names,
 * issue codes, limits. An uploaded spreadsheet is untrusted input from outside
 * the system, and the narrower the set of things it is allowed to say, the less
 * there is to get wrong.
 */

/** The file formats an administrator may upload. Nothing else is parsed. */
export const IMPORT_SOURCE_FORMATS = ['CSV', 'XLSX'] as const
export type ImportSourceFormat = (typeof IMPORT_SOURCE_FORMATS)[number]

/**
 * Where a batch stands.
 *
 * The lifecycle exists to keep four different things apart, because conflating
 * any two of them is how bad historical data becomes authoritative:
 *
 *   UPLOADED          a file arrived and was accepted as a file
 *   VALIDATING        its rows are being staged and checked
 *   READY_FOR_REVIEW  the checking finished; an administrator must now look
 *   APPROVED          a SUPER_ADMIN accepted it — but nothing has been written
 *   IMPORTED          the authoritative tables have it
 *
 * REJECTED and FAILED are the two ways a batch ends without being imported: one
 * is a decision, the other is the file itself being unusable.
 *
 * VALIDATING is a real state rather than a formality. Staging and validating a
 * large file is not one transaction, so a batch can genuinely be caught here —
 * and a batch stuck in VALIDATING is exactly what an administrator needs to see.
 */
export const IMPORT_BATCH_STATUSES = [
  'UPLOADED',
  'VALIDATING',
  'READY_FOR_REVIEW',
  'REJECTED',
  'APPROVED',
  'IMPORTED',
  'FAILED',
] as const
export type ImportBatchStatus = (typeof IMPORT_BATCH_STATUSES)[number]

/**
 * What validation concluded about one staged row.
 *
 * The distinction that matters is CONFLICT versus INVALID. INVALID means the
 * row does not say anything usable — a missing national ID, an unparseable
 * year. CONFLICT means the row is perfectly well-formed and disagrees with
 * something: another row, an existing participant, an authoritative historical
 * record. Both block the import; only the second is a question for a human.
 */
export const IMPORT_ROW_STATUSES = ['VALID', 'WARNING', 'CONFLICT', 'INVALID'] as const
export type ImportRowStatus = (typeof IMPORT_ROW_STATUSES)[number]

/** True when a row in this state stops the batch being imported. */
export function blocksImport(status: ImportRowStatus): boolean {
  return status === 'CONFLICT' || status === 'INVALID'
}

/**
 * The documented template. These column names, and their listed aliases, and
 * nothing else.
 *
 * Uncontrolled fuzzy header matching is how a column called `gagnant` silently
 * becomes the winner flag in a file where it meant something else. A header the
 * table below does not name is ignored rather than guessed at, and a missing
 * required column rejects the file outright.
 */
export const REQUIRED_IMPORT_COLUMNS = [
  'national_id',
  'full_name',
  'dob',
  'commune_code',
  'draw_year',
  'participated',
  'won',
] as const

export const OPTIONAL_IMPORT_COLUMNS = ['phone_number', 'notes'] as const

export type RequiredImportColumn = (typeof REQUIRED_IMPORT_COLUMNS)[number]
export type OptionalImportColumn = (typeof OPTIONAL_IMPORT_COLUMNS)[number]
export type ImportColumn = RequiredImportColumn | OptionalImportColumn

/**
 * Accepted spellings for each column, in the three languages an Algerian
 * register is realistically kept in.
 *
 * An explicit table, not a similarity score. Headers are compared after being
 * lowercased and having runs of spaces, dashes and underscores collapsed to a
 * single underscore — so `National ID`, `national-id` and `NATIONAL_ID` are the
 * same header, while `national identifier` is simply not one we accept.
 */
export const IMPORT_COLUMN_ALIASES: Record<ImportColumn, readonly string[]> = {
  national_id: ['national_id', 'nin', 'nni', 'numero_national', 'رقم_التعريف_الوطني', 'رقم_وطني'],
  full_name: ['full_name', 'name', 'nom', 'nom_complet', 'nom_et_prenom', 'الاسم', 'الاسم_الكامل'],
  dob: ['dob', 'date_of_birth', 'date_naissance', 'date_de_naissance', 'تاريخ_الميلاد'],
  commune_code: ['commune_code', 'code_commune', 'commune', 'رمز_البلدية', 'البلدية'],
  draw_year: ['draw_year', 'year', 'annee', 'année', 'annee_tirage', 'السنة', 'سنة_القرعة'],
  participated: ['participated', 'participation', 'participe', 'participé', 'مشارك', 'شارك'],
  won: ['won', 'winner', 'gagnant', 'laureat', 'lauréat', 'فائز', 'فاز'],
  phone_number: ['phone_number', 'phone', 'telephone', 'téléphone', 'tel', 'الهاتف', 'رقم_الهاتف'],
  notes: ['notes', 'note', 'remarque', 'remarques', 'observation', 'ملاحظات', 'ملاحظة'],
}

/**
 * How the truth values in a legacy register are written.
 *
 * A register kept by hand says `oui`, `نعم`, `1`, `x` or `true` and means the
 * same thing each time. What it must never do is say nothing — an empty cell is
 * an unknown, and an unknown is not a false. See MISSING_PARTICIPATION.
 */
export const IMPORT_TRUE_VALUES = ['true', '1', 'yes', 'y', 'oui', 'o', 'vrai', 'x', 'نعم', 'ن'] as const
export const IMPORT_FALSE_VALUES = ['false', '0', 'no', 'n', 'non', 'faux', 'لا', 'ل'] as const

/**
 * Upload limits.
 *
 * Every one of these is a refusal, not a truncation. A file over the ceiling is
 * rejected whole rather than imported in part, because a silently shortened
 * historical import would give thousands of people a shorter waiting record than
 * they actually have.
 */
export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024
export const MAX_IMPORT_ROWS = 50_000
export const MAX_IMPORT_COLUMNS = 32
export const MAX_IMPORT_CELL_CHARACTERS = 500
/** Long enough for a register reference and a note about an illegible entry. */
export const MAX_IMPORT_NOTE_CHARACTERS = 500

/** The extensions and content types an upload may claim. Neither is trusted alone. */
export const IMPORT_FILE_EXTENSIONS: Record<ImportSourceFormat, string> = { CSV: '.csv', XLSX: '.xlsx' }

export const IMPORT_CONTENT_TYPES: Record<ImportSourceFormat, readonly string[]> = {
  CSV: ['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel'],
  XLSX: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip'],
}

/**
 * Everything validation can conclude about a row, as a closed set.
 *
 * Codes rather than sentences so the admin UI can translate them, and so a test
 * can assert which conclusion was reached rather than matching prose.
 */
export const IMPORT_ISSUE_CODES = [
  // The row does not say something it must.
  'MISSING_NATIONAL_ID',
  'INVALID_NATIONAL_ID',
  'MISSING_FULL_NAME',
  'MISSING_DOB',
  'INVALID_DOB',
  'MISSING_COMMUNE_CODE',
  'UNKNOWN_COMMUNE',
  'MISSING_DRAW_YEAR',
  'INVALID_DRAW_YEAR',
  'FUTURE_DRAW_YEAR',
  /** Empty, not false. An unknown participation is a gap in the register. */
  'MISSING_PARTICIPATION',
  'INVALID_PARTICIPATION',
  'MISSING_OUTCOME',
  'INVALID_OUTCOME',
  'WON_WITHOUT_PARTICIPATION',
  /** A cell carrying a formula rather than a value. Refused, never evaluated. */
  'FORMULA_CELL',
  'CELL_TOO_LONG',
  /** A scoped administrator's file naming a commune they do not administer. */
  'OUT_OF_SCOPE_COMMUNE',

  // The row disagrees with another row in the same file.
  'DUPLICATE_ROW_IN_FILE',
  'CONFLICTING_DUPLICATE_IN_FILE',
  'CONFLICTING_CHRONOLOGY_IN_FILE',

  // The row disagrees with what the database already holds.
  'IDENTITY_CONFLICT',
  'ALREADY_RECORDED',
  'CONFLICTS_WITH_EXISTING_HISTORY',
  'ALREADY_A_WINNER',
  'CONTRADICTS_WINNER_CHRONOLOGY',

  // Contact details, which are never load-bearing.
  'INVALID_PHONE_NUMBER',
  'PHONE_NUMBER_DIFFERS',
] as const

export type ImportIssueCode = (typeof IMPORT_ISSUE_CODES)[number]

/**
 * The issues that do not block an import.
 *
 * A short list on purpose. A warning is something an administrator should see
 * and can reasonably proceed past; everything else stops the batch. A phone
 * number that will not parse costs nothing — nothing dials it and nothing
 * authenticates on it — and a row already present in the ledger is not a
 * problem, it is a row with nothing to do.
 */
export const IMPORT_WARNING_CODES: readonly ImportIssueCode[] = [
  'INVALID_PHONE_NUMBER',
  'PHONE_NUMBER_DIFFERS',
  'DUPLICATE_ROW_IN_FILE',
  'ALREADY_RECORDED',
]

export function isImportWarning(code: ImportIssueCode): boolean {
  return IMPORT_WARNING_CODES.includes(code)
}

/** One thing validation found, on one row. */
export interface ImportIssueDto {
  code: ImportIssueCode
  /** The template column it concerns, where it concerns one. */
  column: ImportColumn | null
  /** Context for a human, never the offending value where that value is personal. */
  detail: string | null
}

/** One staged row, as an administrator reviewing the batch sees it. */
export interface ImportRowDto {
  id: string
  rowNumber: number
  status: ImportRowStatus
  /** Last four digits only — enough to find the row in the register, useless alone. */
  nationalIdSuffix: string
  fullName: string
  communeCode: string
  drawYear: number | null
  participated: boolean | null
  won: boolean | null
  issues: ImportIssueDto[]
}

/** Staged rows are paged like the audit trail: never the whole file at once. */
export const IMPORT_ROW_PAGE_SIZE_DEFAULT = 50
export const IMPORT_ROW_PAGE_SIZE_MAX = 200

/** A page of staged rows. */
export interface ImportRowPageDto {
  items: ImportRowDto[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

/** A batch's own record, without its rows. */
export interface ImportBatchDto {
  id: string
  sourceFilename: string
  sourceFormat: ImportSourceFormat
  sourceChecksum: string
  status: ImportBatchStatus
  drawYearStart: number | null
  drawYearEnd: number | null
  uploadedBy: { id: string; username: string }
  approvedBy: { id: string; username: string } | null
  rowCount: number
  createdAt: string
  reviewedAt: string | null
  importedAt: string | null
}

/**
 * What the batch would do, counted over the rows the caller may see.
 *
 * Scoped, which is why the counts are computed per request rather than stored:
 * a COMMUNE_ADMIN reviewing a national file is told what it does to *their*
 * commune, and learns nothing about anybody else's.
 */
export interface ImportSummaryDto {
  batch: ImportBatchDto
  rows: number
  valid: number
  warnings: number
  conflicts: number
  invalid: number
  newParticipants: number
  existingParticipants: number
  historicalRecords: number
  winners: number
  /** True when nothing blocks a final import of the rows in view. */
  importable: boolean
}

/** What actually happened when a batch was imported. */
export interface ImportExecutionDto {
  batchId: string
  participantsCreated: number
  participantsReused: number
  historicalRecordsCreated: number
  rowsAlreadyPresent: number
  legacyWinnersRecorded: number
  importedAt: string
}
