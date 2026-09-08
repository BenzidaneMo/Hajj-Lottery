import {
  foldDigits,
  IMPORT_COLUMN_ALIASES,
  IMPORT_FALSE_VALUES,
  IMPORT_TRUE_VALUES,
  OPTIONAL_IMPORT_COLUMNS,
  REQUIRED_IMPORT_COLUMNS,
  type ImportColumn,
  type RequiredImportColumn,
} from '@hajj-lottery/shared'

/**
 * The documented template, and the only way a spreadsheet's columns become
 * fields.
 *
 * Header matching is a lookup in an explicit table, never a similarity score.
 * Uncontrolled fuzzy matching is how a column headed `gagnant` in a file where it
 * meant something else silently becomes the winner flag — and the winner flag
 * excludes a person from every future draw for the rest of their life. A header
 * this table does not name is ignored; a required column it cannot find rejects
 * the file whole.
 *
 * The values, likewise, are converted by fixed rules rather than by guessing at
 * intent. The one rule that matters more than the others: an empty cell converts
 * to nothing at all, never to `false`. See docs/legacy-import.md.
 */

/** One line of a file, reduced to the template's columns. */
export interface RawImportRow {
  /** The line in the source file, counting the header, so a reviewer can find it. */
  rowNumber: number
  cells: Partial<Record<ImportColumn, string>>
}

export interface HeaderMapping {
  columns: Partial<Record<ImportColumn, number>>
  missing: RequiredImportColumn[]
  /** Headers the file carried that the template does not recognise. Ignored, and reported. */
  ignored: string[]
}

const ALIAS_LOOKUP = new Map<string, ImportColumn>(
  Object.entries(IMPORT_COLUMN_ALIASES).flatMap(([column, aliases]) =>
    aliases.map((alias) => [normalizeHeader(alias), column as ImportColumn] as const),
  ),
)

/**
 * A header, reduced to the form the alias table is keyed by.
 *
 * Case, surrounding space, the difference between a space, a dash and an
 * underscore, and French accents all disappear — so `National ID`,
 * `national-id` and `NATIONAL_ID` are one header, and so are `Année` and
 * `annee`, which is how the same column arrives from two different offices.
 * Anything beyond that is a different header, not a near miss.
 *
 * Accents are stripped for *headers only*. Names are data and keep theirs: a
 * column label is a key, and a person's name is not.
 */
export function normalizeHeader(raw: string): string {
  return (
    raw
      .replace(/^\uFEFF/, '')
      .normalize('NFD')
      // Combining diacritical marks, left behind by NFD.
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, '_')
  )
}

/** Locates the template's columns in a file's header row. */
export function mapHeaders(header: readonly string[]): HeaderMapping {
  const columns: Partial<Record<ImportColumn, number>> = {}
  const ignored: string[] = []

  header.forEach((raw, index) => {
    const column = ALIAS_LOOKUP.get(normalizeHeader(raw))
    if (!column) {
      if (raw.trim().length > 0) ignored.push(raw.trim())
      return
    }
    // First occurrence wins. A file with the column twice is ambiguous, and
    // silently preferring the last would make which copy was used invisible.
    if (columns[column] === undefined) columns[column] = index
  })

  const missing = REQUIRED_IMPORT_COLUMNS.filter((column) => columns[column] === undefined)

  return { columns, missing, ignored }
}

/** Reduces a matrix of cells to template rows, dropping entirely blank lines. */
export function toRawRows(matrix: readonly (readonly string[])[], mapping: HeaderMapping): RawImportRow[] {
  const known = [...REQUIRED_IMPORT_COLUMNS, ...OPTIONAL_IMPORT_COLUMNS]
  const rows: RawImportRow[] = []

  matrix.forEach((line, offset) => {
    // +2: the header is line 1, and the first data line is line 2.
    const rowNumber = offset + 2
    const cells: Partial<Record<ImportColumn, string>> = {}

    for (const column of known) {
      const index = mapping.columns[column]
      if (index === undefined) continue
      const value = line[index]?.trim()
      if (value !== undefined && value.length > 0) cells[column] = value
    }

    if (Object.keys(cells).length > 0) rows.push({ rowNumber, cells })
  })

  return rows
}

/**
 * A truth value as a register writes one.
 *
 * Returns `undefined` for an empty cell and `null` for one that says something
 * unrecognised — a distinction the caller needs, because the first is a gap in
 * the register and the second is a cell somebody filled in wrongly.
 */
export function parseImportBoolean(raw: string | undefined): boolean | null | undefined {
  if (raw === undefined) return undefined

  const value = foldDigits(raw).trim().toLowerCase()
  if (value.length === 0) return undefined
  if ((IMPORT_TRUE_VALUES as readonly string[]).includes(value)) return true
  if ((IMPORT_FALSE_VALUES as readonly string[]).includes(value)) return false

  return null
}

/** A whole number, in any digit script. Null when the cell is not one. */
export function parseImportInteger(raw: string | undefined): number | null | undefined {
  if (raw === undefined) return undefined

  const value = foldDigits(raw).trim()
  if (value.length === 0) return undefined
  if (!/^\d{1,6}$/.test(value)) return null

  return Number.parseInt(value, 10)
}

/**
 * A date of birth, in the forms a register realistically uses.
 *
 * `YYYY-MM-DD` first, then the day-first forms an Algerian record keeps. Note
 * what is *not* accepted: anything ambiguous between day-first and month-first.
 * `03/04/1980` is read day-first, always, because guessing per row would make
 * two identical files disagree about somebody's birthday.
 *
 * Returned as a UTC midnight `Date`, matching how the column is stored.
 */
export function parseImportDate(raw: string | undefined): Date | null | undefined {
  if (raw === undefined) return undefined

  const value = foldDigits(raw).trim()
  if (value.length === 0) return undefined

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (iso) return utcDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  const dayFirst = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value)
  if (dayFirst) return utcDate(Number(dayFirst[3]), Number(dayFirst[2]), Number(dayFirst[1]))

  return null
}

/**
 * Builds the date, and rejects one that does not exist.
 *
 * `new Date(1980, 1, 31)` silently becomes 2 March; a register saying 31 February
 * is a transcription error, and quietly moving it would put a wrong date of birth
 * on somebody's permanent identity record.
 */
function utcDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  const date = new Date(Date.UTC(year, month - 1, day))
  const round =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day

  return round ? date : null
}
