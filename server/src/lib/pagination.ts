import { ADMIN_PAGE_SIZE_DEFAULT, ADMIN_PAGE_SIZE_MAX } from '@hajj-lottery/shared'

/**
 * One bounded page of an admin listing.
 *
 * The shape every paginated admin endpoint returns — extracted here so a
 * second scoped service (commune draws, alongside applications and
 * participants) doesn't redefine the same envelope and clamping logic.
 */
export interface Page<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

/** Clamps a requested page size into the range the API will serve. */
export function boundedPaging(page: number | undefined, pageSize: number | undefined) {
  const size = Math.min(Math.max(pageSize ?? ADMIN_PAGE_SIZE_DEFAULT, 1), ADMIN_PAGE_SIZE_MAX)
  const current = Math.max(page ?? 1, 1)
  return { skip: (current - 1) * size, take: size, page: current, pageSize: size }
}

export function paged<T>(items: T[], total: number, page: number, pageSize: number): Page<T> {
  return { items, page, pageSize, total, totalPages: Math.max(Math.ceil(total / pageSize), 1) }
}
