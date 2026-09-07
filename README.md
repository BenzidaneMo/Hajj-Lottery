# قرعة الحج — Hajj Lottery Platform

A production-oriented web application for running a local communal Hajj
lottery in Algeria: registration, per-commune weighted draws, and
transparent results, across Arabic (RTL), French, and English.

> **Status:** Step 01 — project foundation. Lottery logic, registration,
> authentication, and the admin dashboard are not yet implemented; routes
> exist as placeholders only.

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
| `npm run lint`          | ESLint across the whole repository            |
| `npm run format`        | Prettier — write                              |
| `npm run format:check`  | Prettier — check only                         |
| `npm run typecheck`     | TypeScript project checks for every workspace |
| `npm run prisma:studio` | Prisma Studio (visual database browser)       |

## Internationalization

The client uses `i18next`/`react-i18next` with translation files under
`client/src/i18n/locales/`. Arabic (`ar`) is the default language and
automatically sets `dir="rtl"` on `<html>`; French and English use `ltr`.
Only a small set of sample strings is translated so far — the architecture
(centralized translation keys, a language switcher, automatic RTL) is what
this step establishes.

## Geographic data

See [docs/geographic-data.md](docs/geographic-data.md).
