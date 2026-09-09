import type { PublicPlaceDto, PublicWinnerDto } from '@hajj-lottery/shared'
import type { EntryType } from '@prisma/client'

/**
 * The boundary between what the database holds and what the public is shown.
 *
 * Every public response is built here, field by field, from an explicitly listed
 * set of columns. Nothing is spread, nothing is serialized wholesale, and no
 * Prisma model ever reaches `res.json` — because the moment one does, a column
 * added to that model months from now becomes public without anybody deciding it
 * should be. A `Participant` gaining a field is a schema change; a
 * `PublicPlaceDto` gaining one has to be typed out in this file.
 *
 * That is also why these take structural parameters rather than Prisma types:
 * the input is the handful of fields the mapper is allowed to see, so a caller
 * that loaded more cannot accidentally pass it through.
 */

/**
 * A place, by its official code.
 *
 * The internal `id` is deliberately dropped. It is in every admin DTO and in no
 * public one: citizens address a commune by the number on official
 * correspondence, and an opaque database id in a public payload is an invitation
 * to enumerate them.
 */
export function toPublicPlace(place: {
  code: string
  nameAr: string
  nameFr: string
  nameEn: string
}): PublicPlaceDto {
  const { code, nameAr, nameFr, nameEn } = place
  return { code, nameAr, nameFr, nameEn }
}

/**
 * One published winner.
 *
 * The entry's weight is not a parameter, so it cannot be published by mistake:
 * a weight is how many years that household had been passed over, and it is
 * nobody else's business. `participantCount` comes from the entry type rather
 * than from a participant id, so no identifier is loaded to compute it.
 */
export function toPublicWinner(winner: {
  selectionOrder: number
  applicationReference: string
  entryType: EntryType
}): PublicWinnerDto {
  return {
    selectionOrder: winner.selectionOrder,
    applicationReference: winner.applicationReference,
    entryType: winner.entryType,
    participantCount: winner.entryType === 'PAIRED' ? 2 : 1,
  }
}

/** One bounded page's envelope, from a total and the window that was read. */
export function toPublicPage<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): { items: T[]; page: number; pageSize: number; total: number; totalPages: number } {
  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}
