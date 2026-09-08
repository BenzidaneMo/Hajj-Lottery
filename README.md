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

| Command                 | Description                                   |
| ----------------------- | --------------------------------------------- |
| `npm test`              | Vitest suites (needs `TEST_DATABASE_URL`)     |
| `npm run lint`          | ESLint across the whole repository            |
| `npm run format`        | Prettier — write                              |
| `npm run format:check`  | Prettier — check only                         |
| `npm run typecheck`     | TypeScript project checks for every workspace |
| `npm run prisma:studio` | Prisma Studio (visual database browser)       |

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
