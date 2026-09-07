import { describe, expect, it } from 'vitest'

import { sortByCode } from '../src/lib/geo-order.js'

describe('geographic ordering', () => {
  it('orders codes by number, not as text', () => {
    const codes = ['10', '2', '1', '31', '9', '16']

    expect(sortByCode(codes.map((code) => ({ code }))).map((p) => p.code)).toEqual([
      '1',
      '2',
      '9',
      '10',
      '16',
      '31',
    ])
  })

  it('groups communes by wilaya, because their codes embed it', () => {
    // 9xx belongs to wilaya 9, 10xx to wilaya 10 — numeric ordering keeps
    // them apart and in wilaya order without a join.
    const codes = ['1001', '901', '1002', '925']

    expect(sortByCode(codes.map((code) => ({ code }))).map((p) => p.code)).toEqual([
      '901',
      '925',
      '1001',
      '1002',
    ])
  })

  it('falls back to text for a non-numeric code rather than collapsing', () => {
    const codes = [{ code: 'B' }, { code: 'A' }]

    expect(sortByCode(codes).map((p) => p.code)).toEqual(['A', 'B'])
  })
})
