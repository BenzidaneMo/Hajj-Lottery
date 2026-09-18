# Pilgrim capacity

**The lottery quota is measured in pilgrims, not in application records.**

**A paired application is an indivisible two-pilgrim lottery group.**

**At each selection step, only groups that fit completely within the remaining
pilgrim capacity may be selected.**

Those three sentences are the whole of this document's subject. Everything below
explains why they are necessary, what enforces them, and what happens when a
quota cannot be filled exactly.

## Two units, and why conflating them was a real defect

An Algerian commune is allocated a number of **pilgrimage places**. That is what
`CommuneDraw.allocatedSpots` holds, and it is what the administration hands down.

The lottery's unit of _selection_ is an **application**. A citizen may apply
alone — one pilgrim — or a woman may apply with her Mahram, which is one
application carrying **two** pilgrims. See
[registration.md](registration.md) and [eligibility.md](eligibility.md) for the
pairing rule itself.

The two are different numbers, and the draw used to spend the first as if it were
the second. Twelve places, twelve application records selected:

```
selected sizes   [1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2]
                  9 single applications + 3 paired applications
                = 15 winning pilgrims
```

Fifteen people travelling on twelve places. Nobody decided that; arithmetic did.
The same error applied to the reserve list, so a commune's contingency cover was
equally unbounded.

The fix is not to select fewer records, and emphatically **not** to select too
many and then truncate — slicing a winner list down to twelve pilgrims would cut
a paired registration in half, making one traveller a winner and the other a
non-winner. Both are refused by construction:

```
NEVER   draw applications → expand to pilgrims → slice(0, quota)
```

## The rule

A draw fills two quotas, each of `allocatedSpots` **pilgrim places**: the winners,
then the reserves (`RESERVE_PILGRIMS_PER_SPOT` in `shared/src/reserves.ts` is
still 1, so `totalDrawPilgrimQuota(N)` is `2N` places). They are filled from one
continuous weighted sample without replacement — see
[lottery-engine.md](lottery-engine.md) and
[reserves-and-replacements.md](reserves-and-replacements.md), neither of whose
guarantees this changes.

At every step:

```
remainingCapacity = quota − placesAlreadyFilled
candidates        = unselected entries where pilgrimCount <= remainingCapacity
```

The existing weighted CSPRNG selection then runs over `candidates` exactly as it
always has: the candidates' weights are summed, one value is drawn from
`[0, thatTotal)`, and the entry whose cumulative slice contains it is selected.
Its pilgrims come off the remaining capacity, and the next step recomputes both
the candidate set and the total.

```
remaining = 1

candidate A → pilgrimCount 2   cannot fit, not a candidate this step
candidate B → pilgrimCount 2   cannot fit, not a candidate this step
candidate C → pilgrimCount 1   fits

draw over {C}  →  C selected  →  remaining = 0
```

A and B were **not** partially selected, not selected and discarded, and not
penalised. They were simply not eligible for that step.

### The capacity filter is an eligibility rule, not a weighting change

Nothing here scales, floors, halves or penalises a weight. The
`streak + 1` rule in [weighting.md](weighting.md) is untouched, a paired entry's
weight is `MAX(primary, secondary)` exactly as before, and a group that cannot
fit the last place keeps the weight it entered with and is a full candidate again
the moment there is room for it — including the whole of the reserve quota, which
opens with its own fresh capacity.

What the filter changes is _who is eligible at this step_, which is the same thing
removing an already-selected entry has always changed.

### Replay

`DrawSelectionEvent.activeTotalWeight` is the total of the entries that **fitted**
at that step, not of everything still unselected. That is the range the random
value was actually drawn from, so it is what an auditor must arrive at:
reconstruct the frozen pool, apply the prior selections, apply the quotas, take
the fitting subset, sum its weights. A stored total that included groups too large
to be selected would describe a range the draw never drew from.

Given the same pool, the same quotas and the same sequence of random values, the
result is identical. `lib/lottery.ts` still imports nothing and still obtains
every random value through the injected `RandomIntSource`; `Math.random` remains
banned repo-wide with a test enforcing it.

## When a quota cannot be filled exactly

There is exactly one way for a capacity-aware draw to fail: **one pilgrim place
remains and every unselected application is a pair.**

The algorithm must not split a pair, exceed the quota, invent a candidate,
truncate, or produce a short reserve list. So it refuses:
`lib/lottery.ts` throws `UnfillableQuotaError`, the service turns it into
`409 QUOTA_NOT_EXACTLY_FILLABLE`, and because execution is one transaction
([winner-processing.md](winner-processing.md)) **nothing at all is written** — no
winners, no `has_won_hajj`, no application outcomes, no audit row. The commune
draw stays `LOCKED`, which is the recoverable state.

Whether this is reachable depends on the draw order, not only on the pool. A pool
of nine single and three paired applications can fill twelve places many ways, and
can also strand the last one by spending all nine singles first. Two consequences
worth stating plainly:

- **Retrying is legitimate here, and is not a re-roll.** A failed execution
  records nothing and returns no winners, so an operator retrying has not seen an
  outcome they are choosing to reject. They are retrying an attempt that produced
  no result at all.
- **A pool with at least `2N` single applicants can never reach it.** The whole
  draw spends `2N` places, so fewer than `2N` singles can have been consumed at
  the moment one place remains, and one is therefore always available. Mixed test
  fixtures expected to complete are built to satisfy this.

A cheaper refusal comes first and is order-independent: if the pool's total
pilgrim capacity is below `2N` at all, the draw is refused up front as
`409 INSUFFICIENT_DRAW_ENTRIES`. A pool of `2N` _entries_ covers anywhere from
`2N` to `4N` places, so the entry count alone never answers this.

There is one open policy question this does **not** answer: see "Remaining
decisions" below.

## What enforces it

**The frozen pool carries its own capacity.** `draw_pools.pilgrim_count` is
stored and verified against the written entries inside the freeze transaction,
beside `entry_count` and `total_weight` — the same copy-and-verify pattern, for a
figure the draw now spends against. It is _derived_ from each entry's frozen
`entry_type`, which the snapshot hash already covers, so nothing was added to the
hash, `SNAPSHOT_VERSION` stays at 1, and every existing pool still verifies. The
draw re-derives it from the entries and refuses a pool whose stored figure
disagrees (`INVALID_POOL_SNAPSHOT`), exactly as it does for the other two
aggregates. `DrawPoolEntry` gained no column: `pilgrimCountOf(entryType)` in
`shared/src/pilgrims.ts` is the single place the 1-or-2 mapping lives.

**The result records both units.** `draw_results` gained
`winner_pilgrim_count`, `reserve_count` and `reserve_pilgrim_count` beside
`winner_count`. `reserve_count` is load-bearing rather than convenient: the
`assert_reserve_selection_shape()` trigger used to bound `reserve_position` and
`selection_order` by `winner_count`, which was the same number only while winners
and reserves were equal counts of rows. They are not any more — a twelve place
draw might record eleven winning and seven reserve applications — so the trigger
reads the recorded reserve count instead. For a pre-capacity result, where the two
coincide, it reduces to exactly the old rule.

**The quota invariant is a database fact.** A deferred constraint trigger
(`draw_results_pilgrim_capacity`) checks, at COMMIT, that the winner and reserve
rows as actually written cover exactly the pool's frozen `allocated_spots`, and
that the result's recorded counts describe its own rows. Deferred because execution
claims and writes the result before its winners, the same ordering
`commune_draws_completed_requires_result` exists for. `assertComplete` in
`DrawExecutionService` checks the same thing in the application layer, and the
publication integrity gate (`lib/result-integrity.ts`) checks it a third time
before a result can be announced — `ALLOCATION_MISMATCH`,
`WINNER_PILGRIM_COUNT_MISMATCH`, `RESERVE_PILGRIM_COUNT_MISMATCH`,
`RESERVE_ALLOCATION_MISMATCH`.

## Historical draws are not recalculated

`LOTTERY_ALGORITHM_VERSION` is now `weighted-csprng-capacity-v2`. Results recorded
under `weighted-csprng-v1` spent their quota in application records, so a v1 draw
with a paired winner legitimately has _more_ winning pilgrims than allocated
places. That is a faithful record of what that lottery did.

So nothing recomputes one. The integrity gate and the database trigger both branch
on the recorded `algorithm_version` (`isPilgrimCapacityAlgorithm` in
`shared/src/draw-result.ts`): a v1 result is held to the rule it actually ran
under — its _entry_ count against the allocation — and stays readable, publishable
and auditable exactly as recorded. Rewriting history to satisfy a rule that did
not exist when it ran would destroy the evidence of what happened.

## What the interfaces say

Both units are shown, separately labelled, wherever the distinction matters.
`DrawResultDto` carries `winnerCount`/`winnerPilgrimCount`,
`reserveCount`/`reservePilgrimCount` and
`activeWinnerCount`/`activePilgrimCount`; the admin result panel shows all six
beside the allocation. The pool screens distinguish "Pool applications" from
"Pilgrim places covered", and the freeze and execute dialogs state that a paired
application occupies two places rather than the old, now-false line that "one
selected application occupies one position".

Publicly, `PublicResultSummaryDto.winningParticipantCount` was already the pilgrim
figure and is the one to read against `allocatedSpots`; `winnerCount` is
applications and is normally smaller. No new field exposes anything it did not
before — no names, no weights, no internal ids, no pool internals. All copy goes
through the existing i18n keys in `ar`/`fr`/`en`.

## Remaining decisions

**A replacement need not be the same size as the place it vacates.** If a paired
winner gives up two places and the next reserve in the order is a single
applicant, promoting them fills one — the commune then holds eleven of its twelve
places, with the twelfth reopening only if somebody decides it should. The
ordering rule is unchanged and deliberately so: choosing a reserve _by size_ to
make the arithmetic come out would be choosing a winner, which is the one thing
the lottery exists to prevent. `activePilgrimCount` reports the real figure rather
than a reconciled one, and `ReserveService.assertPlacesReconcile` still refuses to
let a promotion award more places than the commune allocated. What should happen
to a part-vacated place is an open policy question, exactly like the
undersubscribed-commune question in [lottery-engine.md](lottery-engine.md), and it
is not resolved by any `Math.min`.
