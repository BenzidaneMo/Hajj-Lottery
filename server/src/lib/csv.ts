import { MAX_IMPORT_CELL_CHARACTERS, MAX_IMPORT_COLUMNS, MAX_IMPORT_ROWS } from '@hajj-lottery/shared'

/**
 * A deliberately small RFC 4180 reader, with the limits built in.
 *
 * Written here rather than taken from a package because what this needs is not
 * parsing so much as *refusing*: a hard ceiling on rows, on columns and on the
 * length of a single cell, applied while reading rather than after a permissive
 * parser has already materialised a gigabyte of arrays. A general CSV library
 * optimises for accepting whatever it is given, which is the opposite of what an
 * untrusted upload wants.
 *
 * The grammar is genuinely small: fields separated by commas, records by
 * newlines, and a field may be quoted, in which case a doubled quote is a
 * literal one. Everything else — comment syntaxes, escape characters, variable
 * delimiters, type inference — is absent on purpose. A register that needs them
 * is a register that should be saved as .xlsx.
 */

export class CsvLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CsvLimitError'
  }
}

const QUOTE = '"'
const DELIMITER = ','
/** UTF-8 byte order mark, which Excel writes and which is not part of the first header. */
const BOM = '\uFEFF'

/**
 * Reads a CSV document into rows of raw cell text.
 *
 * Nothing is coerced: every cell comes back as the string it was, because
 * deciding what `1` means is the template's job and not the reader's. Trailing
 * blank lines are dropped; a blank line in the middle is kept, so row numbers
 * still line up with the file an administrator is looking at.
 */
export function parseCsv(text: string): string[][] {
  const source = text.startsWith(BOM) ? text.slice(1) : text

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let index = 0

  const endField = () => {
    if (field.length > MAX_IMPORT_CELL_CHARACTERS) {
      throw new CsvLimitError(
        `Row ${rows.length + 1} has a cell longer than ${MAX_IMPORT_CELL_CHARACTERS} characters`,
      )
    }
    row.push(field)
    field = ''
    if (row.length > MAX_IMPORT_COLUMNS) {
      throw new CsvLimitError(`Row ${rows.length + 1} has more than ${MAX_IMPORT_COLUMNS} columns`)
    }
  }

  const endRow = () => {
    endField()
    rows.push(row)
    row = []
    if (rows.length > MAX_IMPORT_ROWS) {
      throw new CsvLimitError(`The file has more than ${MAX_IMPORT_ROWS} rows`)
    }
  }

  while (index < source.length) {
    const character = source[index] as string

    if (quoted) {
      if (character === QUOTE) {
        // A doubled quote inside a quoted field is one literal quote.
        if (source[index + 1] === QUOTE) {
          field += QUOTE
          index += 2
          continue
        }
        quoted = false
        index += 1
        continue
      }
      field += character
      index += 1
      continue
    }

    if (character === QUOTE && field.length === 0) {
      quoted = true
      index += 1
      continue
    }

    if (character === DELIMITER) {
      endField()
      index += 1
      continue
    }

    if (character === '\n' || character === '\r') {
      endRow()
      // Treat CRLF as one terminator rather than an empty second record.
      index += character === '\r' && source[index + 1] === '\n' ? 2 : 1
      continue
    }

    field += character
    index += 1
  }

  // An unterminated final record is still a record; a trailing newline is not.
  if (quoted || field.length > 0 || row.length > 0) endRow()

  while (rows.length > 0 && isBlank(rows[rows.length - 1])) rows.pop()

  return rows
}

function isBlank(row: string[] | undefined): boolean {
  return row !== undefined && row.every((cell) => cell.trim().length === 0)
}
