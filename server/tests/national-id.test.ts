import { describe, expect, it } from 'vitest'

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
