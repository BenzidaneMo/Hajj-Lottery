# Audit and governance

Who did what, when, to which record, and why — and who allowed it.

## An audit record is not application data

This is the distinction everything else follows from:

|         | Application data              | Audit record                   |
| ------- | ----------------------------- | ------------------------------ |
| Says    | what is true **now**          | what somebody **did**          |
| Changes | when the truth changes        | never                          |
| Deleted | when the thing stops existing | never                          |
| Wrong?  | correct it                    | add a record of the correction |

A participant's commune changes when they move. What an administrator did last
March does not change, ever, because it already happened. So audit rows are not
CRUD records with a nicer name: nothing updates one, nothing deletes one, and
there is no endpoint that could.

The protection is at the database, not merely an absent route:

```sql
CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs ...
```

An `UPDATE` or `DELETE` raises, whoever issues it — including a `SUPER_ADMIN`, and
including code added years from now by somebody who did not read this file. **The
administrators are exactly the people the trail exists to hold to account**, so a
trail they can edit is not a trail. There is no "clear audit log", no retention
job, and no deletion path of any kind.

## What is recorded

|                            |                                                              |
| -------------------------- | ------------------------------------------------------------ |
| `action`                   | one of a closed catalogue                                    |
| `actorUserId`              | the session's user; null only where nobody was authenticated |
| `targetType` / `targetId`  | what it was about                                            |
| `wilayaId` / `communeId`   | the geography it concerned; null means national              |
| `reason`                   | a human's explanation, required for sensitive changes        |
| `beforeData` / `afterData` | limited field snapshots of what moved                        |
| `metadata`                 | identifiers and aggregates a reader needs                    |
| `createdAt`                | when                                                         |

### The action catalogue

An enum, not free strings, so an action either exists or cannot be logged — a typo
becomes a compile error rather than a category nobody queries.

| Group          | Actions                                                                                         |
| -------------- | ----------------------------------------------------------------------------------------------- |
| Authentication | `AUTH_LOGIN_SUCCESS`, `AUTH_LOGIN_FAILURE`, `AUTH_LOGOUT`                                       |
| Accounts       | `ADMIN_CREATED`, `ADMIN_DISABLED`, `ADMIN_SCOPE_CHANGED`                                        |
| Configuration  | `DRAW_YEAR_CREATED`, `DRAW_YEAR_STATUS_CHANGED`, `COMMUNE_DRAW_CREATED`, `COMMUNE_DRAW_UPDATED` |
| The lottery    | `DRAW_POOL_FROZEN`, `COMMUNE_DRAW_EXECUTED`                                                     |
| The ledger     | `HISTORICAL_RECORD_CORRECTED`                                                                   |
| Governance     | `APPROVAL_CREATED`, `APPROVAL_APPROVED`, `APPROVAL_REJECTED`, `APPROVAL_CANCELLED`              |

Only actions something can actually perform are listed. A catalogue full of
events that never fire reads like coverage while providing none, so import,
participant identity correction and winner correction are **absent** until the
operations exist. Some deliberate collapses:

- **`DRAW_YEAR_STATUS_CHANGED`** rather than separate `OPENED`/`CLOSED` actions.
  The transition is in the before/after snapshot, so there is one account of what
  changed instead of two that could disagree.
- **`DRAW_POOL_FROZEN`** covers the commune draw locking, because freezing locks
  it in the same transaction. There is no separate `COMMUNE_DRAW_LOCKED`.
- **`COMMUNE_DRAW_EXECUTED`** covers completion, and covers the hundreds of
  participation records a draw writes — the execution event is their provenance.
  `HISTORICAL_RECORD_CORRECTED` is only for corrections.

## The actor is the session, never the request

`AuditService.record` takes an `AuditActor` built from a `User` resolved from the
session cookie. There is no parameter that accepts an id, so a request body
cannot name somebody else as the person who acted.

Every request schema is `.strict()`, which here does more than tidiness: a body
containing `actorUserId` is **refused with a 400** rather than accepted with the
field ignored. A request that tries to forge an identity should fail loudly.

`actorUserId` is null in exactly two cases, both honest: a failed login, where no
account was authenticated, and the bootstrap that creates the first administrator,
where nobody was signed in — and where the appearance of a national account is
precisely the event worth recording.

## Geographic scope, and why unscoped means national

An event's geography comes from the record it concerned, not from the actor and
never from the request. `scopeOfCommune(commune)` takes it from the loaded row, so
a `SUPER_ADMIN`'s national action on one commune is still filed under that
commune: the scope describes what was touched, not who touched it.

Visibility is a query filter, like everywhere else — but with a stricter rule:

| Caller          | Sees                                             |
| --------------- | ------------------------------------------------ |
| `SUPER_ADMIN`   | everything, including national events            |
| `WILAYA_ADMIN`  | rows filed under their wilaya, and nothing else  |
| `COMMUNE_ADMIN` | rows filed under their commune, and nothing else |

**An unscoped row here is a national _action_, not shared reference data.** An
administrator's privileges being changed, a draw year being opened, the system
being configured — a `COMMUNE_ADMIN` has no business watching those. So this
cannot reuse `communeScopeFilter`: for a national caller the filter must match
everything _including_ null-scoped rows, and for everybody else it must match
neither another territory's nor the nation's.

A requested filter can only narrow. A scoped administrator asking for another
commune gets an empty page — byte-identical to asking for a commune that does not
exist, so the trail never reveals whether another region has activity.

An administrator scope change is filed **nationally**, deliberately: authority is
not a property of a territory even when it names one, and filing it under the
target's wilaya would let a scoped administrator watch their own permissions
being changed.

## Reasons

A correction nobody had to justify is indistinguishable from a mistake once
everybody involved has moved on. So these actions cannot be recorded without one:

`HISTORICAL_RECORD_CORRECTED`, `ADMIN_SCOPE_CHANGED`, `ADMIN_DISABLED`, and all
four `APPROVAL_*` actions.

Whitespace is not a justification: a reason is trimmed before it is measured, and
a blank one is refused exactly as a missing one is — in the Zod schema, in
`normalizeAuditReason`, and by a CHECK constraint. Maximum 1000 characters.

Routine and automatic events require none. Demanding a sentence for every login
would train everybody to type one.

## Snapshots, and what may never go in them

`beforeData`/`afterData` hold **only the fields that moved** (`diffSnapshots`).
A snapshot of everything buries the one field that changed and copies data the
trail has no business holding.

Forbidden, matched on the _shape_ of the key so `nationalId`, `national_id` and
`primaryNationalId` are all caught:

> national IDs · phone numbers · passwords and hashes · tokens · secrets and API
> keys · dates of birth · full names

**Refused, not masked.** A payload containing a national ID is a programming
mistake in a service, not user input to be sanitised, and silently dropping the
field would leave a record that looks complete while describing something else.
Failing loudly means a test catches it; masking means nobody ever finds out.

There is also a 4000-character ceiling per snapshot — not for performance, but to
stop a caller quietly turning the trail into a copy of the database by passing a
whole record, or a whole request body, where a few changed fields belong.

Nothing here ever logs a request body.

### Authentication events are deliberately thin

A successful login records who and when. A failure records **nothing** about the
attempt — no username, no account, no source address:

- Recording the username would turn the trail into a list of guessed account
  names.
- Recording whether it matched would answer, through the audit log, the very
  question the generic 401 refuses to answer through the response. A test asserts
  the two failure kinds are indistinguishable in the trail.
- An IP address is personal data, and a truncated hash of an IPv4 is trivially
  brute-forced, so neither is a "privacy-conscious identifier". Correlating
  attempts is already the rate limiter's job; per-address security telemetry
  belongs to infrastructure logging and is deferred to production hardening.

Failures are recorded only for attempts that reached credential checking. Ones the
rate limiter already rejected are not, since a flood of them would bury everything
else.

## Transactional auditing

For anything that changes state, the audit row is written **in the same
transaction** as the mutation:

```
BEGIN
  correct the historical record
  insert the audit row
COMMIT
```

So `mutation exists ⟺ audit exists`. If either fails, neither happened. Tests
provoke both directions: an over-long reason fails the audit insert after the row
has already been updated, and the mutation is gone afterwards.

`AuditService.record(input, tx)` takes a transaction client — the same widening
the lottery reader uses. There is deliberately **no queue and no background
write**: an audit insert that failed silently would leave a mutation with no
record of who made it, which is the exact state this exists to prevent. The
database is the authoritative store.

`recordSecurityEvent` is the one exception, and it never joins a caller's
transaction: a failed login is a fact regardless of what the request went on to
do, and rolling it back with an unrelated failure would erase it.

Reads are not audited. A GET produces no row — read-access auditing is a separate
decision with a much larger volume, and can be added if it is ever required.

## Approval requests

Separation of duties, made structural. An administrator who can _see_ a record
they believe is wrong cannot rewrite it; they can only ask, and somebody else
decides.

```
COMMUNE_ADMIN / WILAYA_ADMIN                 SUPER_ADMIN
        │                                         │
   correction request  ──▶  PENDING  ──▶  approve ──▶ correction + 2 audit rows
                                    │
                                    ├──▶  reject   ──▶ record untouched
                                    └──▶  cancel (requester only)
```

Why the ledger in particular: it drives who gets priority in a lottery, so an
unreviewable edit there is an unreviewable thumb on the scale — and a scoped
administrator has every reason to want a correction and no independent check on
whether it is warranted.

**Approving is applying.** The correction happens in the same transaction as the
decision, so a request marked approved whose change never landed cannot exist, and
nothing afterwards has to guess which of the two was true.

### Immutability, in two halves

| Fixed from               | Fields                                                     |
| ------------------------ | ---------------------------------------------------------- |
| the moment it is raised  | type, requester, target, requested change, reason, created |
| the moment it is decided | status, reviewer, reviewed at, review reason               |

A trigger enforces both. There is **no path from `APPROVED` to `REJECTED` or
back**, by any route: the API returns `APPROVAL_NOT_PENDING`, and the database
refuses the update underneath it. A changed mind is a **new request**, which
leaves the original decision legible instead of replacing it. Deletion is refused
outright.

### Nobody reviews their own request

```sql
CHECK (reviewed_by_user_id IS NULL OR reviewed_by_user_id <> requested_by_user_id)
```

Checked in the service, so the answer is a sentence, and checked by the database,
because a rule that lives only in a service is a rule a later refactor can drop.
A `SUPER_ADMIN` who raises a request cannot approve it — a test asserts exactly
that.

A **cancellation** records no reviewer at all. Only the requester may withdraw
their own request, and filing them as its reviewer would make every cancellation
look like a self-approval. The `APPROVAL_CANCELLED` audit row names who did it.

## Historical correction governance

| Caller          | Route                                             | Effect                    |
| --------------- | ------------------------------------------------- | ------------------------- |
| `COMMUNE_ADMIN` | `POST /api/admin/history/:id/correction-requests` | a `PENDING` request       |
| `WILAYA_ADMIN`  | same                                              | a `PENDING` request       |
| `SUPER_ADMIN`   | `PATCH /api/admin/history/:id`                    | applied directly, audited |

A `SUPER_ADMIN` corrects directly because requiring a second approver when there
may be only one national administrator would mean nothing could ever be fixed.
The reason is mandatory and the change is audited, which is the accountability
that replaces the second pair of eyes. Scoped administrators get **403** on that
route — there is no direct path for them at all.

The request's reason becomes the record's `notes`: the justification for a
correction and the note explaining it are the same sentence, and keeping two
copies invites them to disagree. Corrections remain `ADMIN_CORRECTION` in the
ledger, never a delete.

## Draw audit events

**Freezing** records the actor, the commune draw, the pool, its entry count, total
weight, allocation and snapshot hash — aggregates and integrity only, never the
pool's contents. It is written inside the freeze transaction, so a pool that
exists always has a record of who froze it.

**Execution** records the actor, the result, the pool hash, the algorithm version,
the winner and winning-participant counts, and the total weight. It **references**
the authoritative records rather than copying them: no winner is named, and no
random value is repeated, because the immutable `DrawSelectionEvent` rows already
hold them. It is written inside the execution transaction, so a rolled-back draw
leaves no record of having happened — a test asserts an insufficient-entries
refusal produces none.

## Retention

**None.** Nothing deletes an audit record, on any schedule, ever. Retention is a
governmental and legal decision nobody has made, and building an expiry before the
policy exists would mean choosing one by accident.

## Deferred

- **Legacy import**, and the `LEGACY_IMPORT_*` events it would need.
- **Participant identity correction** — the model is ready for it (`ApprovalType`
  is an enum, the payload is JSON), but its type is deliberately absent until
  something can apply one. Identity changes affect duplicate detection,
  historical linkage, eligibility and winner records, so the workflow needs its
  own design.
- **Winner correction**, including any reversal of `has_won_hajj`. There is still
  no un-win, by design.
- **Application corrections**, which have no operation yet.
- **An administrator management UI.** `changeScope` and `deactivate` exist as
  audited service operations with no HTTP route, the way historical corrections
  waited for this step.
- **Read-access auditing**, and per-address security telemetry.
- **Audit export and reporting.** The API pages; it does not produce documents.
