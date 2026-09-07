/**
 * Ordering for wilayas and communes.
 *
 * Their codes are official numbers stored as text without leading zeros, so
 * `ORDER BY code` sorts them lexicographically: 1, 10, 11 … 19, 2, 20. People
 * know these places by their number — Alger is 16, Oran is 31 — and expect to
 * find them in that order, so the comparison is numeric.
 *
 * Sorted in the application rather than in SQL because Prisma cannot express
 * a cast inside `orderBy`, and the lists are small: 69 wilayas, and 1541
 * communes at the very most.
 *
 * Commune codes embed their wilaya (Alger's communes are 1601, 1602 …), so
 * ordering communes numerically also groups them by wilaya, in wilaya order,
 * without a join.
 */
export interface HasCode {
  code: string
}

export function byNumericCode(left: HasCode, right: HasCode): number {
  const difference = Number(left.code) - Number(right.code)
  // Fall back to text for anything non-numeric, so an unexpected code can
  // never collapse the ordering into NaN.
  if (Number.isNaN(difference)) return left.code.localeCompare(right.code)
  return difference
}

/** Convenience wrapper: returns a new array, leaving the input untouched. */
export function sortByCode<T extends HasCode>(places: T[]): T[] {
  return [...places].sort(byNumericCode)
}
