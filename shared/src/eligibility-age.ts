/** Calendar-age rules shared by every caller that needs immediate UX feedback.
 * The server remains the authority for the reference date. */
export const MINIMUM_APPLICATION_AGE = 19
export const MAHRAM_OPTIONAL_AGE = 45

/** Age in completed calendar years at a UTC calendar date. */
export function calculateAgeAt(dateOfBirth: Date, referenceDate: Date): number {
  let age = referenceDate.getUTCFullYear() - dateOfBirth.getUTCFullYear()
  const beforeBirthday =
    referenceDate.getUTCMonth() < dateOfBirth.getUTCMonth() ||
    (referenceDate.getUTCMonth() === dateOfBirth.getUTCMonth() &&
      referenceDate.getUTCDate() < dateOfBirth.getUTCDate())
  if (beforeBirthday) age -= 1
  return age
}

export function isAtLeastMinimumAge(
  dateOfBirth: Date,
  referenceDate: Date,
  minimum = MINIMUM_APPLICATION_AGE,
): boolean {
  return calculateAgeAt(dateOfBirth, referenceDate) >= minimum
}
