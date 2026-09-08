import type { ImportBatchStatus } from '@hajj-lottery/shared'

/**
 * What an import batch may do next.
 *
 * A lookup table rather than conditionals scattered through the service, for the
 * same reason the draw lifecycle is one: a transition that is not in the table
 * cannot happen, and reading the table is how somebody finds out what the
 * lifecycle actually is without tracing five call sites.
 *
 * The shape it encodes:
 *
 *   UPLOADED ──► VALIDATING ──► READY_FOR_REVIEW ──► APPROVED ──► IMPORTED
 *                     │                  │
 *                     └──► FAILED        └──► REJECTED
 *
 * Nothing leaves IMPORTED, REJECTED or FAILED. There is no un-import: an import
 * writes historical facts and lifetime exclusions, and a status that could be
 * walked back would imply those could be too. A batch that turned out to be wrong
 * is corrected through the historical correction workflow, which leaves the
 * original provenance intact — see docs/legacy-import.md.
 */
export const IMPORT_BATCH_TRANSITIONS: Record<ImportBatchStatus, readonly ImportBatchStatus[]> = {
  UPLOADED: ['VALIDATING'],
  VALIDATING: ['READY_FOR_REVIEW', 'FAILED'],
  READY_FOR_REVIEW: ['APPROVED', 'REJECTED'],
  APPROVED: ['IMPORTED'],
  REJECTED: [],
  IMPORTED: [],
  FAILED: [],
}

export function canTransitionBatch(from: ImportBatchStatus, to: ImportBatchStatus): boolean {
  return IMPORT_BATCH_TRANSITIONS[from].includes(to)
}

/** True once nothing further can happen to this batch. */
export function isTerminalBatchStatus(status: ImportBatchStatus): boolean {
  return IMPORT_BATCH_TRANSITIONS[status].length === 0
}
