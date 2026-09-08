import { createHash } from 'node:crypto'

import {
  IMPORT_CONTENT_TYPES,
  IMPORT_FILE_EXTENSIONS,
  MAX_IMPORT_CELL_CHARACTERS,
  MAX_IMPORT_COLUMNS,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_ROWS,
  type ImportSourceFormat,
} from '@hajj-lottery/shared'
import ExcelJS from 'exceljs'

import { CsvLimitError, parseCsv } from './csv.js'
import { BadRequestError } from './errors.js'

/**
 * Turning an uploaded file into a grid of text, under protest.
 *
 * The governing assumption is that the file is hostile. Not because
 * administrators are, but because the file passed through however many hands and
 * machines before reaching one, and a spreadsheet is a program: it has formulas,
 * external references, embedded objects, and a zip container that can be made to
 * expand to far more than it claims. So this module does four things and refuses
 * everything else — it decides what the file really is, bounds how much of it
 * will be read, converts cells to inert text, and hashes the bytes.
 *
 * What it never does: execute a macro, evaluate a formula, follow a link, or open
 * anything by a path. The upload never touches the filesystem at all — it is
 * parsed from the request buffer and discarded — which makes path traversal and
 * temporary-file cleanup non-problems rather than solved problems.
 */

/** An upload, as it arrives in memory. Never a path. */
export interface UploadedImportFile {
  filename: string
  contentType: string
  bytes: Buffer
}

export interface ReadImportFile {
  format: ImportSourceFormat
  /** SHA-256 of the bytes exactly as uploaded. */
  checksum: string
  header: string[]
  /** Data rows, header excluded, as trimmed text. */
  matrix: string[][]
}

/** The ZIP local file header every .xlsx really begins with. */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04])
/** U+FFFD — what appears when bytes are not the UTF-8 the template requires. */
const REPLACEMENT_CHARACTER = '�'

export async function readImportFile(file: UploadedImportFile): Promise<ReadImportFile> {
  if (file.bytes.length === 0) {
    throw new BadRequestError('MALFORMED_IMPORT_FILE', 'The uploaded file is empty')
  }
  if (file.bytes.length > MAX_IMPORT_FILE_BYTES) {
    throw new BadRequestError(
      'PAYLOAD_TOO_LARGE',
      `An import file may be at most ${Math.floor(MAX_IMPORT_FILE_BYTES / (1024 * 1024))} MB`,
    )
  }

  const format = resolveFormat(file)
  const checksum = createHash('sha256').update(file.bytes).digest('hex')

  const matrix = format === 'CSV' ? readCsv(file.bytes) : await readXlsx(file.bytes)

  const header = matrix[0]
  if (!header) {
    throw new BadRequestError('MALFORMED_IMPORT_FILE', 'The file has no header row')
  }

  return { format, checksum, header, matrix: matrix.slice(1) }
}

/**
 * What the file actually is.
 *
 * The extension says what it is called and the content type says what the browser
 * guessed; neither is evidence. Both are checked because a mismatch is worth
 * refusing on its own, and then the bytes decide: a `.csv` that begins with a ZIP
 * header is a spreadsheet wearing the wrong name, and is refused rather than
 * quietly parsed as either.
 */
function resolveFormat(file: UploadedImportFile): ImportSourceFormat {
  const name = file.filename.toLowerCase()
  const claimed = (Object.keys(IMPORT_FILE_EXTENSIONS) as ImportSourceFormat[]).find((format) =>
    name.endsWith(IMPORT_FILE_EXTENSIONS[format]),
  )

  if (!claimed) {
    throw new BadRequestError(
      'UNSUPPORTED_IMPORT_FORMAT',
      'An import must be a .csv or .xlsx file, named accordingly',
    )
  }

  const contentType = file.contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  if (contentType && !IMPORT_CONTENT_TYPES[claimed].includes(contentType)) {
    throw new BadRequestError(
      'UNSUPPORTED_IMPORT_FORMAT',
      `A ${IMPORT_FILE_EXTENSIONS[claimed]} upload was sent as ${contentType}`,
    )
  }

  const looksZipped = file.bytes.subarray(0, ZIP_MAGIC.length).equals(ZIP_MAGIC)

  if (claimed === 'XLSX' && !looksZipped) {
    throw new BadRequestError('MALFORMED_IMPORT_FILE', 'The file is named .xlsx but is not a workbook')
  }
  if (claimed === 'CSV' && looksZipped) {
    throw new BadRequestError('MALFORMED_IMPORT_FILE', 'The file is named .csv but is a compressed archive')
  }

  return claimed
}

function readCsv(bytes: Buffer): string[][] {
  if (bytes.includes(0)) {
    throw new BadRequestError('MALFORMED_IMPORT_FILE', 'The file contains binary data and is not text')
  }

  const text = bytes.toString('utf8')
  if (text.includes(REPLACEMENT_CHARACTER)) {
    // Refused rather than guessed at. Re-decoding an Arabic register under the
    // wrong code page produces plausible-looking names that are wrong, and a
    // wrong name on an identity record is worse than a rejected upload.
    throw new BadRequestError(
      'MALFORMED_IMPORT_FILE',
      'The file is not valid UTF-8. Save the register as UTF-8 CSV and upload it again.',
    )
  }

  try {
    return parseCsv(text).map((row) => row.map((cell) => cell.trim()))
  } catch (error) {
    if (error instanceof CsvLimitError) {
      throw new BadRequestError('MALFORMED_IMPORT_FILE', error.message)
    }
    throw error
  }
}

/**
 * The first worksheet of a workbook, as text.
 *
 * Only the first: a file whose second sheet holds the real register is a file
 * whose template is wrong, and silently concatenating sheets would make the row
 * numbers a reviewer sees meaningless.
 */
async function readXlsx(bytes: Buffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook()

  try {
    // exceljs's declarations were written against an older `Buffer`, whose type
    // parameter Node's now carries. The value is the same bytes either way.
    await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0])
  } catch {
    // The message is deliberately ours. A parser's own error text can carry
    // fragments of the file, and this one goes back over the API.
    throw new BadRequestError('MALFORMED_IMPORT_FILE', 'The workbook could not be read')
  }

  const sheet = workbook.worksheets[0]
  if (!sheet) throw new BadRequestError('MALFORMED_IMPORT_FILE', 'The workbook has no worksheets')

  const matrix: string[][] = []
  let overflowed = false

  sheet.eachRow({ includeEmpty: false }, (row) => {
    if (matrix.length > MAX_IMPORT_ROWS) {
      overflowed = true
      return
    }

    const cells: string[] = []
    // `cellCount` counts to the last populated column, which is what the row
    // actually claims rather than the sheet's nominal width.
    const width = Math.min(row.cellCount, MAX_IMPORT_COLUMNS + 1)
    for (let column = 1; column <= width; column += 1) {
      cells.push(cellText(row.getCell(column)))
    }

    matrix.push(cells)
  })

  if (overflowed || matrix.length > MAX_IMPORT_ROWS) {
    throw new BadRequestError('MALFORMED_IMPORT_FILE', `The file has more than ${MAX_IMPORT_ROWS} rows`)
  }
  if ((matrix[0]?.length ?? 0) > MAX_IMPORT_COLUMNS) {
    throw new BadRequestError('MALFORMED_IMPORT_FILE', `The file has more than ${MAX_IMPORT_COLUMNS} columns`)
  }

  return matrix
}

/**
 * One cell, as inert text.
 *
 * A formula cell is returned as its formula rather than its cached result, and
 * never evaluated. That is not squeamishness: the cached result is whatever the
 * machine that last saved the file computed, so trusting it means trusting a
 * number this system cannot derive or check. Downstream, a value beginning `=`
 * is refused as FORMULA_CELL — the register has to say what it means.
 */
function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value

  if (value === null || value === undefined) return ''

  if (value instanceof Date) return value.toISOString().slice(0, 10)

  if (typeof value === 'object') {
    if ('formula' in value || 'sharedFormula' in value) {
      const formula =
        'formula' in value ? value.formula : (value as ExcelJS.CellSharedFormulaValue).sharedFormula
      return truncate(`=${formula ?? ''}`)
    }
    if ('richText' in value) {
      return truncate(value.richText.map((part) => part.text).join(''))
    }
    if ('text' in value) return truncate(String(value.text))
    if ('error' in value) return truncate(String(value.error))
    return ''
  }

  return truncate(String(value))
}

/** Bounded here as well as in the CSV reader: a workbook can hold a novel in one cell. */
function truncate(value: string): string {
  const trimmed = value.trim()
  return trimmed.length > MAX_IMPORT_CELL_CHARACTERS + 1
    ? trimmed.slice(0, MAX_IMPORT_CELL_CHARACTERS + 1)
    : trimmed
}
