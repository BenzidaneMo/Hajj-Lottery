import { describe, expect, it } from 'vitest'

import { limitToDigits, NATIONAL_ID_LENGTH } from '@hajj-lottery/shared'

import { isValidNationalId, normalizeNationalId } from '../src/lib/national-id.js'

const VALID = '112233445566778899'

describe('normalizeNationalId', () => {
  it('leaves an already-canonical ID untouched', () => {
    expect(normalizeNationalId(VALID)).toBe(VALID)
  })

  it('preserves leading zeros', () => {
    expect(normalizeNationalId('000000000000000001')).toBe('000000000000000001')
  })

  it('strips the separators people type', () => {
    expect(normalizeNationalId('  1122-3344 5566.7788/99  ')).toBe(VALID)
  })

  it('folds Arabic-Indic digits to ASCII', () => {
    expect(normalizeNationalId('١١٢٢٣٣٤٤٥٥٦٦٧٧٨٨٩٩')).toBe(VALID)
  })

  it('folds extended (Persian) digits to ASCII', () => {
    expect(normalizeNationalId('۱۱۲۲۳۳۴۴۵۵۶۶۷۷۸۸۹۹')).toBe(VALID)
  })

  it('removes the bidi marks an RTL keyboard can leave behind', () => {
    expect(normalizeNationalId('‏112233445566778899‎')).toBe(VALID)
  })

  it('does not invent digits for non-numeric input', () => {
    expect(normalizeNationalId('abc')).toBe('abc')
  })
})

describe('isValidNationalId', () => {
  it('accepts exactly 18 digits', () => {
    expect(isValidNationalId(VALID)).toBe(true)
  })

  it('rejects too few and too many digits', () => {
    expect(isValidNationalId('12345')).toBe(false)
    expect(isValidNationalId('1'.repeat(19))).toBe(false)
  })

  it('rejects non-digit characters', () => {
    expect(isValidNationalId('11223344556677889X')).toBe(false)
  })

  it('rejects an empty string', () => {
    expect(isValidNationalId('')).toBe(false)
  })
})

describe('limitToDigits', () => {
  it('keeps at most the requested number of digits', () => {
    expect(limitToDigits('12345678901234567890', 18)).toBe('123456789012345678')
    expect(limitToDigits('123', 18)).toBe('123')
  })

  it('drops anything that is not a digit', () => {
    expect(limitToDigits('11-22 33.44/55', 18)).toBe('1122334455')
    expect(limitToDigits('abc123def', 18)).toBe('123')
  })

  it('counts Arabic-Indic digits and leaves them in their own script', () => {
    // The registration field must not rewrite what an Arabic keyboard typed.
    expect(limitToDigits('١١٢٢٣٣٤٤٥٥٦٦٧٧٨٨٩٩٩٩', 18)).toBe('١١٢٢٣٣٤٤٥٥٦٦٧٧٨٨٩٩')
    expect(limitToDigits('١٢٣', 18)).toBe('١٢٣')
  })

  it('stops a 19th digit from being typed into an 18-digit field', () => {
    const eighteen = '1'.repeat(NATIONAL_ID_LENGTH)

    expect(limitToDigits(`${eighteen}9`, NATIONAL_ID_LENGTH)).toBe(eighteen)
  })
})
