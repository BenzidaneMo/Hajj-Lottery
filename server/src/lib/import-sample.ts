import { OPTIONAL_IMPORT_COLUMNS, REQUIRED_IMPORT_COLUMNS, type ImportColumn } from '@hajj-lottery/shared'
import ExcelJS from 'exceljs'

/**
 * The downloadable import template — a CSV and an XLSX, generated on request
 * rather than checked in as static files.
 *
 * Both are built directly from `REQUIRED_IMPORT_COLUMNS`/`OPTIONAL_IMPORT_COLUMNS`,
 * the same constants `import-validation.ts` enforces against, so the sample can
 * never drift from what an upload actually requires. The example rows use real
 * seeded commune codes (Adrar wilaya) and otherwise-fabricated values shaped to
 * pass every check a real row would face — an administrator can upload the
 * downloaded file unmodified and see it validate.
 */

const COLUMNS: ImportColumn[] = [...REQUIRED_IMPORT_COLUMNS, ...OPTIONAL_IMPORT_COLUMNS]

type SampleRow = Record<ImportColumn, string>

const SAMPLE_ROWS: SampleRow[] = [
  {
    national_id: '123456789012345678',
    full_name: 'Ahmed Benali',
    dob: '1975-03-14',
    commune_code: '101',
    draw_year: '2019',
    participated: 'oui',
    won: 'non',
    phone_number: '0555123456',
    notes: 'Example row — replace with real register data.',
    registered_at: '2019-03-01',
    gender: 'MALE',
  },
  {
    national_id: '987654321098765432',
    full_name: 'Fatima Kaddour',
    dob: '1970-11-02',
    commune_code: '102',
    draw_year: '2021',
    participated: 'oui',
    won: 'oui',
    phone_number: '',
    notes: '',
    registered_at: '2021-03-15',
    gender: 'FEMALE',
  },
]

function cell(row: SampleRow, column: ImportColumn): string {
  return row[column]
}

/** A UTF-8 CSV, header first, quoting only where a value actually needs it. */
export function buildSampleCsv(): string {
  const lines = [COLUMNS, ...SAMPLE_ROWS.map((row) => COLUMNS.map((column) => cell(row, column)))]
  return lines.map((line) => line.map(csvField).join(',')).join('\r\n') + '\r\n'
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** The same template as a workbook, with the header frozen and bolded. */
export async function buildSampleWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Import')

  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.columns = COLUMNS.map((column) => ({ header: column, key: column, width: 20 }))
  sheet.getRow(1).font = { bold: true }

  for (const row of SAMPLE_ROWS) {
    sheet.addRow(COLUMNS.map((column) => cell(row, column)))
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
