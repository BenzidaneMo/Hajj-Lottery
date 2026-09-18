# قرعة الحج — Hajj Lottery Platform

A production-oriented web application for running a local communal Hajj
lottery in Algeria: registration, per-commune weighted draws, and
transparent results, across Arabic (RTL), French, and English.

> **Status:** all 26 planned steps are implemented — registration, eligibility, weighting, draw
> configuration, the draw pool, the lottery engine, winner processing, reserves/replacements, audit
> and governance, legacy import, the public portal, and the admin console. See
> [CHANGELOG.md](CHANGELOG.md) for the step-by-step history. Not implemented: winner names in
> published results, notifications/SMS, citizen accounts, a winner-reversal workflow, and the
> authoritative NIN-lookup identity service.

## Architecture

```
/
├── client/    React + Vite + TypeScript + Tailwind CSS (frontend)
├── server/    Node.js + Express + TypeScript (API)
├── shared/    Types shared between client and server
├── prisma/    Prisma schema (PostgreSQL)
├── docs/      Project documentation
└── .env.example
```

`client`, `server`, and `shared` are npm workspaces of the repository root.

## Prerequisites

- Node.js 20+
- A running PostgreSQL instance

## Setup

```bash
npm install                # installs all workspaces and builds `shared`
cp .env.example .env       # then fill in DATABASE_URL, etc.
npm run prisma:migrate     # creates the database schema
```

## Running in development

Frontend and backend run as separate processes:

```bash
npm run dev:client   # http://localhost:5173
npm run dev:server   # http://localhost:4000
```

## Building for production

```bash
npm run build         # builds shared, server, then client in order
npm run --workspace server start
```

## Other scripts

| Command                                                                       | Description                                                                                                                                                                    |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm test`                                                                    | Every Vitest suite (server needs `TEST_DATABASE_URL`)                                                                                                                          |
| `npm run test --workspace client`                                             | Public page tests only — jsdom, no database                                                                                                                                    |
| `npm run test --workspace server`                                             | API and domain tests — needs `TEST_DATABASE_URL`                                                                                                                               |
| `npm run lint`                                                                | ESLint across the whole repository                                                                                                                                             |
| `npm run format`                                                              | Prettier — write                                                                                                                                                               |
| `npm run format:check`                                                        | Prettier — check only                                                                                                                                                          |
| `npm run typecheck`                                                           | TypeScript project checks for every workspace                                                                                                                                  |
| `npm run prisma:studio`                                                       | Prisma Studio (visual database browser)                                                                                                                                        |
| `npm run seed:mock-applications --workspace server`                           | Bulk synthetic applicants nationwide (or `-- --wilaya=27` for one), via the real `POST /api/applications` path — for exercising a draw with more than a handful of entries     |
| `npm run reset-commune-draw --workspace server -- --wilaya=27 --commune=2701` | **Development tool, not a feature.** Undoes one commune's pool freeze and/or draw execution — no production route does this, on purpose                                        |
| `npm run reopen-registration --workspace server`                              | **Development tool.** Undoes `REGISTRATION_CLOSED` for further manual testing — also has no production route                                                                   |
| `npm run reset-participants --workspace server -- --yes`                      | **Development tool.** Wipes every participant/application/pool/result/import batch — a dry run without `--yes`; geography, draw years, commune-draw config and admins are kept |
| `npm run ready-commune-draws --workspace server -- --year=2027`               | **Development tool.** Moves every `DRAFT` commune draw straight to `READY` (optionally scoped to one year) — skips clicking "Ready" one commune at a time before batch freeze/execute |

> **Windows PowerShell note:** plain `npm` resolves to `npm.ps1`, which in some npm/PowerShell
> combinations silently drops everything after `--` — a command like
> `npm run reset-participants --workspace server -- --yes` then runs with no `--yes` at all, with no
> error to say so. If a script with `-- <flags>` above seems to ignore its flags in PowerShell, run
> it with `npm.cmd` instead of `npm` (same arguments otherwise); Git Bash and `cmd.exe` are not
> affected.

## Application shell

**Public routes** (`AppLayout`: header with logo/nav/language switcher,
footer, mobile hamburger menu below `md`):

- `/`, `/register`, `/application-status`, `/winners`, `/draw`, `/about`

**Admin routes** (`AdminLayout`: sidebar + topbar, sidebar becomes a
dismissible overlay below `md`; `/admin/login` is deliberately outside this
layout since there is no session yet):

- `/admin/login`
- `/admin`, `/admin/participants`, `/admin/applications`, `/admin/communes`,
  `/admin/draws`, `/admin/winners`, `/admin/history`, `/admin/imports`,
  `/admin/approvals`, `/admin/audit`, `/admin/admins`, `/admin/settings`

Every route above renders real content. See [docs/public-ui.md](docs/public-ui.md) and
[docs/admin-dashboard.md](docs/admin-dashboard.md).

## UI components

Reusable, generic components for the **public** portal live under `client/src/components/ui/`:
`Button`, `IconButton`, `Input`, `Select`, `Textarea`, `Checkbox`, `RadioGroup`, `Badge`, `Alert`,
`Card`, `Table`, `Pagination`, `Skeleton`, `EmptyState`, `ErrorState`, `PageHeader`, plus
`components/public/` for page-composition pieces and domain-specific ones (`WinnerList`,
`ReserveList`, `DrawStage`, `ApplicationStatusPanel`). The admin console is built on vendored
shadcn/ui (`client/src/components/shadcn/`) instead — the two kits share one set of CSS tokens but
are not mixed; a handful of public pages also use shadcn primitives directly where the plain kit
has no equivalent (`Select`, `Progress`, `Breadcrumb`). The brand accent is a single `primary-*`
color token in `client/src/index.css`; status colors use Tailwind's stock palettes.

All spacing/alignment uses CSS logical properties (`ps-`/`pe-`, `ms-`/`me-`,
`start-`/`end-`, `text-start`) instead of `left`/`right` so layouts mirror
correctly under RTL.

## Internationalization

`i18next`/`react-i18next`, translation files under `client/src/i18n/locales/`. Arabic (`ar`) is the
default language and sets `dir="rtl"` on `<html>`; French and English use `ltr`. All UI text goes
through translation keys — nothing is hardcoded in components.

## Geographic data

Read-only API, seeded from Algeria's official wilaya/commune reference data:

| Endpoint                        | Description                               |
| ------------------------------- | ----------------------------------------- |
| `GET /api/wilayas`              | All active wilayas                        |
| `GET /api/wilayas/:id`          | A single wilaya                           |
| `GET /api/wilayas/:id/communes` | Communes belonging to that wilaya         |
| `GET /api/communes`             | All active communes (`?wilayaId=` filter) |
| `GET /api/communes/:id`         | A single commune                          |

Each record carries `nameAr`/`nameFr`/`nameEn` together, so clients pick the label matching the
active locale without extra requests. `WilayaSelect`/`CommuneSelect` (`client/src/components/geo/`)
are reusable, API-backed selectors — no commune/wilaya data is hardcoded in React.

See [docs/geographic-data.md](docs/geographic-data.md) for the source dataset and seeding process.

## Participants

A `Participant` is one real person — exactly one record per national ID — and answers only "who is
this person?". Draw year, commune, status, weight and entry type belong to the annual-application
models, which reference a participant by `id` rather than duplicating the person.

| Endpoint                                           | Description                     |
| -------------------------------------------------- | ------------------------------- |
| `POST /api/participants`                           | Register a new identity record  |
| `GET /api/participants/:id`                        | Fetch by internal id            |
| `GET /api/participants/by-national-id/:nationalId` | Fetch by national ID (any form) |

These endpoints expose personal data, so they require an authenticated `SUPER_ADMIN` session — see
[docs/authorization.md](docs/authorization.md).

## Administrator authentication

Session-based, with the session stored in PostgreSQL and carried by an
`HttpOnly` cookie — no tokens in `localStorage`, nothing sensitive in the
frontend bundle.

| Endpoint                | Auth | Purpose                    |
| ----------------------- | ---- | -------------------------- |
| `POST /api/auth/login`  | no   | Establish a session        |
| `GET /api/auth/me`      | yes  | Current administrator      |
| `POST /api/auth/logout` | yes  | Revoke the current session |

Create a development administrator with `npm run seed:admin` after setting
`DEV_ADMIN_USERNAME` / `DEV_ADMIN_PASSWORD` in `.env` — there is no default password. For production
use the controlled bootstrap, `npm run admin:create`.

See [docs/authentication.md](docs/authentication.md) for the cookie strategy, the CSRF decision, and
the first-administrator procedure.

## Citizen registration

Public and account-free: a citizen submits one application per draw year, for
exactly one commune.

| Endpoint                                    | Auth | Purpose                     |
| ------------------------------------------- | ---- | --------------------------- |
| `POST /api/applications`                    | no   | Submit an application       |
| `GET /api/applications/registration-window` | no   | Current draw year and state |

A **Participant** is who someone is; an **Application** is how they take part in one year — identity
is never copied onto an application. "One application per person per draw year" is enforced by a
`(draw_year, participant_id)` primary key on `application_participants`, not application code, so
concurrent submissions resolve correctly.

Every successful registration returns a receipt carrying a reference like
`HZ-2027-MES-8F42K1` and nothing personal. See
[docs/registration.md](docs/registration.md).

## Eligibility

Whether an application may take part is a separate question from whether the
request was well-formed, and it has a single home.

| Endpoint                                      | Auth | Purpose                        |
| --------------------------------------------- | ---- | ------------------------------ |
| `GET /api/admin/applications/:id/eligibility` | yes  | Review one application, scoped |

The rules are a **pure function** — no database, no clock, no randomness — so re-evaluating an
unchanged application always reaches the same verdict. Registration and administrative review both
go through it. Reason codes are for administrators only: a citizen never sees them, since naming the
exact rule would confirm which national IDs exist or who has won before.

See [docs/eligibility.md](docs/eligibility.md).

## Participation history

What happened to a person in previous draw years — the input to priority weighting, and the third
record in the model alongside Participant and Application.

| Endpoint                                  | Auth | Purpose                               |
| ----------------------------------------- | ---- | ------------------------------------- |
| `GET /api/admin/participants/:id/history` | yes  | One person's years, filtered by scope |
| `GET /api/admin/history/:id`              | yes  | One record, scoped to its commune     |

**A missing year is not a non-participation.** No record means the ledger has no authoritative
information; an explicit `participated = false` means it knows the person did not take part. The
streak calculation walks backward over _years_, not rows, so a hole in the register stops the count
rather than being bridged. Records carry a `source` and `verified` flag — imported history does not
count toward anything until a human vouches for it. Authorization is on each record's own commune,
never the participant, since a person may take part in different communes in different years.

See [docs/participation-history.md](docs/participation-history.md).

## The draw pool

The lottery must never draw from live application rows — eligibility, weights and history all keep
moving, and a draw run against shifting data could not be reproduced or defended. So when a
commune's draw is ready, its input is frozen.

| Endpoint                                          | Auth | Role        | Purpose                     |
| ------------------------------------------------- | ---- | ----------- | --------------------------- |
| `POST /api/admin/commune-draws/:id/validate-pool` | yes  | any admin   | Dry run; changes nothing    |
| `POST /api/admin/commune-draws/:id/freeze-pool`   | yes  | SUPER_ADMIN | Snapshot and lock, once     |
| `GET /api/admin/commune-draws/:id/pool`           | yes  | any admin   | The frozen entries, scoped  |
| `GET /api/admin/commune-draws/:id/pool/summary`   | yes  | any admin   | Aggregates and hash, scoped |

Validation recomputes every weight and re-evaluates every application, and **repairs nothing**: a
stale weight, an application no longer eligible, a participant since recorded as a winner all block
the freeze. The one exception is a weight that was never frozen at all — nothing else in the system
ever freezes one, so pool-freezing is also the first and only moment that happens; if that's the
_only_ blocker, freezing resolves it, otherwise nothing is written.

Freezing and locking a commune draw happen in one transaction, so there is never a locked draw
without a pool. The snapshot is immutable by database trigger and carries no personal data. Its
SHA-256 hash is for integrity only, never a random seed. Nothing about a pool is public.

See [docs/draw-pool.md](docs/draw-pool.md).

## Audit and governance

Who did what, when, to which record, and why — and who allowed it.

| Endpoint                                          | Auth | Role        | Purpose                   |
| ------------------------------------------------- | ---- | ----------- | ------------------------- |
| `GET /api/admin/audit-logs`                       | yes  | any admin   | The trail, scoped, paged  |
| `POST /api/admin/history/:id/correction-requests` | yes  | any admin   | Ask for a correction      |
| `PATCH /api/admin/history/:id`                    | yes  | SUPER_ADMIN | Correct directly, audited |
| `GET /api/admin/approvals`                        | yes  | any admin   | The queue, scoped         |
| `POST /api/admin/approvals/:id/approve`           | yes  | SUPER_ADMIN | Decide, and apply         |
| `POST /api/admin/approvals/:id/reject`            | yes  | SUPER_ADMIN | Decide                    |
| `POST /api/admin/approvals/:id/cancel`            | yes  | requester   | Withdraw your own         |

**An audit record is not application data** — it says what somebody did, which never stops being
what they did, so nothing updates or deletes one, by database trigger, for anyone including a
`SUPER_ADMIN`. Records are written in the same transaction as the mutation they describe, so a
change exists if and only if its record does. **Nothing personal goes in**: national IDs, phone
numbers, names, dates of birth, passwords and tokens are refused outright rather than masked, and a
failed login records nothing about the attempt at all. Visibility is scoped, and an unscoped row is
a national action, never shared data.

**Separation of duties is structural**: an administrator who believes a record is wrong raises a
request rather than rewriting it, nobody reviews their own, and an approval or rejection is
permanent — a changed mind is a new request.

See [docs/audit-and-governance.md](docs/audit-and-governance.md).

## Legacy historical import

The paper registers from before this platform existed are the only record of who has been waiting
how long — and that record becomes priority in future lotteries and lifetime exclusion from them.

| Endpoint                               | Auth | Role        | Purpose                          |
| -------------------------------------- | ---- | ----------- | -------------------------------- |
| `POST /api/admin/imports`              | yes  | any admin   | Upload a CSV/XLSX register       |
| `GET /api/admin/imports`               | yes  | any admin   | Batches touching your territory  |
| `GET /api/admin/imports/:id/summary`   | yes  | any admin   | Counts over the rows you may see |
| `GET /api/admin/imports/:id/conflicts` | yes  | any admin   | Only what blocks                 |
| `POST /api/admin/imports/:id/approve`  | yes  | SUPER_ADMIN | Never your own upload            |
| `POST /api/admin/imports/:id/execute`  | yes  | SUPER_ADMIN | The one transaction that writes  |

**Nothing authoritative moves until the end.** An upload stages rows and touches no participant, no
historical record and nobody's winner status; the rows are checked three times, a _different_
national administrator approves, and only then does one transaction write all of it or none.
**Unknown is not false** — an empty participation cell is a gap in the register, not a claim that
somebody stayed home. **Nothing is silently repaired**: a name mismatch, a disagreeing year, a
conflicting win — each blocks and is reported rather than resolved by preferring a source. A legacy
winner is a `LegacyWinner` row, never a manufactured `DrawResult`/`DrawWinner` for a lottery this
system never ran.

See [docs/legacy-import.md](docs/legacy-import.md).

## Public access

The first part of the system that faces citizens rather than administrators.

| Endpoint                                                     | Auth | Purpose                          |
| ------------------------------------------------------------ | ---- | -------------------------------- |
| `POST /api/public/application-status`                        | no   | Check your own application       |
| `GET /api/public/results`                                    | no   | Published results, paginated     |
| `GET /api/public/results/:drawYear/:wilayaCode/:communeCode` | no   | One commune's official result    |
| `GET /api/public/draw-status`                                | no   | Where each commune's draw stands |
| `POST /api/admin/commune-draws/:id/publish-result`           | yes  | SUPER_ADMIN releases a result    |

There are no citizen accounts, passwords or OTP — a citizen checks an application by proving they
hold its receipt reference plus the mobile number given on it. **The lookup must not become an
oracle**: an unknown reference, a wrong number, a malformed reference and an applicant with no
number all produce byte-identical responses, verified in constant time.

**A `DrawResult` existing is not a public result.** Publication is a separate `ResultPublication`
record, written by a SUPER_ADMIN in one audited transaction, that verifies first and **repairs
nothing** — every reconciliation failure blocks. It's idempotent and one-way. What's published: the
year, place, allocation, winning entries by their own reference, and the pool's hash. What's not:
names, national IDs, phone numbers, weights, or the pool itself — winner _names_ are deliberately
withheld pending policy.

See [docs/public-access.md](docs/public-access.md).

## Public citizen portal

The pages a citizen actually uses, all of them reading the API above.

| Route                                         | Purpose                                                |
| --------------------------------------------- | ------------------------------------------------------ |
| `/application-status`                         | Check your own application (posts; nothing in the URL) |
| `/winners`                                    | Announced results, filtered and paginated              |
| `/results/:drawYear/:wilayaCode/:communeCode` | One commune's official result — shareable, cacheable   |
| `/draw`                                       | Where every commune's draw stands                      |
| `/draw/:drawYear/:wilayaCode/:communeCode`    | The live draw visualiser for one commune               |

Places are addressed by **official code** throughout, never a database id, so a result URL can be
read out over the telephone. **The result page keeps the original draw and the current outcome
apart** — winners and reserves are two tables, an original winner who gave up their place stays in
the winner list with a status saying so, and a promoted reserve keeps its reserve number rather than
being relabelled.

**The live draw visualiser performs no lottery logic** — `Math.random` is banned across the client
and a test enforces it over the whole source tree. The transport is polling a cacheable GET, not
SSE or WebSockets, since the server exposes no per-selection events to subscribe to; polling
narrows while awaiting the announcement and stops once the result is published. Visual design is
restrained on purpose: no wheel, no slot machine, no jackpot flashing.

See [docs/public-ui.md](docs/public-ui.md).

## Administrative console

Everything under `/admin`: a scoped dashboard, applications with their eligibility and weight, the
participation ledger, draw years and commune allocations, one page carrying a commune's whole
workflow from pool validation through freezing, execution, publication and the reserve lifecycle,
plus legacy import, approvals, the audit trail and administrator accounts.

Built on **shadcn/ui** — Radix primitives vendored into `client/src/components/shadcn/`. The public
portal keeps its own kit; the two are not mixed. **The console decides nothing** — it offers only
the lifecycle transitions the shared transition tables permit and hides sections a role cannot
open, but both are courtesies: the server applies the caller's geographic ceiling on every request
regardless of what was rendered.

See [docs/admin-dashboard.md](docs/admin-dashboard.md).

## Winner processing

Executing a draw is one transaction, run once, and irreversible.

| Endpoint                                    | Auth | Role        | Purpose            |
| ------------------------------------------- | ---- | ----------- | ------------------ |
| `POST /api/admin/commune-draws/:id/execute` | yes  | SUPER_ADMIN | Run the draw, once |
| `GET /api/admin/commune-draws/:id/result`   | yes  | any admin   | The result, scoped |

That single transaction claims the commune draw, draws from the frozen pool, records the result with
its winners and reserves, sets `has_won_hajj` and archives every winning individual, finalizes the
pooled applications, and writes the participation ledger. Any failure unwinds all of it, including
the claim — the commune draw returns to `LOCKED`, retryable, with nothing left behind.

**Concurrency is settled by the database**: a conditional `UPDATE ... WHERE status = 'LOCKED'` claim
serializes two simultaneous executions on the row. **Spots count entries, not people** — a paired
application is one lottery entry and two winners; marking only the primary would be a bug. A
completed result is immutable by trigger, and PostgreSQL refuses to commit a `COMPLETED` commune
draw that has no result.

See [docs/winner-processing.md](docs/winner-processing.md).

## Reserves and replacements

A commune with N places draws **2N** entries in one continuous weighted sample: N winners, then N
reserves, in the order they came out — produced by the original lottery and never regenerated,
reordered, or sorted by weight.

| Endpoint                                                            | Role        | Purpose                         |
| ------------------------------------------------------------------- | ----------- | ------------------------------- |
| `POST /api/admin/commune-draws/:id/winners/:selectionOrder/abandon` | SUPER_ADMIN | Record a place being given up   |
| `POST /api/admin/commune-draws/:id/reserves/:position/call`         | SUPER_ADMIN | Offer it to the next reserve    |
| `POST /api/admin/commune-draws/:id/reserves/:position/accept`       | SUPER_ADMIN | They took it — they now win     |
| `POST /api/admin/commune-draws/:id/reserves/:position/decline`      | SUPER_ADMIN | They refused; the place reopens |

**The original draw is a record and never moves** — a promoted reserve stays reserve #1 forever and
_separately_ becomes a winner, never "winner #4". **A reserve is not a winner until they accept**:
no archive row, no `has_won_hajj`. **An abandoned winner stays a winner** — there is no operation
anywhere that turns a lifetime exclusion back off. **The order is enforced, never chosen**: calling
refuses anything but the next waiting reserve. A pool must hold at least 2N entries, or the draw
stays `LOCKED` with `INSUFFICIENT_DRAW_ENTRIES`.

See [docs/reserves-and-replacements.md](docs/reserves-and-replacements.md).

## The lottery engine

Given a frozen pool and a number of places, which entries are selected — and nothing else. The
engine is a consumer of the pool: it never reads a live weight, re-evaluates eligibility, or
touches participation history.

Each round maps the entries still in play onto one contiguous integer range and draws a value inside it:

```
  A weight 2   B weight 5   C weight 3        total 10
  [0 1]        [2 3 4 5 6]  [7 8 9]

  r drawn from [0, 10)   →   the first entry whose cumulative weight exceeds r
```

The winner is removed and the total recomputed each round, so nobody is selected twice. Randomness
comes from `crypto.randomInt`; **`Math.random` is forbidden**, and a test scans every server source
file to enforce it. The pool's own hash is never used as a seed — deriving randomness from the input
would make the outcome a function of who entered. A selection **writes nothing** and has **no HTTP
endpoint**, since nothing yet records that a draw has been run and a route would let an
administrator re-roll. A pool smaller than its allocation is refused, never truncated.

See [docs/lottery-engine.md](docs/lottery-engine.md).

## Draw configuration

Which year the lottery is running, and how many pilgrimage places each commune has. The lottery
runs **per commune**, so there are two independent lifecycles: `DrawYear` for the national cycle,
`CommuneDraw` for one commune's own draw.

| Endpoint                             | Auth | Role        | Purpose                         |
| ------------------------------------ | ---- | ----------- | ------------------------------- |
| `GET /api/admin/draw-years`          | yes  | any admin   | The annual cycles               |
| `GET /api/admin/draw-years/:year`    | yes  | any admin   | One cycle                       |
| `POST /api/admin/draw-years`         | yes  | SUPER_ADMIN | Create a cycle (always a draft) |
| `PATCH /api/admin/draw-years/:id`    | yes  | SUPER_ADMIN | Open, close or archive it       |
| `GET /api/admin/commune-draws`       | yes  | any admin   | Configurations, scoped          |
| `GET /api/admin/commune-draws/:id`   | yes  | any admin   | One configuration, scoped       |
| `POST /api/admin/commune-draws`      | yes  | SUPER_ADMIN | Configure a commune             |
| `PATCH /api/admin/commune-draws/:id` | yes  | SUPER_ADMIN | Re-allocate or change state     |

**`allocated_spots` is configuration, never a calculation** — not derived from applicant count,
population, or past winners. At most one draw year may be open for registration at a time, enforced
by a partial unique index. Once a commune draw is `LOCKED` its allocation is fixed for everyone;
`LOCKED` itself cannot be set by hand, only by freezing the pool, so a commune draw is never locked
with nothing behind it.

See [docs/draw-configuration.md](docs/draw-configuration.md).

## Weighting

How strong an eligible application's claim is, derived from verified participation history. Nothing
selects winners yet.

| Endpoint                                 | Auth | Purpose                  |
| ---------------------------------------- | ---- | ------------------------ |
| `GET /api/admin/applications/:id/weight` | yes  | Inspect a weight, scoped |

An individual's weight is their consecutive verified non-winning streak **plus one**, so a streak of
0, 1 or 5 weighs 1, 2 or 6. A **paired application takes the higher of its two weights**. Calculating
never writes; freezing does — and the only thing that ever freezes one is pool-freezing (see "The
draw pool" above). Once frozen, a weight is the claim that application entered with: it is never
overwritten, even when a later-verified record grows the live streak.

See [docs/weighting.md](docs/weighting.md).

## Roles and geographic scope

`SUPER_ADMIN` is national; `WILAYA_ADMIN` is limited to one wilaya and its
communes; `COMMUNE_ADMIN` to a single commune. Scope lives in the database and
is enforced by PostgreSQL — a CHECK constraint for the legal role/scope shapes,
and a composite foreign key so an administrator's commune must belong to their
wilaya.

| Endpoint              | Auth | Role      | Scope  |
| --------------------- | ---- | --------- | ------ |
| `/api/admin/wilayas`  | yes  | any admin | scoped |
| `/api/admin/communes` | yes  | any admin | scoped |

Scoped queries intersect the caller's ceiling with any requested filter, so a
query parameter can only ever narrow results — never widen them. Resources
outside an administrator's territory return 404, indistinguishable from ones
that do not exist; an insufficient _role_ returns 403.

See [docs/authorization.md](docs/authorization.md).

National IDs are normalized in exactly one place
([server/src/lib/national-id.ts](server/src/lib/national-id.ts)): Arabic-Indic
and Persian digits fold to ASCII, separators and invisible bidi marks are
stripped, leading zeros are preserved, and the canonical result must be 18
digits (Algeria's NIN). Uniqueness is enforced by a PostgreSQL unique index,
not only by application code.
