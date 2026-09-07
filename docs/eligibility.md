# Eligibility

Eligibility answers one question: **may this application take part in its
commune's draw?**

It is the only place that question is answered. Registration used to decide
part of it inline; it no longer does, so a stored application re-evaluated
later cannot reach a different conclusion than the one it was accepted on.

## Participant versus Application

Unchanged from [registration](registration.md), and the reason eligibility can
be re-run at all:

- **Participant** — who someone is. One record per national ID, for life.
  `has_won_hajj` lives here, because winning is a fact about a person.
- **Application** — how that person takes part in one particular year. Year,
  commune, entry type and status live here.

Because identity is never copied onto an application, evaluating one always
reads the _current_ facts about the people in it. An application accepted in
March and re-evaluated in June sees whatever is true in June.

## Validation versus eligibility

Two different questions, deliberately not blurred:

|                 | Validation                   | Eligibility                               |
| --------------- | ---------------------------- | ----------------------------------------- |
| Asks            | Is this request well-formed? | Is this application allowed to take part? |
| Lives in        | `validation/*.ts` (Zod)      | `lib/eligibility-rules.ts`                |
| Knows about     | The request                  | The domain                                |
| Example failure | A malformed date of birth    | The applicant won in 2019                 |
| Response        | `400 VALIDATION_FAILED`      | `422`, `409`, or `400`, depending         |

A malformed date never reaches eligibility. A previous winner is a perfectly
valid request that the domain refuses.

## Where the rules live

```
                    lib/eligibility-rules.ts     ← the rules. Pure.
                             ▲
          builds a subject   │   returns a verdict
                             │
              services/eligibility.service.ts    ← loads state, persists verdicts
                     ▲                  ▲
      registration ──┘                  └── GET /api/admin/applications/:id/eligibility
```

`evaluateEligibility(subject)` is a **pure function**: no database, no clock,
no randomness, no I/O. Everything it needs arrives in the subject. That is what
makes the same unchanged application evaluate identically every time, and it
lets every rule be tested without a database.

`EligibilityService` does the impure half — one query for the application and
its commune, one for the participation rows — and hands the result to the
rules. Splitting them is the difference between _these are the rules_ and
_this is how we happen to fetch the data today_.

## The rules

All of them run; evaluation does not stop at the first failure, so an
administrator sees everything wrong with an application at once. Reasons come
back in a fixed order rather than discovery order, so two runs over identical
data are byte-identical.

| Reason code                             | Raised when                                                              |
| --------------------------------------- | ------------------------------------------------------------------------ |
| `PARTICIPANT_NOT_FOUND`                 | The primary applicant is not a known participant                         |
| `SECONDARY_PARTICIPANT_NOT_FOUND`       | A paired application's partner is not a known participant                |
| `APPLICATION_INCOMPLETE`                | `PAIRED` with no second applicant                                        |
| `ENTRY_TYPE_MISMATCH`                   | `SINGLE` carrying a second applicant                                     |
| `DUPLICATE_APPLICANTS`                  | The same person in both slots                                            |
| `PARTICIPANT_HAS_ALREADY_WON`           | The primary applicant has been to Hajj through a previous draw           |
| `SECONDARY_PARTICIPANT_HAS_ALREADY_WON` | The partner has                                                          |
| `DUPLICATE_ANNUAL_APPLICATION`          | The primary applicant occupies another application this draw year        |
| `SECONDARY_ALREADY_REGISTERED`          | The partner does                                                         |
| `INVALID_COMMUNE`                       | No such commune, inactive, inactive wilaya, or not in the claimed wilaya |
| `DRAW_YEAR_INVALID`                     | Not a plausible year, or not the year being registered                   |

The draw-year range (2000–2200) is the same one a CHECK constraint enforces on
`applications.draw_year`. If the two ever disagree the database wins, so they
are kept identical deliberately.

### Two subtleties

**An application is not its own duplicate.** The duplicate rule asks whether
someone occupies an application _other than the one being judged_. Without
that, re-evaluating any stored application would find its own participation row
and declare it a duplicate of itself.

**A stored year is a fact, not a claim.** Registration passes the server's open
year as `expectedDrawYear`, so a submission can only ever be for the year
currently being registered. Re-evaluation passes `null`: a 2027 application
does not become invalid in 2028 merely because time moved on.

## Eligibility is not the guarantee

The duplicate rule is a **read**, and reads race. Two simultaneous submissions
for the same person both see an empty result and both proceed.

That is fine, and intentional. The `(draw_year, participant_id)` primary key on
`application_participants` is what actually makes one-application-per-year true
— see [registration](registration.md#duplicate-prevention). Eligibility exists
so a citizen gets a clear refusal instead of a constraint violation; the
constraint exists so the refusal is not merely likely. Nothing here weakens it,
and the concurrency tests still assert exactly one submission of three wins.

## Status

```
PENDING ──evaluate──▶ ELIGIBLE
   │                     │
   └─────────────────────┴──▶ INELIGIBLE
```

- `PENDING` — received, not yet evaluated.
- `ELIGIBLE` — evaluated, allowed to take part.
- `INELIGIBLE` — evaluated, refused.

Only the server writes this. `status` is not in the request schema, and
`.strict()` rejects a body that tries to include one rather than ignoring it.

Registration evaluates _before_ it stores, inside the same transaction, so an
application it accepts is written as `ELIGIBLE` and one it refuses is never
written at all. Nothing this route produces is ever `PENDING`.

Reasons are **not stored**. They are derived on demand, so a stale copy can
never contradict the current facts — an administrator inspecting an application
whose applicant has since been recorded as a winner sees `INELIGIBLE` with the
reason, alongside the `ELIGIBLE` status still on the record. Writing that
verdict back is a separate, explicit call.

## Evaluation never writes

`evaluateApplication()` reads. `applyEligibilityResult()` writes. A caller that
wants to look must say so, and a caller that wants to change the record must
say that instead — so no innocuous-looking read can quietly mutate an
application, and nothing about participant identity is touched either way.

## What a citizen is told

Reason codes never cross the public boundary.
`SECONDARY_PARTICIPANT_HAS_ALREADY_WON` would confirm that a particular
national ID belongs to a past winner; `DUPLICATE_ANNUAL_APPLICATION` would
confirm that someone is registered. Either turns a public form into a lookup
service for other people's lives.

So `lib/eligibility-errors.ts` collapses several distinct reasons onto one
vague message, choosing by a fixed precedence — from "the form is malformed" to
"this person cannot take part" — so the citizen hears about what they can
actually fix first, and the same application always produces the same response.

| Reason                                   | Public response              |
| ---------------------------------------- | ---------------------------- |
| Structural problems, unknown participant | `400 VALIDATION_FAILED`      |
| `INVALID_COMMUNE`                        | `400 INVALID_COMMUNE`        |
| `DRAW_YEAR_INVALID`                      | `503 REGISTRATION_CLOSED`    |
| Either winner reason                     | `422 APPLICANT_NOT_ELIGIBLE` |
| Either duplicate reason                  | `409 ALREADY_APPLIED`        |

The wording is carried by the **code**, not the message: the client maps it to
a translation key (`register.errors.*`), so what a citizen reads is in Arabic,
French or English rather than the server's English.

There is deliberately **no public eligibility endpoint**. Only the registration
workflow returns a verdict, and only for the application just submitted —
otherwise anyone could test national IDs at will.

## Administrative review

```
GET /api/admin/applications/:id/eligibility
```

Authenticated, and scoped. No role gate: every administrator reviews
applications, but only in their own territory — `SUPER_ADMIN` nationally,
`WILAYA_ADMIN` within their wilaya, `COMMUNE_ADMIN` within their commune.

An application has no scope of its own; it inherits its commune's. The filter
therefore nests through the relation inside the query rather than being an `if`
afterwards, per [authorization](authorization.md): a query parameter can only
narrow, and forgetting the filter would change results rather than silently
leak.

Out-of-scope returns **404**, byte-identical to an id that was never issued, so
existence cannot be probed. A test asserts the two responses are equal.

The response carries the verdict and the place — reference, year, entry type,
stored status, evaluation, commune and wilaya. It carries no participant
identity and no database ids. What identity an administrator may see belongs to
the application-management view, which does not exist yet.

## Deferred

- **Weighting.** `calculated_weight` stays NULL. Eligibility does not read it,
  and must not start to: an eligible application is one that may take part, not
  one that is likely to win.
- **Historical participation** and consecutive non-winning years.
- **The draw** — selection, weighted sampling, spot allocation per commune.
- **Winner processing**, the only thing that may ever set `has_won_hajj`.
- **Bulk re-evaluation.** Applications are evaluated one at a time; nothing
  sweeps a commune yet.
- **Administrative identity correction** — still no way to fix a mistyped name.
