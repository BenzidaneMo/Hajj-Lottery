# The draw pool

The boundary between mutable application data and the exact, fixed input a
lottery is run against.

## Why the draw never reads live applications

Everything upstream keeps moving. Verifying a legacy participation record next
week changes what a streak would be. An administrator correcting a historical
year changes it again. Eligibility is re-evaluated on demand and can turn over
when a participant is recorded as a past winner.

A lottery run directly against those rows could not be reproduced. Asked six
months later why a particular person was not selected, the honest answer would
be "we no longer know what the input was" — which is not an answer a public
draw can give.

So the moment a commune locks, exactly what will be drawn from is copied into a
pool, hashed, and never touched again.

```
Application ──▶ Eligibility ──▶ Weight ──▶ POOL FREEZE ──▶ DrawPoolEntry
                                                                  │
                                                                  ▼
                                                        future lottery engine
```

The draw engine, when it exists, will read **only** from `draw_pool_entries`.

## Validation is not freezing

|            | `validate-pool`            | `freeze-pool`          |
| ---------- | -------------------------- | ---------------------- |
| Writes     | nothing                    | the pool, and the lock |
| Answers    | could this be frozen?      | do it                  |
| Repeatable | freely                     | once                   |
| Who        | any administrator in scope | `SUPER_ADMIN`          |

Validation reports **every** blocker rather than the first, so an administrator
sees the whole picture instead of fixing one problem to uncover the next.

## Reconciliation: nothing is silently repaired

Validation does not simply read the stored values. For every candidate
application it **recomputes** the weight and **re-evaluates** eligibility, and
compares them with what is stored.

| Blocker                             | Means                                                   |
| ----------------------------------- | ------------------------------------------------------- |
| `COMMUNE_DRAW_NOT_READY`            | The commune draw is not `READY`                         |
| `REGISTRATION_STILL_OPEN`           | Its draw year is not `REGISTRATION_CLOSED`              |
| `POOL_ALREADY_EXISTS`               | This commune draw has already been frozen               |
| `NO_ELIGIBLE_APPLICATIONS`          | Nobody eligible applied                                 |
| `MISSING_WEIGHT`                    | An application's weight was never frozen                |
| `INVALID_WEIGHT`                    | A stored weight is not a usable positive integer        |
| `STALE_WEIGHT`                      | A frozen weight no longer matches a fresh calculation   |
| `APPLICATION_NOT_ELIGIBLE`          | An accepted application no longer evaluates as eligible |
| `PARTICIPANT_STATE_CONFLICT`        | A participant has since been recorded as a winner       |
| `INVALID_APPLICATION_STRUCTURE`     | Entry type and applicants disagree                      |
| `WRONG_COMMUNE` / `WRONG_DRAW_YEAR` | An application surfaced that belongs elsewhere          |

Every one of these **blocks the freeze and is reported**. None is repaired.

A stale weight in particular is left exactly as it is. Overwriting it would
rewrite the claim an application entered with, and doing so as a side effect of
freezing would hide the change completely. Re-freezing an application's weight
is an explicit, separate operation — see [weighting](weighting.md) — and it
does not exist yet.

`WRONG_COMMUNE` and `WRONG_DRAW_YEAR` are unreachable through the query, which
filters on both. They are asserted anyway: an application from the wrong
commune quietly entering a pool would be undetectable afterwards.

## When nobody applied

`NO_ELIGIBLE_APPLICATIONS` **blocks** the freeze. There is no empty pool, and a
database CHECK refuses one.

A commune where nobody eligible applied is not holding a lottery, and the
lifecycle already says that honestly: it is **`CANCELLED`**. Freezing an empty
pool would create a draw that exists on paper, can select nobody, and would
have to be special-cased by every later stage.

## Spots and entries are different numbers

```
Mesra:      12 spots,  843 eligible applications  →  843 entries
Commune C: 100 spots,   20 eligible applications  →   20 entries
```

The pool holds **every** eligible application, not a subset, and never fewer
than exist. `entry_count >= allocated_spots` is **not** required: a pool
smaller than the allocation is valid, and nothing here selects those 20
applicants. What a draw does with a surplus is the draw engine's decision.

## What an entry holds

| Field                                                | Why                                                               |
| ---------------------------------------------------- | ----------------------------------------------------------------- |
| `application_id`                                     | Associates a result back to the application                       |
| `application_reference`                              | The citizen-facing handle, copied so the pool reads without joins |
| `entry_type`                                         | `SINGLE` / `PAIRED`                                               |
| `primary_participant_id`, `secondary_participant_id` | Who the entry is for, internally                                  |
| `weight`                                             | The frozen `calculated_weight`, copied                            |

**No names, national IDs, dates of birth or phone numbers.** The draw does not
need to know who anybody is in order to choose between them, and a snapshot
designed to outlive everything else is the worst possible place to keep
identity. A test asserts those columns do not exist.

## The snapshot hash

SHA-256 over a deterministic serialization of the pool, stored with a
`snapshot_version` so a future format change can be told apart from tampering.

**Deliberately not JSON.** Object key order is a property of how an object was
built; two runs disagreeing about it would hash identical pools differently,
and an integrity check that fails at random is worse than none. The canonical
form writes every field out in a fixed order:

```
hajj-draw-pool/v1|<communeDrawId>|<communeId>|<drawYear>|<allocatedSpots>|<entryCount>
<applicationId>|<applicationReference>|<entryType>|<primaryId>|<secondaryId or ->|<weight>
… one line per entry, sorted by applicationId
```

Entries are **sorted by application id**, so the order the database returned
them in cannot change the result. A single applicant writes `-` rather than an
empty field, so they cannot be confused with a missing value. Separators cannot
occur in any value being serialized, and a value containing one is refused
rather than escaped — a fingerprint that can be made to collide on purpose is
not an integrity mechanism.

**The hash is not a random seed.** Deriving the draw's randomness from its input
would make the outcome a function of who entered, which is the opposite of a
lottery. It identifies and verifies; it never decides.

## Freezing is one transaction

```
BEGIN
  1. Claim the lock: UPDATE commune_draws SET status = LOCKED WHERE status = READY
     → no row matched? another freeze got there first; give up
  2. INSERT the pool  (UNIQUE on commune_draw_id serializes competing freezes)
  3. INSERT every entry
  4. Re-aggregate the written rows and check count and total weight agree
COMMIT
```

There can never be a locked commune draw with no pool, nor a pool whose commune
draw can still change, because both happen in the same transaction or neither
does.

Step 4 matters because nothing can repair the aggregates afterwards — they are
checked while a rollback is still possible, against the rows actually written
rather than the array they came from.

### Concurrency

Two administrators freezing the same commune draw simultaneously: the
conditional lock claim and the `UNIQUE(commune_draw_id)` constraint both
serialize them. One commits; the other rolls back entirely and is handed the
winner's pool. There are never two pools, partial entries, or an inconsistent
lock. A test fires three concurrent freezes and asserts exactly one pool with
the full set of entries.

### When it fails

Nothing is left behind: no pool, no entries, the commune draw still `READY`, no
application weight altered, no participant touched. The operation is safely
retryable once the blocking problem is corrected, and a test walks that path.

### Retrying after success

Returns the existing pool with `alreadyFrozen: true`, not an error. An
administrator retrying a request that worked should learn the outcome.

## Immutability

Enforced by the database, not merely by the absence of an endpoint:

```sql
CREATE TRIGGER draw_pools_immutable
  BEFORE UPDATE OR DELETE ON draw_pools ...
CREATE TRIGGER draw_pool_entries_immutable
  BEFORE UPDATE OR DELETE ON draw_pool_entries ...
```

Any UPDATE or DELETE raises an exception, including from code added carelessly
years from now. A frozen pool is the evidence of what a lottery was run
against, and evidence that can be edited is not evidence.

Every foreign key **RESTRICTs** — pool → commune draw, entry → pool,
application and participants. A historical pool cannot be made to vanish or go
partial by deleting something else. Nothing cascades.

### What becomes fixed at `LOCKED`

- `allocated_spots` (already true since [draw configuration](draw-configuration.md))
- the pool and every entry in it
- each entry's weight, entry type, application and participants

Later changes to history or weights **do not** reach the snapshot — a test
verifies an entry's weight after history moves underneath it.

Participants and applications are **not** globally frozen. A participant has a
life beyond this draw, and freezing the table would break every unrelated
future operation. Only the draw-relevant facts, copied here, are permanent.

There is **no unlock**. Not for anyone, including a `SUPER_ADMIN`. If an
exceptional override is ever needed it will be a deliberate workflow with an
audit trail, not a flag on this one.

## Authorization

|                 | Validate / inspect | Freeze  |
| --------------- | ------------------ | ------- |
| `SUPER_ADMIN`   | all                | ✓       |
| `WILAYA_ADMIN`  | their wilaya       | — (403) |
| `COMMUNE_ADMIN` | their commune      | — (403) |

Every route resolves the commune draw through the caller's scope **first**, so
a pool in another territory returns **404**, byte-identical to an id that was
never issued — the pool's existence is never disclosed, including through the
shape of an error.

Freezing is national because it fixes the terms of a lottery permanently, and
nobody should be able to close the input to a draw they are themselves subject
to.

**Nothing is public.** A frozen pool is the weighted input to a lottery;
publishing it would let anyone work out who is likely to be selected. Public
endpoints may later carry draw status, aggregate counts and published winners —
never the pool.

## Auditing

Freezing returns a structured `draw_pool.frozen` event: acting administrator,
commune draw, pool id, entry count, total weight, snapshot hash, timestamp.

Nothing persists it yet, and nothing logs it. The audit table does not exist,
and writing a fabricated row would be worse than having none. The shape is
fixed so that whatever eventually stores it needs no restructuring.

Pool contents are never logged, anywhere.

## Deferred

- **The draw itself.** No selection, no sampling, no randomness. Nothing reads
  `draw_pool_entries` yet.
- **Winner records**, publication, and `has_won_hajj` — still untouched by
  anything.
- **`COMPLETED`** on the commune draw lifecycle, which needs execution to be
  reachable.
- **Persistent audit logging**, and the `audit_logs` table.
- **Pre-draw weight recalculation** — the explicit operation that would clear a
  `STALE_WEIGHT` blocker.
- **Bulk freezing.** One commune at a time; nothing sweeps a wilaya.
- **An emergency unlock workflow.**
