# Participation history

The ledger of what happened to a person in previous draw years. It will
eventually be the authoritative input to priority weighting — someone passed
over five years running should outrank a first-time applicant — but it stores
facts only, and computes nothing.

## Three records, three questions

| Record                 | Answers                                      | Lifetime                     |
| ---------------------- | -------------------------------------------- | ---------------------------- |
| `Participant`          | Who is this person?                          | One per national ID, forever |
| `Application`          | How are they taking part **this** year?      | One per person per draw year |
| `ParticipationHistory` | What happened to them in **previous** years? | One per person per draw year |

Merging any two loses something. A person is not a year. And an application is
an _intention_ — a form somebody submitted — while a history record is an
_outcome_, which is why one does not become the other automatically.

Identity is never copied here. No name, no national ID, no date of birth: the
record points at a Participant and stops.

## An application is not history

A submitted application is not evidence that someone took part in a draw. It
can be refused, corrected, or belong to a draw that never runs. Creating
history at registration would record intentions as outcomes, and every one of
those errors would silently become permanent priority.

So nothing writes history automatically yet. The service is shaped for it —
`source = APPLICATION` exists precisely for records the platform will later
derive from its own concluded draws — but the population workflow waits until
draw processing exists and there is an actual outcome to record.

## Commune belongs to the year, not the person

Nobody belongs to a commune permanently. Where someone took part is a fact
about _that year_:

```
Participant X ── 2024 ──▶ Commune A
              └─ 2025 ──▶ Commune B
```

This is also the unit of authorization (see below), and the reason `wilaya_id`
is not stored alongside it: the commune already determines the wilaya, and a
second copy could disagree with the first.

## Source and verification

`source` is an enum, never free text — provenance is half of whether a fact can
be trusted:

- **`LEGACY_IMPORT`** — transcribed from paper registers or another
  pre-platform official record.
- **`APPLICATION`** — derived from an Application this platform carried through
  a draw. Nothing writes this yet.
- **`ADMIN_CORRECTION`** — entered or amended by an administrator fixing a
  known error.

`verified` is whether a human has confirmed the record against that source.
Imported history lands `verified = false` and **does not count** until someone
vouches for it. The policy is deliberate and absolute: an unreviewed import
must not be able to inflate somebody's priority merely by existing.

`notes` carries provenance and uncertainty — which register, which page, what
was illegible, why a correction was made. Never identity data.

## Missing year ≠ non-participation

The single most damaging mistake this ledger could make:

|                                 | Meaning                                                    |
| ------------------------------- | ---------------------------------------------------------- |
| No record for 2023              | The ledger has **no authoritative information** about 2023 |
| `participated = false` for 2023 | The ledger **knows** they did not take part                |

One is an absence of evidence; the other is evidence of absence. Only the
second is a fact about the person, and only the second may be created — and
only with a defined source. Nothing manufactures a `false` row to fill a gap.

## The streak

`calculateConsecutiveNonWinningYears(participantId, targetDrawYear)` returns the
consecutive non-winning participation streak immediately preceding a target
year.

It walks backward over **years**, not over rows, starting at
`targetDrawYear - 1`. That distinction is the whole point: iterating the rows a
participant happens to have would silently bridge a gap and credit someone for a
year the ledger knows nothing about. Asking about each year in turn means a hole
stops the count, because a hole is exactly what it looks like.

A year extends the streak only when a **verified** record says the person
**took part** and **did not win**. Everything else stops the walk:

| Stop reason               | Meaning                                                    |
| ------------------------- | ---------------------------------------------------------- |
| `NO_AUTHORITATIVE_RECORD` | No row for that year                                       |
| `UNVERIFIED_RECORD`       | A row exists, but nobody has vouched for it                |
| `DID_NOT_PARTICIPATE`     | A row positively states they did not take part             |
| `WON`                     | They went; a non-winning streak cannot span it             |
| `REACHED_EARLIEST_YEAR`   | Unbroken back to 2000, the earliest year the ledger allows |

The target year itself is never counted — it is the year being decided, and its
outcome does not exist yet.

The result is not a bare number. `stoppedAt` and `stoppedBecause` come with it,
because a count alone is not reviewable: an administrator looking at a streak
of 3 needs to know whether the fourth year back was a win, a known absence, or a
hole in the register.

```
2022 ✓  2023 ✓  2024 ✓  2025 ✓  2026 ✓   → target 2027 = 5
2022 ✓  2023 ——  2024 ✓            → target 2025 = 1, stopped at 2023
2024 ✓  2025 won  2026 ✓            → target 2027 = 1, stopped at 2025
```

The walk is a pure function (`lib/participation-streak.ts`): rows in, count
out, no database and no clock, so the same ledger always gives the same answer.
The service fetches only the years before the target and only the four columns
the walk reads.

### Why no `consecutive_years` column

Because it would be a second copy of something the rows already say, and copies
drift. Verifying one legacy record, or correcting one year, would silently
invalidate a stored counter on every affected participant — and nothing would
notice. Deriving it on demand means the answer cannot disagree with its own
evidence.

### Why no weight

A streak is a count of years. Turning years into a lottery weight is a separate
decision — what curve, what ceiling, how a pair combines — and it is not made
here. `Application.calculated_weight` remains NULL, and the eligibility engine
still does not read it.

## Authorization

Geographic, on the **record's own commune** — never on the participant.

A participant has no geographic owner, so there is nothing about them to
authorize. Asking for someone's history by id is not a claim on them; the query
returns their years _in the caller's territory_ and omits the rest.

```
Participant X:  2024 → Commune A     2025 → Commune B

COMMUNE_ADMIN of A    sees 2024 only, and is not told 2025 exists
WILAYA_ADMIN          sees both only if both communes are in their wilaya
SUPER_ADMIN           sees both
```

Scope is a query filter, as everywhere else (see
[authorization](authorization.md)): forgetting it changes what comes back
rather than skipping a check. A record outside scope returns **404**,
byte-identical to an id that was never issued.

A participant with no in-scope history returns an **empty list**, identical to
an unknown participant id — so the endpoint cannot be used to discover who is
in the registry.

**The streak is withheld from scoped administrators.** It spans communes by
nature, so any number would betray participation outside their territory.
`SUPER_ADMIN` gets a figure; everyone else gets `null`, rather than a value
narrowed until it is wrong.

## Constraints

PostgreSQL enforces what logic can decide:

- `UNIQUE(participant_id, draw_year)` — one person cannot have two
  contradictory stories about the same year. This, not a prior read, is what
  makes concurrent writes resolve to one row; a test fires three at once.
- Foreign keys to `participants` and `communes`, both `RESTRICT`.
- `CHECK (participated = true OR won = false)` — you cannot win a draw you did
  not enter. The only contradiction the data model can express on its own, so
  it is the only one ruled out. Everything else about a historical fact is a
  question of evidence, which is what `verified` is for.
- `CHECK (draw_year BETWEEN 2000 AND 2200)`, matching `applications`.

Indexes follow the two real access patterns: `(participant_id, draw_year)` for
the streak walk, `(commune_id, draw_year)` for the administrative view.

## Corrections

`correct()` amends a fact **in place**. Not a delete-and-recreate: the record
keeps its identity, so the audit trail that comes later can attach to something
stable, and destructive deletion never becomes the normal correction mechanism.

A correction must carry `notes` saying why, and the record becomes
`ADMIN_CORRECTION` whatever it was before — the current claim is an
administrator's, whatever the register originally said. Participant identity is
never touched.

It is a **service operation only**; no HTTP route exposes it yet. That waits
for the approval and audit workflow, which this shape leaves room for.

## API

| Endpoint                                  | Purpose                                            |
| ----------------------------------------- | -------------------------------------------------- |
| `GET /api/admin/participants/:id/history` | One person's years, filtered to the caller's scope |
| `GET /api/admin/history/:id`              | One record, authorized on its own commune          |

Both authenticated, both scoped, neither public. There is no citizen-facing
history endpoint and no unrestricted lookup.

## Deferred

- **Automatic population from draws** — needs draw processing to exist first.
- **Weight calculation.** Nothing converts a streak into a number yet.
- **Legacy import UI** and bulk ingestion. Records are created through the
  service only.
- **The approval and audit workflow** for corrections, and an HTTP route for
  them.
- **Verification workflow** — `verified` can be set, but nothing manages who
  may set it or records who did.
