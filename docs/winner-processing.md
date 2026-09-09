# Winner processing

Turning a frozen pool into winners: one transaction, once, irreversibly.

## What execution has to guarantee

Every failure mode here is one somebody would have to resolve by hand, against
people who have already been told they won. So all four of these are impossible
rather than merely unlikely:

| Never                                               | Prevented by                                    |
| --------------------------------------------------- | ----------------------------------------------- |
| A winner recorded, but not excluded for life        | One transaction                                 |
| Somebody excluded, with no winner record            | One transaction                                 |
| A draw marked complete, with winners missing        | One transaction + a deferred constraint trigger |
| A result that exists, and a draw that can run again | `UNIQUE(commune_draw_id)` + the status claim    |

## The lifecycle

```
DRAFT ──▶ READY ──▶ LOCKED ──▶ COMPLETED
   │        │          │
   └────────┴──▶ CANCELLED
```

`COMPLETED` was deliberately absent until now — see
[draw configuration](draw-configuration.md) — because nothing could reach it. It
is terminal, and there is no route back for anybody: a concluded lottery has told
people they won, and taking that back needs a correction workflow with approval
and an audit trail, which does not exist.

**There is no `DRAW_IN_PROGRESS`,** and its absence is deliberate. The selection
is pure in-memory arithmetic over rows already loaded in the transaction — no
external calls, no waiting — so the entire draw fits inside one transaction. An
intermediate status inside that transaction would be invisible to every other
reader (they block on the row, then see the committed outcome) and undone by any
failure. It would be a lifecycle value nothing could ever observe, which is the
same reason `COMPLETED` itself stayed out until it became reachable.

What that state is usually _for_ — knowing a process died mid-draw — is handled
better here by the transaction: a crash rolls the status back to `LOCKED`, which
is exactly the safe, retryable state, with no partial result to clean up and no
stale claim for an administrator to unpick.

## The execution claim

Concurrency is settled by the database, never by this process:

```sql
UPDATE commune_draws SET status = 'COMPLETED'
 WHERE id = $1 AND status = 'LOCKED'
```

A conditional update rather than a check followed by a write. Two executions
arriving together serialize on the row: the second blocks until the first
commits, re-evaluates its `WHERE`, matches nothing, and is told
`DRAW_ALREADY_COMPLETED`. No second random selection can become authoritative.

An in-memory mutex would work only until a second API instance existed, which is
why there isn't one. This is the same pattern pool freezing uses to claim
`READY → LOCKED`.

The claim happens **first**, before the pool is even read, so nothing expensive
runs on a draw somebody else already owns.

```
BEGIN
  1. read the commune draw          (so a refusal can name the real state)
  2. claim LOCKED → COMPLETED       (conditional; 0 rows means give up)
  3. load the pool and its entries  (inside this transaction)
  4. verify the snapshot hash, aggregates and version
  5. refuse if entries < allocated spots
  6. run the selection              (pure, CSPRNG)
  7. insert the result, winners and selection events
  8. insert the winner archive, one row per winning person
  9. set has_won_hajj on every winning person
 10. finalize the pooled applications: SELECTED / NOT_SELECTED
 11. write participation history for everybody in the pool
 12. re-count what was written and refuse to commit unless it is whole
COMMIT
```

Steps 3–5 are the same verification the read-only draw performs, running through
the transaction's own client — so the pool cannot be seen one way by the check and
another by the draw. Step 6 is [the lottery engine](lottery-engine.md), untouched:
no weight is recalculated, no eligibility re-evaluated, no history read to
influence who wins.

## What gets written

| Record               | One per            | Key invariant                                                   |
| -------------------- | ------------------ | --------------------------------------------------------------- |
| `DrawResult`         | commune draw       | `UNIQUE(commune_draw_id)`, `UNIQUE(draw_pool_id)`               |
| `DrawWinner`         | selected entry     | `UNIQUE(draw_pool_entry_id)`, `UNIQUE(result, selection_order)` |
| `DrawReserve`        | reserve position   | `UNIQUE(result, reserve_position)`, positions `1..N`            |
| `DrawSelectionEvent` | selection          | `CHECK(0 <= random_value < active_total_weight)`                |
| `WinnerArchive`      | winning **person** | `UNIQUE(participant_id)` — one win per life                     |

A draw for `N` places selects `2N` entries in one continuous sample: the first
`N` become `DrawWinner` rows and the rest become the ordered reserve list. There
is one selection event for each of the `2N`, so the reserve order is as checkable
as the winner order. See
[reserves-and-replacements.md](reserves-and-replacements.md) — a reserve holds no
place, gets no archive row and is **not** excluded from future draws by having
been drawn as one.

`DrawResult` carries the pool's hash, the total weight it drew from, and
`algorithm_version` — a fixed identifier like `weighted-csprng-v1`, never a moving
label like "latest". A result whose algorithm cannot be pinned down is not
reproducible, and reproducibility is the whole claim.

It has **no status column**: a result row exists only when a draw completed, so a
status could only ever read `COMPLETED`. The lifecycle lives on the commune draw,
and a second copy of it here could disagree with the first.

Nothing stores the number of _winning people_ either — it is `COUNT(*)` over the
archive, and a stored copy could drift from the rows it summarizes.

### Identity stays out

No names, national IDs, dates of birth or phone numbers, in any of the four
tables — a test pins those columns out. Internal ids only, and the administrative
API identifies a winner by their application reference, exactly as the pool
listing does. Who a winner _is_ becomes a question for publication and
notification, which do not exist.

## Spots count entries, not people

This distinction is load-bearing:

```
allocated_spots = 10
  9 single + 1 paired selected

  →  10 winning entries        (winner_count = 10, spots are full)
  →  11 winning people         (11 archive rows, 11 lifetime exclusions)
```

A paired application is **one** lottery entry — it was drawn once, with one weight
— and **two** winners, because lifetime exclusion applies to people. Both
travellers get `has_won_hajj = true` and their own archive row; only the primary
would be a bug, and a test asserts both.

So `winnerCount` may be smaller than `winningParticipantCount`, and that is
correct rather than a discrepancy to reconcile.

### Duplicate participants are refused, never deduplicated

`UNIQUE(participant_id)` on the archive means a person can be recorded as a
winner exactly once, ever. If a malformed pool named somebody twice, the
constraint aborts the entire transaction — no partial marking, no silent
collapse of two applications into one. The service also checks explicitly, so
the refusal arrives as a typed `INVALID_POOL_SNAPSHOT` rather than a constraint
violation.

## Application outcomes

```
ELIGIBLE ──▶ SELECTED       drawn as a winner
         ──▶ RESERVE        drawn into the reserve list
         ──▶ NOT_SELECTED   in the pool, drawn neither way
```

Only applications **in the frozen pool** are finalized. `RESERVE` is the
lottery's verdict too, not a lifecycle state: telling a reserve `NOT_SELECTED`
would tell them they had lost, and `SELECTED` would tell them they had a place
they do not hold. A reserve who is later called and accepts becomes `SELECTED`.

`NOT_SELECTED` is emphatically not a refusal: that application took full part in
the lottery and was drawn neither as a winner nor as a reserve. An
application that never reached the pool — refused by eligibility, or filed after
the freeze — keeps whatever the eligibility engine said about it, because it did
not take part in anything.

## Participation history

The ledger is written **in the same transaction**, because it is what the next
draw's weighting reads: leaving it for a later step would mean a completed draw
whose participants' patience could not be counted.

For every person in the pool:

| Field          | Value                                     |
| -------------- | ----------------------------------------- |
| `participated` | `true` — the pool is proof they took part |
| `won`          | whether their entry was drawn             |
| `source`       | `APPLICATION`                             |
| `verified`     | `true`                                    |
| `commune`      | the commune of this draw                  |

**The pool is the authoritative list of participants**, not the applications
table. Somebody whose application was refused did not take part, and giving them
a non-winning record would grow their priority for a draw they never entered. A
test asserts an `INELIGIBLE` applicant gets no record at all.

`verified: true` is a deliberate departure from imported history, which lands
unverified and uncounted. Nobody needs to vouch for these: the system produced
them from its own frozen pool, and there is no register to reconcile them
against. Leaving them unverified would make the streak walk skip every web-era
year and quietly reset everybody's accumulated patience to zero — see
[participation history](participation-history.md).

If a pooled participant already has a record for that year — an administrator's
import, say — execution refuses with `DUPLICATE_HISTORY_YEAR` and rolls back. Two
competing accounts of one person's year is exactly what the ledger's unique
constraint exists to prevent, and choosing between them is an administrator's
decision, not a draw's.

## Lifetime exclusion

`has_won_hajj` becomes true in the same transaction as the archive and the
result. After commit, registration and [eligibility](eligibility.md) see it
immediately; before commit, nobody sees any of it. A test registers a winner into
the following year and confirms they are refused.

**There is no un-win.** No endpoint clears `has_won_hajj`, and none should be
added: an exceptional correction must be a deliberate SUPER_ADMIN workflow with
approval and an audit trail, not a flag somebody can flip.

## Insufficient entries: still a refusal

Unchanged from [the lottery engine](lottery-engine.md), and stricter since
reserves: if the pool holds fewer than **twice** the commune's places — the
winners and the reserve list come from the same sample — execution fails with
`INSUFFICIENT_DRAW_ENTRIES` and:

- no result, no winners, no archive rows
- nobody excluded, no history written
- no application finalized
- the commune draw stays **`LOCKED`**, and its allocation is untouched

The draw remains executable once the situation is resolved administratively. What
it must **not** do is quietly draw everybody: that would decide, invisibly, that
an undersubscribed commune awards every applicant a place — which makes applying
somewhere quiet strictly better than applying somewhere busy. That is a policy
decision, and it has not been made.

An empty pool cannot arise: freezing refuses one, and a database CHECK backs it.

## Rollback

Any failure unwinds everything, including the claim — the commune draw returns to
`LOCKED`. Tests provoke failures at the selection and at winner persistence, and
assert afterwards that there is no result, no winner, no archive row, no
exclusion, no history, no finalized application, and a still-locked draw.

Before committing, the service re-counts what was actually written — winners,
events, archive rows, finalized applications — against what the selection
produced, and refuses to commit if they disagree. Nothing can repair any of it
afterwards, because none of it can be updated at all.

## Immutability

Triggers on all four tables raise on `UPDATE` or `DELETE`, the same approach [the
draw pool](draw-pool.md) takes. Every foreign key `RESTRICT`s and nothing
cascades: a completed lottery is historically durable, and deleting a
participant, an application, a pool or a commune draw cannot make a result vanish
or go partial.

A completed commune draw cannot be reopened, redrawn, reallocated or cancelled.

### The pool is not touched

No pool row is updated, no entry deleted, and **no entry is marked selected**.
Whether an entry won lives in `DrawWinner`. The pool is the input a lottery ran
against; annotating it would edit the evidence.

### A draw cannot claim to be complete without a result

```sql
CREATE CONSTRAINT TRIGGER commune_draws_completed_requires_result
  AFTER UPDATE ON commune_draws DEFERRABLE INITIALLY DEFERRED ...
```

Checked at `COMMIT`, because execution claims the status first — that conditional
update is what serializes concurrent executions — and writes the result
afterwards. Checking immediately would forbid the only safe ordering.

It also closes the administrative path: a `PATCH` setting `COMPLETED` by hand
fails at commit. The service refuses it too (`isAdministrativelySettable`), so the
answer arrives as a sentence rather than a constraint violation.

## Authorization

|                 | Execute | Read result   |
| --------------- | ------- | ------------- |
| `SUPER_ADMIN`   | ✓       | all           |
| `WILAYA_ADMIN`  | — (403) | their wilaya  |
| `COMMUNE_ADMIN` | — (403) | their commune |
| Citizens        | —       | —             |

Execution is national because it is irreversible and excludes people from every
future draw; nobody should be able to run the draw they are themselves subject
to. Reading a result is ordinary scoped work.

Both routes resolve the commune draw through the caller's scope **first**, so a
result in another territory returns **404**, byte-identical to an id that was
never issued — and the role check on execution does not disclose it either.

### The client dictates nothing

`POST /api/admin/commune-draws/:id/execute` does not read its body at all. The
winner count comes from the pool's frozen `allocated_spots`, the entries and
weights from the pool, the randomness from the CSPRNG, the algorithm version from
a constant. A test posts a winner count, a seed, random values and an algorithm
version, and confirms every one of them is ignored.

**Nothing is public.** No winners endpoint, no published results, no random-event
data outside the admin API.

## Auditing

Execution returns a structured `draw.completed` event: acting administrator,
commune draw, result, pool, hash, algorithm version, and the two counts. Nothing
persists it and nothing logs it — the audit table does not exist, a fabricated row
would be worse than none, and winners must not reach any log. The shape is fixed
so whatever eventually stores it needs no restructuring.

## Deferred

- **Publication.** No public winners endpoint, no results page, no exposure of
  selection events outside the admin API.
- **Notifications.** No SMS, no email; a phone number is still not a credential.
- **The live draw visualizer.**
- **Persistent audit logging**, and the `audit_logs` table.
- **A correction workflow** — the only legitimate route to reversing a win, an
  archive row or `has_won_hajj`, with approval and an audit trail. Recording that
  a winner _gave up_ their place is a different thing entirely and does exist:
  see [reserves-and-replacements.md](reserves-and-replacements.md). It leaves the
  win, the archive row and the exclusion exactly where they were.
- **Recovery tooling** for the insufficient-entries situation: the policy
  decision, and whatever administrative resolution follows from it.
- **Bulk execution.** One commune at a time; nothing sweeps a wilaya.
- **Legacy import**, which will need to set `has_won_hajj` for pre-platform
  winners without a web-era result to point at.
