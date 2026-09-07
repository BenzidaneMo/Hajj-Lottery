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

These endpoints expose personal data, so they are **not public**: every
request must carry the `x-internal-api-key` header matching `INTERNAL_API_KEY`.
That gate is a placeholder — it fails closed when the variable is unset, and
is replaced by real admin authentication in a later step.

National IDs are normalized in exactly one place
([server/src/lib/national-id.ts](server/src/lib/national-id.ts)): Arabic-Indic
and Persian digits fold to ASCII, separators and invisible bidi marks are
stripped, leading zeros are preserved, and the canonical result must be 18
digits (Algeria's NIN). Uniqueness is enforced by a PostgreSQL unique index,
not only by application code.
