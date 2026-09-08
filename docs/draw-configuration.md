# Draw configuration

Which year the lottery is running, and how many pilgrimage places each commune
has. Configuration, not calculation — and the gate registration now passes
through.

## Two lifecycles, deliberately separate

```
DrawYear  ── the national cycle: may citizens apply this year?
   │
   └── CommuneDraw ── one commune's own draw: how many places, and is it settled?
```

They move independently:

| DrawYear              | CommuneDraw | Meaning                                                   |
| --------------------- | ----------- | --------------------------------------------------------- |
| `REGISTRATION_OPEN`   | `DRAFT`     | Intake is running; this commune is still being configured |
| `REGISTRATION_OPEN`   | `READY`     | Intake is running; this commune's terms are settled       |
| `REGISTRATION_CLOSED` | `READY`     | Intake finished; the commune has not locked yet           |
| `REGISTRATION_CLOSED` | `LOCKED`    | The commune's allocation is fixed                         |

Merging them would force all 1541 communes onto one timetable, which is not how
the draw works: **the lottery is run per commune**. One commune finishing its
configuration says nothing about the others.

## The lottery is per commune

```
Draw year
   ↓
Commune
   ↓
Allocated spots        ← configured, never derived
   ↓
Eligible applications  ← counted from the applications themselves
   ↓
Weighted draw          ← does not exist yet
```

## allocated_spots is configuration

**The number of Hajj places is an explicit configured value.** It is never
inferred from the number of applicants, the population, or how many people won
before. An official allocates places; the system records the allocation.

Both of these are normal and neither is an error:

```
Mesra:      12 spots,  843 eligible applications
Commune C:  100 spots,  20 eligible applications
```

An oversubscribed commune is the ordinary case, and registration does **not**
refuse an application because the commune is full — the draw will later choose
between them. An undersubscribed one does not automatically admit everybody
either; what selection does with a surplus is the draw engine's decision, and
it does not exist yet.

Allocations are not levelled or rebalanced between communes. Each is set on its
own.

### Bounds

`allocated_spots` is an integer between 1 and 100000, enforced by a CHECK
constraint.

Zero is refused as firmly as a negative: a draw that can select nobody is a
cancelled draw expressed as arithmetic, and the lifecycle already has a state
that says that honestly. The upper bound is a guard against a mistyped
configuration rather than a policy limit — Algeria's national quota is on the
order of tens of thousands spread across 1541 communes, so this is far beyond
any legitimate single allocation while still catching an extra keystroke.

## States

### DrawYear

```
DRAFT ──▶ REGISTRATION_OPEN ──▶ REGISTRATION_CLOSED ──▶ ARCHIVED
  │                                                        ▲
  └────────────────────────────────────────────────────────┘
```

- **`DRAFT`** — being configured. Registration is not running.
- **`REGISTRATION_OPEN`** — citizens may apply. **At most one year may be here
  at a time**, enforced by a partial unique index, so "which year is
  registration for?" can never have two answers.
- **`REGISTRATION_CLOSED`** — intake has finished. **There is no route back.**
  Reopening would let applications arrive after everyone was told the year was
  settled, and whether that is ever permitted is a policy decision nobody has
  made. Until someone does, the system cannot do it.
- **`ARCHIVED`** — kept for the record. Draw years are archived, never deleted:
  they are the history of who ran which lottery.

### CommuneDraw

```
DRAFT ⇄ READY ──▶ LOCKED
  │       │
  └───────┴──▶ CANCELLED
```

- **`DRAFT`** / **`READY`** — configurable. Spots may change; registration is
  accepted.
- **`LOCKED`** — the allocation is fixed and no further applications join this
  commune's pool.
- **`CANCELLED`** — not running this year. Terminal.

`READY` can fall back to `DRAFT`, because "settled" is a statement of intent and
an official may reconsider before the terms are fixed. **`LOCKED` cannot.** It
is the promise that the terms stopped moving, and the whole value of that
promise is that it cannot be taken back — so changing spots afterwards is
refused for everyone, including the administrator who set them.

`COMPLETED` is absent from both. It belongs to a draw having been executed, and
no code can execute one yet. Adding states nothing can reach would be inventing
a lifecycle rather than recording one.

### Where transitions live

All of them are in `lib/draw-lifecycle.ts`, as data. The legal moves are a
lookup table, not a thicket of `if (status === ...)` spread through controllers
where a missing case is invisible. Anything not listed cannot happen.

## Registration integration

A citizen's application is now gated on the configuration:

1. A `DrawYear` must be `REGISTRATION_OPEN`. That year — **not anything in the
   request** — is the application's `draw_year`. The body has no `drawYear`
   field, and `.strict()` rejects one that tries.
2. The chosen commune must have a `CommuneDraw` for that year, in a state that
   accepts entries (`DRAFT` or `READY`).

A commune with no configured draw is not holding a lottery, so there is nothing
to apply to; the citizen is told so with a translated message rather than
having an application filed into a draw that will never run.

**Check ordering matters.** The commune-draw check runs only _after_ the commune
itself is found valid and in the claimed wilaya. Otherwise "no draw configured"
would answer differently from "no such commune", and the difference would be a
way to discover which commune ids are real.

The commune-draw check is deliberately **not** an eligibility rule. Eligibility
is re-evaluated on stored applications, and a commune locking its allocation
must not retroactively make applications already filed under it ineligible.

### The environment variables are gone

`DRAW_YEAR` and `REGISTRATION_OPEN` were placeholders standing in for this
model. Which year is running is now a row an administrator changes at runtime,
not a value baked into a deployment.

## Who may do what

|                 | Read draw years | Read commune draws | Configure anything |
| --------------- | --------------- | ------------------ | ------------------ |
| `SUPER_ADMIN`   | ✓               | all                | ✓                  |
| `WILAYA_ADMIN`  | ✓               | their wilaya       | —                  |
| `COMMUNE_ADMIN` | ✓               | their commune      | —                  |

Draw years are read unscoped: a year is national, names no territory, and
reveals nothing about anyone's commune. Which communes are configured _within_
it is a separate, scoped question.

Commune draws are scoped through the commune relation inside the query, per
[authorization](authorization.md) — forgetting the filter changes the results
rather than skipping a check. An out-of-scope commune draw returns **404**,
byte-identical to an id that was never issued.

**Mutation is SUPER_ADMIN-only**, and returns **403** to a scoped administrator
— they are authenticated and the route is no secret; they simply may not do
this. That holds even inside their own territory: a commune administrator
allocating their own commune's pilgrimage places is precisely the conflict of
interest the roles exist to prevent.

The geographic validation infrastructure is correct regardless, so widening
write access later is a change of one route guard rather than a redesign.

## Integrity

- `UNIQUE(year)` on draw years — one cycle per calendar year, ever.
- `UNIQUE(draw_year_id, commune_id)` — one configuration per commune per year.
- A **partial unique index** permitting one `REGISTRATION_OPEN` row.
- `CHECK (allocated_spots BETWEEN 1 AND 100000)`, `CHECK (year BETWEEN 2000 AND 2200)`.
- Foreign keys to `draw_years` and `communes`, both **`RESTRICT`**. These
  records are the terms a lottery was run under; deleting geography or a year
  must never quietly erase them. Nothing cascades.

Each uniqueness rule is the database's, not a prior read's — which is what makes
two administrators configuring the same commune simultaneously resolve to a
single row. Tests fire three concurrent creations at both tables and assert
exactly one survives.

No wilaya is stored on a commune draw: the commune already determines it, and a
second copy could disagree with the first. A test asserts the column does not
exist.

## What is deliberately absent

**No `eligible_application_count`.** The applications table is the authoritative
count. A denormalized counter would drift the moment an application changed
state, and nothing here needs the speed yet.

**No pool table.** Applications are not copied anywhere to "prepare" a draw. A
commune draw can already reach everything a future pool freeze needs — its
year, its commune's eligible applications, and their frozen
`calculated_weight` — without duplicating a single applicant.

## Deferred

- **The draw itself** — selection, sampling, spot allocation among winners.
- **Pool freezing.** `LOCKED` records the intent; nothing yet snapshots the
  pool.
- **`COMPLETED` states** on both models, which need draw execution to be
  reachable.
- **Audit logging** of configuration changes. Mutations are already funnelled
  through service methods, so logging attaches at one point rather than needing
  a restructure.
- **Bulk configuration** — commune draws are created one at a time; only the
  development seed configures many at once.
- **An admin configuration UI.** The API and its tests verify the behaviour;
  the draw-management screens are still placeholders.
