# قرعة الحج — Hajj Lottery Platform

A production-oriented web application for running a local communal Hajj
lottery in Algeria: registration, per-commune weighted draws, and
transparent results, across Arabic (RTL), French, and English.

> **Status:** Step 01 — project foundation. Lottery logic, registration,
> authentication, and the admin dashboard are not yet implemented; routes
> exist as placeholders only.

> **Status:** Step 02 — application shell and visual foundation. Public and
> admin layouts, routing, the component library, and i18n/RTL are in place;
> every page is still a placeholder. Authentication, registration, the
> lottery engine, and admin permissions are not yet implemented.

> **Status:** Step 03 — geographic data foundation. Wilaya/commune reference
> data (69 wilayas, 1541 communes) is seeded and served read-only via the API;
> reusable `WilayaSelect`/`CommuneSelect` frontend components consume it.
> Registration, the lottery engine, authentication, and historical
> participation are still not implemented.

> **Status:** Step 04 — participant identity registry. One `Participant`
> record per national ID, with PostgreSQL-enforced uniqueness, a centralized
> national-ID normalizer, a `ParticipantService`, and a minimal access-gated
> participant API. The lottery engine, weighting, annual applications and
> winner processing are still not implemented.

> **Status:** Step 05 — authentication foundation. Administrators sign in
> against PostgreSQL-backed sessions (argon2id, HttpOnly cookie); `/admin` is
> protected on both the client and the server. Authorization — roles, wilaya
> and commune scoping — is deliberately still absent, as are the lottery
> engine, registration and annual applications.

> **Status:** Step 06 — role-based access control and geographic scoping.
> Administrators are scoped to a wilaya or commune in the database (enforced by
> CHECK and composite-foreign-key constraints), `requireRole` guards routes, and
> every scoped query intersects the request with the caller's own reach. The
> temporary internal API key is gone. The lottery engine, registration and
> annual applications remain unimplemented.

> **Status:** Step 07 — citizen registration. Citizens submit single or paired
> applications for the server's draw year without an account, participants are
> reused rather than duplicated, and "one application per person per year" is a
> database guarantee that holds across roles and concurrent requests. The
> lottery engine, weighting, historical participation and winner processing
> remain unimplemented.

> **Status:** Step 08 — eligibility engine. Whether an application may take part
> is now one deterministic domain service rather than rules scattered through
> registration: a pure rule function, typed reason codes, and a status the
> server alone writes. Administrators can review any application in their own
> territory. Weighting, historical participation, the draw itself and winner
> processing remain unimplemented.

> **Status:** Step 09 — historical participation ledger. `ParticipationHistory`
> records what happened to a person in previous draw years, with source and
> verification metadata, and a service that derives the consecutive
> non-winning streak before a target year without ever inventing a missing
> year. Weighting, the draw itself, winner processing and legacy import
> tooling remain unimplemented.

> **Status:** Step 10 — priority/weight engine. An eligible application's
> lottery weight is derived from verified participation history, with paired
> applications taking the higher of their two weights, and frozen onto the
> application as a snapshot that later historical corrections cannot silently
> rewrite. The draw itself — selection, sampling, spot allocation — and winner
> processing remain unimplemented.

> **Status:** Step 11 — annual draw configuration and commune spot allocation.
> A `DrawYear` decides which cycle is open for registration, and a
> `CommuneDraw` configures how many pilgrimage places each commune has for it.
> Registration now requires both. Spot allocation is explicit configuration,
> never derived from applicant numbers. The draw itself, pool freezing and
> winner processing remain unimplemented.

> **Status:** Step 12 — draw pool validation and freeze. Before a commune's
> lottery can run, its input is validated against the current facts and then
> snapshotted into an immutable, hashed pool while the commune draw locks —
> atomically, once. The draw engine will read only from that pool. Selection,
> randomness and winner processing remain unimplemented.

> **Status:** Step 13 — the weighted lottery engine. Selection exists: weighted
> sampling without replacement over a frozen pool, drawn with a cryptographically
> secure generator through an injectable random source, in integer arithmetic
> only. It writes nothing and has no HTTP route, because nothing can yet record
> that a draw has been run. Winner records, publication and `has_won_hajj`
> remain unimplemented.

> **Status:** Step 14 — winner processing and atomic finalization. A national
> administrator can execute a locked commune's draw. One transaction claims the
> draw, selects the winners, records the result, its winners and the randomness
> behind them, excludes every winning individual for life, finalizes the pooled
> applications and writes the participation ledger — or leaves the world exactly
> as it was. A draw cannot be run twice, and a completed result cannot be
> altered. Publication, notifications and the live visualizer remain
> unimplemented.

> **Status:** Step 15 — audit trail and administrative governance. Every
> privileged change now leaves an append-only record of who made it, when, to
> what, and why, written in the same transaction as the change itself and
> deletable by nobody. Sensitive corrections to the participation ledger go
> through an approval workflow that no administrator can decide for themselves.

> **Status:** Step 16 — legacy historical import. Paper registers from the years
> before this platform existed can be uploaded as CSV or XLSX, staged row by row,
> checked against themselves and against the database, and — once a national
> administrator who did not upload them has approved the batch — written in one
> transaction as verified participation history and permanent legacy wins.
> Nothing authoritative moves before that transaction, no conflict is ever
> silently repaired, and no fake draw records are manufactured for a lottery this
> system never ran. Public winner pages, notifications and citizen accounts remain
> unimplemented.

> **Status:** Step 17 — public application status and official results. Citizens
> can check their own application without an account, by proving they hold its
> receipt, and read the official results of any commune that has published them.
> A concluded draw is not a public one: releasing it is a separate, audited act by
> a national administrator, gated on the result reconciling with every record
> behind it, and there is no way back. Winner names, notifications, citizen
> accounts and the live draw visualizer remain unimplemented.

> **Status:** Step 18 — the public citizen portal. The status lookup, the official
> results, the per-commune result pages, the draw status board and a live draw
> visualiser are real pages now, in Arabic, French and English. The visualiser
> observes and nothing more: it polls the public draw-status endpoint, performs no
> selection of any kind, and a static guard keeps `Math.random` out of the whole
> client. Winner names, notifications and citizen accounts remain unimplemented.

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

| Command                           | Description                                           |
| --------------------------------- | ----------------------------------------------------- |
| `npm test`                        | Every Vitest suite (server needs `TEST_DATABASE_URL`) |
| `npm run test --workspace client` | Public page tests only — jsdom, no database           |
| `npm run test --workspace server` | API and domain tests — needs `TEST_DATABASE_URL`      |
| `npm run lint`                    | ESLint across the whole repository                    |
| `npm run format`                  | Prettier — write                                      |
| `npm run format:check`            | Prettier — check only                                 |
| `npm run typecheck`               | TypeScript project checks for every workspace         |
| `npm run prisma:studio`           | Prisma Studio (visual database browser)               |

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

All of the above render placeholder content only — no business logic.

## UI components

Reusable, generic components live under `client/src/components/ui/`: `Button`,
`IconButton`, `Input`, `Select`, `Textarea`, `Checkbox`, `RadioGroup`, `Badge`,
`Alert`, `Card`, `Modal`, `Dropdown`, `Table`, `Pagination`, `Skeleton`,
`EmptyState`, `ErrorState`, `PageHeader`. The brand accent is a single
`primary-*` color token defined in `client/src/index.css`; status colors
(success/warning/error/info) use Tailwind's stock palettes.

All spacing/alignment uses CSS logical properties (`ps-`/`pe-`, `ms-`/`me-`,
`start-`/`end-`, `text-start`) instead of `left`/`right` so layouts mirror
correctly under RTL.

## Internationalization

The client uses `i18next`/`react-i18next` with translation files under
`client/src/i18n/locales/`. Arabic (`ar`) is the default language and
automatically sets `dir="rtl"` on `<html>`; French and English use `ltr`. All
visible UI text — navigation, the admin sidebar, common actions — goes
through translation keys; no strings are hardcoded in components. Page
_content_ (registration forms, dashboards, etc.) is still untranslated
placeholder text, since that content doesn't exist yet.

## Geographic data

Read-only API, seeded from Algeria's official wilaya/commune reference data:

| Endpoint                        | Description                               |
| ------------------------------- | ----------------------------------------- |
| `GET /api/wilayas`              | All active wilayas                        |
| `GET /api/wilayas/:id`          | A single wilaya                           |
| `GET /api/wilayas/:id/communes` | Communes belonging to that wilaya         |
| `GET /api/communes`             | All active communes (`?wilayaId=` filter) |
| `GET /api/communes/:id`         | A single commune                          |

Each record carries `nameAr`/`nameFr`/`nameEn` together, so clients pick the
label matching the active locale without extra requests. On the frontend,
`WilayaSelect`/`CommuneSelect` (`client/src/components/geo/`) are reusable,
API-backed selectors — no commune/wilaya data is hardcoded in React; changing
the wilaya resets the commune selection.

See [docs/geographic-data.md](docs/geographic-data.md) for the source dataset,
normalization, and seeding process.

## Participants

A `Participant` is one real person — exactly one record per national ID —
and answers only "who is this person?". Draw year, commune, status, weight
and entry type belong to the future annual-application models, which will
reference a participant by `id` rather than duplicating the person.

| Endpoint                                           | Description                     |
| -------------------------------------------------- | ------------------------------- |
| `POST /api/participants`                           | Register a new identity record  |
| `GET /api/participants/:id`                        | Fetch by internal id            |
| `GET /api/participants/by-national-id/:nationalId` | Fetch by national ID (any form) |

These endpoints expose personal data, so they require an authenticated
`SUPER_ADMIN` session. They are national rather than geographically scoped
because a participant has no commune of their own — see
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
`DEV_ADMIN_USERNAME` / `DEV_ADMIN_PASSWORD` in `.env`. There is no default
password: with those unset, no account is created. For production use the
controlled bootstrap, `npm run admin:create`.

See [docs/authentication.md](docs/authentication.md) for the cookie strategy,
the CSRF decision and its deployment constraint, and the first-administrator
procedure.

## Citizen registration

Public and account-free: a citizen submits one application per draw year, for
exactly one commune.

| Endpoint                                    | Auth | Purpose                     |
| ------------------------------------------- | ---- | --------------------------- |
| `POST /api/applications`                    | no   | Submit an application       |
| `GET /api/applications/registration-window` | no   | Current draw year and state |

A **Participant** is who someone is; an **Application** is how they take part
in one year. Identity is never copied onto an application.

"One application per person per draw year" holds whether someone applies alone,
as a primary, or as somebody's partner — enforced by a
`(draw_year, participant_id)` primary key on `application_participants` rather
than by application code, so concurrent submissions resolve correctly.

Every successful registration returns a receipt carrying a reference like
`HZ-2027-MES-8F42K1` and nothing personal. See
[docs/registration.md](docs/registration.md).

## Eligibility

Whether an application may take part is a separate question from whether the
request was well-formed, and it has a single home.

| Endpoint                                      | Auth | Purpose                        |
| --------------------------------------------- | ---- | ------------------------------ |
| `GET /api/admin/applications/:id/eligibility` | yes  | Review one application, scoped |

The rules are a **pure function** — no database, no clock, no randomness — so
re-evaluating an unchanged application always reaches the same verdict.
Registration and administrative review both go through it, which is why an
application cannot be accepted under one set of rules and judged by another.

Reason codes (`PARTICIPANT_HAS_ALREADY_WON`, `DUPLICATE_ANNUAL_APPLICATION`, …)
are for administrators. A citizen never sees them: naming the exact rule would
confirm which national IDs exist and who has won before, so several distinct
reasons collapse onto one deliberately vague public message.

Status is `PENDING` → `ELIGIBLE` / `INELIGIBLE`, written only by the server.
Eligibility's duplicate check is a read and may lose a race; the
`(draw_year, participant_id)` constraint remains what actually guarantees one
application per person per year.

See [docs/eligibility.md](docs/eligibility.md).

## Participation history

What happened to a person in previous draw years — the future input to priority
weighting, and the third record in the model alongside Participant ("who is
this?") and Application ("how are they taking part this year?").

| Endpoint                                  | Auth | Purpose                               |
| ----------------------------------------- | ---- | ------------------------------------- |
| `GET /api/admin/participants/:id/history` | yes  | One person's years, filtered by scope |
| `GET /api/admin/history/:id`              | yes  | One record, scoped to its commune     |

Records carry a `source` (`LEGACY_IMPORT` / `APPLICATION` / `ADMIN_CORRECTION`),
a `verified` flag and free-text `notes`, so gaps and uncertainty in transcribed
paper registers stay explicit. Imported history does not count toward anything
until a human vouches for it.

**A missing year is not a non-participation.** No record means the ledger has no
authoritative information; an explicit `participated = false` means it knows the
person did not take part. The streak calculation walks backward over _years_
rather than over rows, so a hole in the register stops the count instead of
being quietly bridged.

Nothing is stored that could drift: there is no `consecutive_years` column and
no weight. The streak is derived on demand, and turning years into a lottery
weight is a later, separate decision.

Authorization is on each record's own commune, never on the participant — a
person may take part in different communes in different years, and an
administrator is never told about the years outside their territory.

See [docs/participation-history.md](docs/participation-history.md).

## The draw pool

The lottery must never draw from live application rows. Eligibility, weights
and participation history all keep moving, and a draw run against shifting data
could not be reproduced or defended afterwards. So when a commune's draw is
ready, its input is frozen.

| Endpoint                                          | Auth | Role        | Purpose                     |
| ------------------------------------------------- | ---- | ----------- | --------------------------- |
| `POST /api/admin/commune-draws/:id/validate-pool` | yes  | any admin   | Dry run; changes nothing    |
| `POST /api/admin/commune-draws/:id/freeze-pool`   | yes  | SUPER_ADMIN | Snapshot and lock, once     |
| `GET /api/admin/commune-draws/:id/pool`           | yes  | any admin   | The frozen entries, scoped  |
| `GET /api/admin/commune-draws/:id/pool/summary`   | yes  | any admin   | Aggregates and hash, scoped |

Validation recomputes every weight and re-evaluates every application against
the current facts, and **repairs nothing**. A weight that has gone stale, an
application that no longer evaluates as eligible, a participant since recorded
as a winner — each blocks the freeze and is reported with a typed code.

Freezing and locking happen in one transaction, so there is never a locked
commune draw without a pool nor a pool whose terms can still change. Concurrent
freezes resolve to exactly one authoritative pool. The snapshot is immutable —
enforced by database triggers, not merely by the absence of an endpoint — and
carries no names, national IDs, dates of birth or phone numbers.

Every pool has a SHA-256 hash over a deterministic canonical form, for
integrity only. It is **not** a random seed: deriving the draw's randomness
from its input would make the outcome a function of who entered.

Nothing about a pool is public.

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

**An audit record is not application data.** Application data says what is true
now and changes when the truth changes; an audit record says what somebody did,
which never stops being what they did. So nothing updates or deletes one — a
database trigger refuses both, whoever issues it, including a `SUPER_ADMIN`. The
administrators are exactly the people the trail exists to hold to account, so a
trail they can edit is not a trail. There is no "clear audit log" and no retention
job.

Records are written **in the same transaction as the mutation they describe**, so a
change exists if and only if its record does. There is deliberately no queue: an
audit insert that failed silently would leave a mutation with nobody's name on it.

The actor is always the session's user. A body containing `actorUserId` is refused
with a 400 rather than accepted with the field ignored.

**Nothing personal goes in.** National IDs, phone numbers, names, dates of birth,
passwords and tokens are refused outright rather than masked — a silently stripped
field leaves a record that looks complete while describing something else. A failed
login records nothing about the attempt at all: naming the username tried would
turn the trail into a list of guessed accounts, and recording whether it existed
would answer through the audit log the question the generic 401 refuses to answer.

Visibility is scoped, and stricter than elsewhere: an unscoped row is a _national
action_ — an administrator's privileges changing, the system being configured — so
scoped administrators see their own territory and never the nation's.

**Separation of duties is structural.** An administrator who can see a record they
believe is wrong cannot rewrite it; they raise a request and somebody else decides.
Nobody reviews their own — checked in the service and by a CHECK constraint. An
approval and a rejection are permanent: there is no path from one to the other, so
a changed mind is a new request.

See [docs/audit-and-governance.md](docs/audit-and-governance.md).

## Legacy historical import

The paper registers from before this platform existed are the only record of who
has been waiting how long — and that record is what becomes priority in future
lotteries and lifetime exclusion from them.

| Endpoint                               | Auth | Role        | Purpose                          |
| -------------------------------------- | ---- | ----------- | -------------------------------- |
| `POST /api/admin/imports`              | yes  | any admin   | Upload a CSV/XLSX register       |
| `GET /api/admin/imports`               | yes  | any admin   | Batches touching your territory  |
| `GET /api/admin/imports/:id/summary`   | yes  | any admin   | Counts over the rows you may see |
| `GET /api/admin/imports/:id/conflicts` | yes  | any admin   | Only what blocks                 |
| `POST /api/admin/imports/:id/approve`  | yes  | SUPER_ADMIN | Never your own upload            |
| `POST /api/admin/imports/:id/execute`  | yes  | SUPER_ADMIN | The one transaction that writes  |

**Nothing authoritative moves until the end.** An upload creates a batch and a
pile of staged rows and touches no participant, no historical record and nobody's
winner status. The rows are checked three times — on their own, against the rest
of the file, and against the database — an administrator reads the conflicts, a
_different_ national administrator approves, and only then does one transaction
write all of it or none of it.

**Unknown is not false.** An empty participation cell is a gap in the register,
not a claim that somebody stayed home. Missing required values are errors, and a
staged row keeps `NULL` rather than a manufactured `false`.

**Nothing is silently repaired.** A name that disagrees with the identity
registry, a year that disagrees with the ledger, a win that disagrees with a
lifetime exclusion, two rows that disagree with each other — each is reported and
blocks the batch. Existing participants are reused untouched, `has_won_hajj` is
never cleared, and an authoritative historical record is never overwritten.

**No fake draw records.** A legacy winner is a `LegacyWinner` row naming the
import batch and the source line, not a manufactured `DrawResult` and
`DrawWinner` describing a lottery this system never ran. Both models carry the
same invariant — one win per person, for life.

An approved import writes `verified: true`: the review a national administrator
gave the batch _is_ the verification the flag records. Uploads are never written
to disk, formulas are refused rather than evaluated, and re-uploading the same
bytes reports the batch that already holds them.

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

There are no citizen accounts, no passwords and no OTP. A citizen checks an
application by proving they hold its receipt: the reference printed on it, plus the
mobile number given on the application. Both are normalized by the same functions
the rest of the system uses, so writing a number `0555 12 34 56` or `+213555123456`
is the same number and a formatting difference never tells somebody their own
application does not exist.

**The lookup must not become an oracle.** An endpoint that says "wrong number" for
a real reference and "no such reference" otherwise is a map of who applied. So an
unknown reference, a wrong number, a malformed reference and an applicant who gave
no number all produce byte-identical responses; the verification runs in constant
time and always runs, even when there was nothing to compare against; and nothing
else is loaded until it passes.

**A `DrawResult` existing is not a public result.** Execution writes the result the
instant the draw concludes, and treating that as publication would put every
commune's outcome online before anybody had checked it. Publication is a separate
`ResultPublication` record — its existence _is_ the state, so there is nothing to
disagree with it — written by a SUPER_ADMIN in one audited transaction. Scoped
administrators may read their own territory's result and cannot publish it.

Publishing verifies first and **repairs nothing**: winners against the result's own
count, the archive against the winners, lifetime exclusion against the archive, the
frozen pool's fingerprint against what the draw recorded, and the participation
ledger against the pool. Every failure is reported and blocks. It is idempotent —
publishing twice writes no second record and no second audit event — and one-way,
enforced by trigger.

Until a commune publishes, an applicant whose draw has concluded is told
`AWAITING_RESULTS`, and so is every other applicant in that commune, so polling a
reference cannot front-run the announcement.

What is published: the year, the place, the allocation, how many applications the
draw chose from, the winning entries by their own application reference, and the
pool's SHA-256 fingerprint. What is not: names, national IDs, phone numbers, dates
of birth, internal ids, weights, participation history, or the pool itself. Winner
_names_ are deliberately withheld pending an explicit policy decision rather than
exposed by default.

Public results are strongly cacheable and served with `ETag`s; an application
status is `no-store`, and so is every failure on every route — a cached 404 for a
commune that publishes an hour later would be the worst caching bug here. Listings
are paginated with a server-enforced cap, and `?pageSize=10000000` is clamped
rather than honoured.

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

Places are addressed by **official code** throughout, never by a database id, so a
result URL is one that can be read out over the telephone. Wilaya and commune both,
since commune codes are unique only within a wilaya. Geography comes from the
existing public reference API — no commune list is bundled into the frontend.

The status page preserves the API's enumeration resistance rather than undoing it:
one message for every way the lookup can miss, client-side validation that checks
emptiness and nothing else, and a rate-limit message that names no cause. Nothing
is written to `localStorage`, `sessionStorage` or a cookie, the page is `noindex`,
and no reference ever appears in a URL.

**The live draw visualiser performs no lottery logic.** It does not select, sample,
weight, shuffle or randomise anything — `Math.random` is banned across the client
and a test enforces it over the whole source tree, as the server suite already does
for `server/src`. The draw is decided once, on the server, inside one transaction,
from the operating system's CSPRNG.

The transport is **polling a cacheable GET**, not SSE or WebSockets, because the
server exposes no per-selection events to subscribe to — a draw is one transaction,
and publication is a separate deliberate act. Polling widens the further a draw is
from happening, narrows while waiting for the announcement, stops entirely once the
result is published or the tab is hidden, and backs off on failure. Identical URLs
across viewers mean a CDN can serve the whole country from one origin request.

Visual design is restrained on purpose: no wheel, no slot machine, no jackpot
flashing. The one animation is a paced reveal of the published winner list in the
server's own selection order, disabled under `prefers-reduced-motion`, and nothing
about a result requires seeing it move.

See [docs/public-ui.md](docs/public-ui.md).

## Winner processing

Executing a draw is one transaction, run once, and irreversible.

| Endpoint                                    | Auth | Role        | Purpose            |
| ------------------------------------------- | ---- | ----------- | ------------------ |
| `POST /api/admin/commune-draws/:id/execute` | yes  | SUPER_ADMIN | Run the draw, once |
| `GET /api/admin/commune-draws/:id/result`   | yes  | any admin   | The result, scoped |

That single transaction claims the commune draw, verifies and draws from the
frozen pool, records the result with its winners and the random value behind every
selection, sets `has_won_hajj` for every winning individual, archives each of them,
finalizes the pooled applications as `SELECTED` or `NOT_SELECTED`, and writes the
participation ledger. Any failure unwinds all of it, including the claim: the
commune draw returns to `LOCKED` with nothing left behind.

So none of these can occur — a winner recorded without lifetime exclusion, a
person excluded without a winner record, a draw marked complete with winners
missing, or a result that exists alongside a draw that can still be run.

**Concurrency is settled by the database.** The claim is a conditional
`UPDATE ... WHERE status = 'LOCKED'`, so two simultaneous executions serialize on
the row and the loser is told the draw is already complete. An in-memory lock
would work only until a second API instance existed.

There is deliberately no `DRAW_IN_PROGRESS`. The whole draw fits in one
transaction, so an intermediate state would be invisible to every reader and undone
by any failure; a crash simply leaves the draw `LOCKED` and retryable.

**Spots count entries, not people.** A paired application is one lottery entry and
two winners: ten places filled by nine single and one paired application is ten
winning applications and eleven people excluded for life. Both travellers are
winners — marking only the primary would be a bug.

A completed result is immutable by database trigger, a completed commune draw
cannot be reopened or reallocated, and PostgreSQL refuses to commit a `COMPLETED`
commune draw that has no result. Nothing is published: winner publication and
notifications carry their own consent questions and do not exist yet.

See [docs/winner-processing.md](docs/winner-processing.md).

## The lottery engine

Given a frozen pool and a number of places, which entries are selected — and
nothing else. The engine is a consumer of the draw pool: it never reads a live
application weight, never re-evaluates eligibility, and never touches
participation history.

Each round maps the entries still in play onto one contiguous integer range and
draws a single value inside it:

```
  A weight 2   B weight 5   C weight 3        total 10
  [0 1]        [2 3 4 5 6]  [7 8 9]

  r drawn from [0, 10)   →   the first entry whose cumulative weight exceeds r
```

The winner is then removed and the total recomputed, so nobody can be selected
twice and every remaining entry's share of the next round rises. All arithmetic
is integer; no floating point touches a weight or a random value.

Randomness comes from `crypto.randomInt`, Node's cryptographically secure uniform
integer generator. **`Math.random` is forbidden**, and a test scans every server
source file to enforce it rather than relying on review. So are timestamps,
UUIDs, database ids and — emphatically — the pool's own hash: randomness derived
from the input would make the outcome a function of who entered, and anybody
holding the pool could compute the winners in advance. The engine verifies that
hash before drawing and then never uses it again.

The random source is a one-method interface injected as a dependency, so a test
can supply a fixed sequence and assert an exact outcome. A seeded PRNG never
becomes the production source to make testing easier.

A selection **writes nothing**: no winners, no `has_won_hajj`, no lifecycle
change, no audit row, not even a log line. It also has **no HTTP endpoint** —
because nothing yet records that a draw has been run, two calls would produce two
equally authoritative sets of winners, and a route would let an administrator
re-roll until they liked the outcome. The guard against that belongs with winner
processing, so until then this is a service without a route.

A pool smaller than its allocation is **refused** (`INSUFFICIENT_DRAW_ENTRIES`),
never truncated. Freezing permits that situation on purpose, so whether an
undersubscribed commune awards every applicant a place is a policy decision — one
that will not be made by a `Math.min` inside a sampling function.

See [docs/lottery-engine.md](docs/lottery-engine.md).

## Draw configuration

Which year the lottery is running, and how many pilgrimage places each commune
has. The lottery is run **per commune**, so there are two independent
lifecycles: `DrawYear` for the national cycle, `CommuneDraw` for one commune's
own draw.

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

**`allocated_spots` is configuration, never a calculation.** It is not derived
from the number of applicants, the population, or past winners. A commune with
12 places and 843 eligible applications is the ordinary case, and registration
never refuses an application for being oversubscribed — the draw will later
choose between them.

At most one draw year may be open for registration at a time, enforced by a
partial unique index rather than by checking first. Registration takes its year
from that row and refuses a commune with no configured draw, so nobody can file
an application into a lottery that will never run. `DRAW_YEAR` and
`REGISTRATION_OPEN` are no longer environment variables.

Once a commune draw is `LOCKED` its allocation is fixed for everyone, including
the administrator who set it.

See [docs/draw-configuration.md](docs/draw-configuration.md).

## Weighting

How strong an eligible application's claim is, derived from verified
participation history. Nothing selects winners yet.

| Endpoint                                 | Auth | Purpose                  |
| ---------------------------------------- | ---- | ------------------------ |
| `GET /api/admin/applications/:id/weight` | yes  | Inspect a weight, scoped |

An individual's weight is their consecutive verified non-winning streak **plus
one** — taking part earns a baseline of 1, and each year of being passed over
adds one on top, so a streak of 0, 1 or 5 weighs 1, 2 or 6. Added rather than
floored, so that the first year of patience actually counts for something, and
so a weight of zero — which would make somebody undrawable by arithmetic rather
than by the eligibility rules — never arises. A **paired application takes the
higher of its two weights**, so pairing with someone newer never costs a
long-waiting applicant the claim they have built up.

Calculating a weight never writes; freezing one does, and says so in its name.
Once frozen, a weight is the claim that application **entered with**: verifying
a legacy record next month may grow the live streak, but the snapshot stands,
because a draw run against weights shifting underneath it could not be
reproduced or defended. Administrators can see the divergence; nothing acts on
it automatically.

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
