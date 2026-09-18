/**
 * The two units the lottery counts in, and the conversion between them.
 *
 * This distinction is load-bearing and was, for several steps, wrong:
 *
 *   selection unit   an application / group   drawn whole, never split
 *   capacity unit    a pilgrim                what a commune is allocated
 *
 * `CommuneDraw.allocatedSpots` is a number of **pilgrimage places**, because
 * that is what an administration allocates to a commune. The lottery's unit of
 * selection is an *application*, which carries one pilgrim when a citizen
 * applies alone and two when a woman applies with her Mahram. The two numbers
 * are therefore different, and a draw that selects twelve applications for a
 * twelve place commune can award fifteen places — which is why the quota is
 * spent in pilgrims and only whole groups are selected.
 *
 * See docs/pilgrim-capacity.md.
 */

import type { EntryType } from './application.js'

/** A paired registration is one lottery group carrying two pilgrims. */
export const PILGRIMS_PER_PAIRED_ENTRY = 2

/** A single registration is one lottery group carrying one pilgrim. */
export const PILGRIMS_PER_SINGLE_ENTRY = 1

/**
 * How many pilgrims one application/group would place.
 *
 * Derived from the entry type, which every draw pool entry carries frozen and
 * which the snapshot hash already covers — so a draw's group sizes are part of
 * the immutable input it ran against, and nothing had to be added to the pool
 * to make capacity a first-class constraint.
 *
 * The one place this mapping lives. A second copy could disagree with the
 * pool's own `pilgrimCount` aggregate, and an entry counted as one pilgrim in
 * one place and two in another would let a quota be overspent invisibly.
 */
export function pilgrimCountOf(entryType: EntryType): number {
  return entryType === 'PAIRED' ? PILGRIMS_PER_PAIRED_ENTRY : PILGRIMS_PER_SINGLE_ENTRY
}
