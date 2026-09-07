# Weighting

How much of a chance an eligible application gets. Derived from verified
participation history, frozen onto the application as a snapshot, and used by
nothing yet — the draw does not exist.

## Three questions, three engines

|               | Asks                                   | Lives in                   |
| ------------- | -------------------------------------- | -------------------------- |
| Eligibility   | May this application take part at all? | `lib/eligibility-rules.ts` |
| **Weighting** | **How strong is its claim?**           | **`lib/weight-rules.ts`**  |
| Selection     | Who actually gets a place?             | Does not exist             |

Weighting is separate from eligibility because they fail differently. An
ineligible application is _refused_; a weak one is _accepted with a small
claim_. Collapsing them — by giving an ineligible application a weight of zero
— would make eligibility a matter of arithmetic, and a rounding change or a
stray `>=` would silently start admitting people the rules exclude.

It is separate from selection because a weight is a **fact derived from
history**, not a prediction. The same history must always produce the same
weight; the same weight must not always produce the same winner. Keeping the
deterministic half apart from the random half is what makes the draw auditable
later.

## Individual weight

```
weight = historical streak + 1
```

The streak is the consecutive verified, participating, non-winning years
immediately before the target draw year. The weight is that, plus one:

| Streak | Weight |
| ------ | ------ |
| 0      | 1      |
| 1      | 2      |
| 5      | 6      |

```
2023 ✓  2024 ✓  2025 ✓     → target 2026, streak 3, weight 4
```

Taking part at all earns the baseline of 1; each consecutive year of having
applied and been passed over adds one on top.

### Why added, not floored

The baseline is **added** to the streak rather than used as a minimum. A floor
would leave a first-time applicant and a once-passed-over applicant both at 1,
so the first year of patience would count for nothing — the very thing
weighting exists to recognise.

It also keeps zero out of the domain entirely. A weight of zero would make
somebody undrawable — ineligible by arithmetic rather than by the eligibility
rules, which is precisely the confusion this design keeps apart. A CHECK
constraint on the column enforces the same thing at the database level.

### The streak is not recalculated here

It comes from the participation ledger and is **reused, not reimplemented**.
Two copies of "which years count" would eventually disagree, and the ledger's
copy is the one carrying the tests about missing years. So everything
documented in [participation history](participation-history.md) applies
unchanged: a missing year, an unverified record, a known absence and a win each
stop the count, and the target year itself is never included.

That policy is load-bearing here. An unreviewed legacy import cannot raise
anybody's weight, because it never reaches the streak in the first place.

## Paired applications: MAX

The higher of the two applicants' weights — each already being their own
streak plus one.

| Primary streak → weight | Secondary streak → weight | Application |
| ----------------------- | ------------------------- | ----------- |
| 5 → 6                   | 3 → 4                     | **6**       |
| 3 → 4                   | 5 → 6                     | **6**       |
| 4 → 5                   | 4 → 5                     | **5**       |
| 4 → 5                   | 0 → 1                     | **5**       |

A pair travels together and shares one outcome, so pairing with somebody newer
must not cost a long-waiting applicant the claim they have accumulated. The
alternatives are worse: an average would punish the patient one for their
partner, and a sum would turn pairing into a way to buy chances.

A `PAIRED` application whose partner is missing is refused rather than weighed
on one person — eligibility already rejects that shape, so reaching the weight
engine would mean the two disagree, and failing loudly beats quietly halving
someone's claim.

## Streak versus weight

|        | Streak                            | Weight                           |
| ------ | --------------------------------- | -------------------------------- |
| About  | A person                          | An application                   |
| Is     | A count of years                  | That count, plus one             |
| Source | Derived from history, always live | Calculated, then frozen          |
| Stored | **Never**                         | `applications.calculated_weight` |

The streak is never persisted on a participant — see
[why there is no `consecutive_years` column](participation-history.md). The
weight _is_ persisted, but on the application, because it answers a different
question: not "how long has this person waited?" but "what claim did this
application enter the draw with?"

## The snapshot

```
calculated_weight = NULL   never frozen
calculated_weight = 4      this application entered with a claim of 4
```

`calculateApplicationWeight()` reads and returns. `freezeApplicationWeight()`
calculates and writes. The naming is the contract: no operation mutates the
database unless it says it does, so inspecting a weight — including through the
admin endpoint — can never freeze one.

**An already-frozen weight is never overwritten.** Freezing again returns the
stored value untouched.

### Why a later correction does not rewrite it

```
Application for 2027 frozen at 5   (streak 4, plus one)
   ↓
A 2024 legacy record is verified in March
   ↓
The live streak would now be 5, so the weight would be 6
   ↓
The application's frozen weight is still 5
```

This is deliberate. The snapshot records the claim the application _entered
with_, and a draw run against weights that shift underneath it is not
reproducible or defensible. An administrator can see the divergence — the
inspection endpoint returns the frozen weight, a fresh calculation and whether
they still agree — but nothing acts on it automatically.

Re-freezing after a correction is a **pre-draw recalculation workflow**. It
belongs with the draw lifecycle and is deferred.

### Concurrency

The write is a compare-and-set on `calculated_weight IS NULL`. Two simultaneous
freezes cannot store two different values: the loser finds nothing to update
and reads back what the winner wrote. The persisted weight stays a single
authoritative number without needing a lock.

## Validation

A weight is an integer, positive, and bounded. `calculated_weight` is an
`INTEGER` column (it was `DECIMAL(12,6)` as a placeholder before anything
computed it) with `CHECK (calculated_weight IS NULL OR BETWEEN 1 AND 1000)`.

The upper bound is an overflow guard rather than a domain rule: a streak cannot
structurally exceed the span of years the ledger can express — `draw_year` is
constrained to 2000–2200, so about 200, and a weight is one more than that —
and 1000 leaves headroom while still refusing a value that could only come from
corrupt input. The rules refuse a non-integer, negative or out-of-range streak
rather than turning it into a weight nobody notices is wrong.

## Who may see a weight

|                 | Application weight | Per-applicant breakdown |
| --------------- | ------------------ | ----------------------- |
| `SUPER_ADMIN`   | ✓                  | ✓                       |
| `WILAYA_ADMIN`  | ✓ in their wilaya  | —                       |
| `COMMUNE_ADMIN` | ✓ in their commune | —                       |

The application's own weight belongs to whoever administers the application:
the draw is commune-scoped, so a commune's administrator must be able to see
the weights in their own pool. Scope is applied as a query filter, so an
application in another territory returns 404, byte-identical to an id that was
never issued.

The **breakdown** — what each applicant contributed — is withheld from scoped
administrators, because a person's participation history may span communes the
caller has no claim on. Weight inspection must not become a side channel into
another commune's ledger, and the same reasoning withholds the streak itself in
[participation history](participation-history.md).

**A known limit of that line:** for a `SINGLE` application, the weight is the
applicant's streak plus one, so a commune administrator can subtract and
recover the streak — including years that happened elsewhere. This is inherent to a commune-scoped weighted draw:
you cannot run one without knowing the weights in your own pool. What is
prevented is learning about people whose applications are not yours, and
learning how a pair's weight was composed.

There is **no public weight endpoint**. Whether a citizen sees their own weight
is a product decision, not a technical default, and it is not made here.

## Deferred

- **The draw.** No selection, no sampling, no randomness, no spot allocation.
  Nothing reads `calculated_weight` yet.
- **Pre-draw recalculation** — deliberately re-freezing weights after
  historical corrections, and the pool-freeze lifecycle that would authorize it.
- **Bulk freezing.** Weights are frozen one application at a time; nothing
  sweeps a commune.
- **A citizen-facing weight.**
- **Winner processing**, still the only thing that may ever set `has_won_hajj`.
