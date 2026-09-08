# The lottery engine

Weighted random selection: given a frozen pool and a number of places, which
entries are selected, and in what order.

## What it is allowed to know

The engine is a **consumer of the draw pool** and nothing else. It answers one
question:

> Given this frozen weighted pool and this configured number of spots, which
> entries are selected?

It does not evaluate eligibility, does not calculate a weight, does not read
`Application.calculated_weight`, does not touch `ParticipationHistory`, and does
not know anybody's name. Every one of those questions was asked and answered
before the pool was frozen — see [the draw pool](draw-pool.md) — and asking any
of them again here would make a draw depend on data that has moved since.

```
DrawPool (immutable)  ──▶  weightedSampleWithoutReplacement  ──▶  ordered entries
                                        ▲
                              RandomIntSource (CSPRNG)
```

Three files, with one responsibility each:

| File                                     | Holds                                                   |
| ---------------------------------------- | ------------------------------------------------------- |
| `server/src/lib/lottery.ts`              | The algorithm. Pure, and imports nothing at all.        |
| `server/src/lib/lottery-random.ts`       | The CSPRNG implementation of `RandomIntSource`.         |
| `server/src/services/lottery.service.ts` | Loads a locked draw's pool, verifies it, runs the draw. |

## Weighted sampling without replacement

Each round maps the entries still in play onto one contiguous integer range and
draws a single value inside it:

```
  A weight 2   B weight 5   C weight 3        total 10
  [0 1]        [2 3 4 5 6]  [7 8 9]

  r = 0..1 → A       r = 2..6 → B       r = 7..9 → C
```

The value is drawn from **[0, total)** and the winner is the first entry whose
cumulative weight _strictly exceeds_ it. So each entry owns exactly `weight` of
the `total` values, no value belongs to two entries, and no value belongs to
none:

| `r`         | Selects          |
| ----------- | ---------------- |
| `0`         | the first entry  |
| `total - 1` | the last entry   |
| `total`     | **cannot occur** |

`r = total` is the off-by-one that matters: it would make the final entry
unselectable while every draw still looked perfectly ordinary. An injected
source that returns it is **rejected**, not clamped.

The selected entry is then removed, the total recomputed, and the next value
drawn from the smaller range — which is what makes this sampling _without_
replacement. An entry cannot win twice, and every remaining entry's share of the
next round rises accordingly.

Removal preserves the order of the entries around it (rather than swapping the
last entry into the gap), so the mapping from a random value to an entry is as
legible on the tenth selection as on the first.

### Complexity

One linear scan per selection: O(winners × entries). For a commune — hundreds to
a few thousand entries, tens of places — that is nothing. A cumulative-weight
tree would be asymptotically better and considerably harder to read, and being
able to follow a draw's arithmetic by eye is worth more here than constant
factors. If a real pool ever makes it necessary, the algorithm is one function
behind one signature.

## Cryptographic randomness

Production randomness is `crypto.randomInt` — Node's cryptographically secure
uniform integer generator, which reads the platform CSPRNG and rejection-samples
internally, so no value is reachable more often than another through modulo
bias.

**`Math.random` is forbidden.** It is a fast non-cryptographic PRNG whose
internal state can be recovered from a handful of outputs; a lottery built on it
would let anybody who observed a few draws predict the next ones. A test scans
every server source file (with comments stripped, so a module may still explain
why it avoids it) and fails if the call appears anywhere.

The same reasoning rules out everything else that merely looks unpredictable:

| Not a source of randomness | Why                                        |
| -------------------------- | ------------------------------------------ |
| A timestamp                | Guessable to within milliseconds           |
| A UUID or a database id    | Not uniform, and often partly time-derived |
| A draw year, an entry id   | Public and fixed                           |
| **The pool's hash**        | See below                                  |

### The snapshot hash is not a seed

The pool carries a SHA-256 fingerprint, and this engine **recomputes and
verifies it** before drawing — but never seeds anything with it. Randomness
derived from the pool would make the outcome a pure function of who entered:
anybody holding the pool could compute the winners in advance, and nobody could
distinguish a real draw from one whose input had been arranged to produce a
chosen result. The hash establishes _what was drawn from_. It never decides
_who_.

## The random source abstraction

```ts
interface RandomIntSource {
  randomInt(maxExclusive: number): number // uniform in [0, maxExclusive)
}
```

One method, injected as a constructor dependency. That is the whole abstraction:
no container, no registry.

|            | Implementation                                     |
| ---------- | -------------------------------------------------- |
| Production | `cryptoRandomIntSource` — `crypto.randomInt`       |
| Tests      | a scripted sequence of values, defined in the test |

It is deliberately synchronous. `crypto.randomInt` has a synchronous form, and a
synchronous engine has no interleaving to reason about — a draw is one
uninterrupted sequence of decisions.

`lib/lottery.ts` **imports nothing**, which is the structural half of the
guarantee: the algorithm cannot obtain a random number, a timestamp or a
database row by itself, so the only entropy in a selection is the entropy handed
to it. A test asserts the file has no imports.

## Deterministic testing

Because randomness arrives through the interface, a test supplies a fixed
sequence and asserts an exact outcome:

```
entries A=1, B=2, C=3        values 0, then 2

  6 in play, r = 0  →  A          (A owns 0)
  5 in play, r = 2  →  C          (B owns 0-1, C owns 2-4)

  → [A, C], and the bounds the source was asked for were [6, 5]
```

Asserting the _bounds_ is what proves the first selection used the full pool
weight and the second recalculated it after removal.

A seeded PRNG never becomes the production source to make testing easier. The
source is injected precisely so that reproducing a draw in a test does not make
one predictable in reality.

There is one statistical test — 3000 draws from weights 1 and 9, asserting the
heavy entry wins between 75% and 99% of the time. It is deliberately loose and
explicitly **not authoritative**: the weighted mapping is pinned exactly by the
deterministic tests, and CI must never depend on the luck of a distribution.

## Total-weight safety

All arithmetic is integer. No floating point touches a weight, a cumulative
total or a random value, so there is nothing to round.

The ceiling is `MAX_TOTAL_ACTIVE_WEIGHT = 2^48 - 1`, the range
`crypto.randomInt` accepts. A real pool cannot approach it:

```
weight ≤ 1000                (CHECK constraint on the column)
2^48 - 1 ≈ 2.8 × 10^14
→ over 2.8 × 10^11 entries in one commune would be needed
  ≈ thirty times the world's population
```

So the simple bounded implementation is provably safe, and neither BigInt nor
hand-written rejection sampling is needed. The bound is still **asserted**, in
the engine and again in the random source: a total that silently exceeded the
generator's range would quietly bias the draw, and a biased lottery that still
returns plausible winners cannot be detected from its output. Failing loudly is
the only acceptable behaviour.

Every weight is separately checked to be a positive safe integer. A zero-weight
entry would sit in the pool and be structurally unselectable — an eligibility
decision made by arithmetic, which only [the eligibility rules](eligibility.md)
may make.

## What the engine refuses

Before any random number is drawn:

| Refusal                     | Condition                                           |
| --------------------------- | --------------------------------------------------- |
| `COMMUNE_DRAW_NOT_FOUND`    | No such commune draw                                |
| `DRAW_NOT_LOCKED`           | The commune draw is `DRAFT`, `READY` or `CANCELLED` |
| `POOL_NOT_FOUND`            | Locked, but nothing was frozen                      |
| `INVALID_POOL_SNAPSHOT`     | The pool does not verify (see below)                |
| `INSUFFICIENT_DRAW_ENTRIES` | Fewer entries than allocated places                 |

Plus, from the pure engine, as thrown assertions rather than API errors: an
empty pool, a duplicated entry, a non-positive or fractional weight, a total
beyond the ceiling, a winner count that is not a positive integer, and a random
source that answers outside its contract.

### Only a locked draw

`LOCKED` is the only state whose input cannot still change. A `DRAFT` or `READY`
commune draw is still taking applications and can still be reallocated; a
`CANCELLED` one is not holding a lottery at all. `COMPLETED` deliberately still
does not exist — see [draw configuration](draw-configuration.md) — and a
selection does **not** move the commune draw anywhere. Concluding a draw belongs
to winner processing.

### Verifying the snapshot

The engine re-checks, every time, that the pool still says what it said when it
was frozen: the stored `entry_count` and `total_weight` against the rows actually
loaded, the `snapshot_version` against the canonical form this build knows, and
the recomputed SHA-256 against the stored hash.

Database triggers already make the pool immutable, so this cannot fail through
any supported path — which is exactly why it is checked. Triggers block `UPDATE`
and `DELETE`, not `INSERT`; a pool assembled by some route nobody anticipated
would otherwise be drawn from as though it were genuine, and afterwards nothing
would distinguish that draw from a legitimate one. A test inserts a pool with a
wrong fingerprint and confirms the draw refuses it.

### Insufficient entries: a policy boundary

Freezing accepts a pool smaller than the allocation on purpose — 100 places with
20 eligible applicants is a valid pool, and registration never refuses somebody
for being oversubscribed. So this situation is **reachable**, and the engine
**refuses it** with `INSUFFICIENT_DRAW_ENTRIES` rather than truncating.

Quietly selecting all 20 would answer a question the domain has not been asked:
_does an undersubscribed commune award every applicant a place automatically?_
That is a real decision with real consequences — it makes applying to a quiet
commune strictly better than applying to a busy one — and it belongs to whoever
sets policy, not to a `Math.min` inside a sampling function. The refusal is where
the question surfaces.

When the answer arrives it will be explicit: either the allocation must be
fulfilled (and an undersubscribed commune is handled administratively, as
`CANCELLED` already handles an empty one), or drawing everybody is a documented
rule with a name. Until then, nothing is decided by accident.

## No side effects, and no route

A selection writes **nothing**:

- no winner records, and no `winners_archive` — the table does not exist
- `has_won_hajj` is untouched, on everybody
- no application, participant or history row is modified
- the pool is not mutated: the algorithm copies the array it is given
- the commune draw's status does not change
- nothing is published, notified, or logged

A test captures every one of those tables before a draw and asserts byte
equality afterwards.

**There is no HTTP endpoint.** Not a public one, and not an admin one. A test
signs in as `SUPER_ADMIN` and confirms that every plausible draw route 404s.

The reason is repeat-execution safety. Since nothing is persisted, two calls
produce two different, equally authoritative sets of winners for the same
commune — and an endpoint would let an administrator re-roll until they liked the
outcome, which is precisely the attack a public lottery must not permit. A guard
against that needs a record that a draw has already been run, and that record is
part of winner processing. So the engine stays a service without a route, the way
`ParticipationHistoryService.correct()` waits for its approval workflow. A test
demonstrates the problem honestly: it runs the same pool six times and asserts
the outcomes differ.

When execution does become reachable it will be `SUPER_ADMIN`-only and
transactional — claiming the right to run the draw and recording its result in
the same commit that produces it, exactly as pool freezing claims the lock and
writes the pool together.

## Reproducibility

A winner result must be reproducible from three things:

1. the frozen `DrawPool` (identified and verified by its hash),
2. the approved configuration (`allocated_spots`, frozen into the pool), and
3. the random selection events.

The engine returns the third:

```
Selection #1:  totalActiveWeight = 1234,  randomValue = 876  →  entry-17
Selection #2:  totalActiveWeight = 1127,  randomValue = 414  →  entry-204
```

Given these, anybody can replay the arithmetic and confirm each winner without
trusting the software that produced them. Nothing persists them yet, and nothing
is exposed publicly — a fabricated audit trail would be worse than none. The
shape is fixed so that whatever eventually stores it needs no restructuring.

The winner count is taken from the **pool's** frozen `allocated_spots`, not from
a caller and not from the live commune draw. `selectFromPool(communeDrawId)` has
nowhere to pass a number, so no request can influence how many people win.

## Entry order

Entries are loaded with an explicit `ORDER BY application_id` — the same order
the snapshot hash was computed over. Database row order is arbitrary, and a draw
must never depend on it: randomness decides who is selected, not the query
planner. It also makes deterministic fixtures possible, since a scripted random
value maps onto a known entry.

Input order cannot affect the probabilities in any case — each entry owns exactly
its own weight of the range however the entries are traversed — and a test proves
it by drawing every value in `[0, total)` under two different orderings and
comparing the resulting shares.

## Deferred

- **Winner records.** Nothing is persisted; `has_won_hajj` is still set by
  nothing at all.
- **An executable endpoint**, and with it the repeat-execution guard and a
  `COMPLETED` state.
- **Persistent audit and public verification** of the selection events.
- **The insufficient-entries policy** — currently a refusal, deliberately.
- **Result publication**, notifications, and the live draw visualizer.
- **Bulk execution.** One commune at a time; nothing sweeps a wilaya.
