# Showcase: Cloudflare Quick Tunnel

How to run the finished application on one Windows PC and expose it temporarily to the
internet with `cloudflared`'s Quick Tunnel, so it can be shared for demonstration
purposes — not a production deployment guide.

## The shape of it

```
Internet visitor
      │  HTTPS
      ▼
Cloudflare Quick Tunnel (random https://xxxx.trycloudflare.com)
      │  HTTP, to a port on this machine only
      ▼
Express (server/dist) — serves the client's production build AND /api/*
      │
      ▼
PostgreSQL
```

One process, one port, one public origin. That is deliberate: it is what lets the
browser call `/api/...` relative to whatever host it was loaded from, instead of a
hardcoded API origin that would only be correct for `localhost` and break for
everyone visiting through the tunnel — see "Why one origin" below.

## What changed in the codebase to make this possible

Three small, additive changes — nothing about routing, CORS strategy, or cookie
security was redesigned; see [docs/authentication.md](authentication.md) for the
cookie/CORS model itself, which already anticipated a same-origin production
deployment and needed no changes.

- **`server/src/app.ts` serves the client's build.** When `NODE_ENV=production`
  and `client/dist` exists, Express serves it as static files with an
  `index.html` fallback for any unmatched `GET` — required for React Router's
  browser-history routes (`/register`, `/admin/dashboard`, ...) to survive a
  direct link or a refresh. Neither applies to `/api/*`, which is matched (and
  404s as JSON, not HTML) earlier. In development this whole block is
  inert — `dev:client`/`dev:server` are untouched.
- **`client/.env.production`** sets `VITE_API_BASE_URL` to empty, so a
  production build calls `/api/...` relative to the page's own origin rather
  than a baked-in `http://localhost:4000`. `vite build` loads this file
  automatically; local development (`npm run dev:client`, mode "development")
  never reads it and keeps hitting `http://localhost:4000` as before. A real
  future deployment that does split the frontend and API across two hosts
  overrides this in a git-ignored `client/.env.production.local`.
- **`TRUSTED_ORIGIN_SUFFIXES=".trycloudflare.com"`** (server env — you set
  this, see "Running it" below) lets `verifyRequestOrigin` and CORS accept a
  Cloudflare Quick Tunnel's origin: a random `https://xxxx.trycloudflare.com`
  chosen fresh each run, which can never be listed in `CLIENT_ORIGIN` ahead of
  time. Unset by default, so a normal deployment's exact-match allowlist is
  unaffected unless an operator opts in. `trycloudflare.com` is itself on the
  public suffix list, so browsers treat every random subdomain as its own
  site — `SameSite=Lax` still keeps one tunnel's session cookie from riding
  along with a request to a different one, which is what makes trusting the
  whole suffix safe rather than a wildcard. Separately, and needing no
  configuration, the server's own `http://localhost:<PORT>` is always
  trusted too — that's what lets testing the production build locally (before
  ever starting a tunnel) work without touching `CLIENT_ORIGIN`; a remote
  visitor's browser can never be made to send that Origin, since their
  "localhost" is their own machine, not this one.
- **`app.set('trust proxy', 1)`**, always on. `cloudflared` is the only thing
  that can reach the app's port once it's tunnelled, and it forwards the real
  visitor address via `X-Forwarded-For`. Without this, every rate limiter
  (`express-rate-limit`, keyed by `req.ip` for login attempts, registrations,
  and status lookups) would see every tunnelled visitor as the same loopback
  address — one mistyped admin password could 429 every other visitor for 15
  minutes. It is a no-op with nothing in front, so local development is
  unaffected.

## Why one origin

`SameSite=Lax` (the session cookie's CSRF defence, see
[docs/authentication.md](authentication.md)) does not attach the cookie to a
cross-site `fetch`/`XHR`. If the public portal and the API were reachable at two
different hostnames, the admin console's API calls through the tunnel would
silently lose the session cookie. Serving both from the one Express process,
behind the one tunnel, avoids the question entirely.

## Prerequisites

- Dependencies installed (`npm install`) and a migrated PostgreSQL database
  (`npm run prisma:migrate`) — see the root [README.md](../README.md) Setup section.
- Demo data: a draw year, commune draws, and some applicants to show off the
  pipeline end to end. `npm run prisma:seed` gives geography plus a handful of
  dev participants; `npm run seed:mock-applications` (optionally
  `-- --wilaya=<code>`) bulk-registers synthetic applicants through the real
  registration path for a fuller pool. An administrator account
  (`npm run seed:admin`, from `DEV_ADMIN_USERNAME`/`DEV_ADMIN_PASSWORD` in
  `.env`) is what you'll sign into `/admin` with.
- [`cloudflared`](https://github.com/cloudflare/cloudflared) installed. No
  Cloudflare account, domain, or DNS is needed for a Quick Tunnel.
- One line added to your `.env` (once, not per-session):
  ```
  TRUSTED_ORIGIN_SUFFIXES=".trycloudflare.com"
  ```
  Without it, the tunnel's page loads but every sign-in, registration, or
  other state-changing request gets a `403 FORBIDDEN_ORIGIN` — see the CORS
  bullet above.

## Running it (Windows, three terminals)

**Terminal 1 — PostgreSQL.** However you normally run it locally (service,
Docker, etc.) — this doc doesn't change that.

**Terminal 2 — the application, in production mode:**

```powershell
npm run build
$env:NODE_ENV = "production"
npm run --workspace server start
```

`$env:NODE_ENV = "production"` sets it for this PowerShell session only — it
does not touch `.env`, so your usual `npm run dev:server` is unaffected
afterwards. Confirm the log line reads
`Server listening on http://localhost:4000 (production)` — that ("production")
is what turns on both the static-file serving above and `Secure` session
cookies. (`http://localhost` is treated as a secure context by modern
browsers, so `Secure` cookies still work when you test locally before
tunnelling.)

**Terminal 3 — the tunnel**, once Terminal 2 is listening:

```powershell
cloudflared tunnel --url http://localhost:4000
```

`cloudflared` prints a temporary URL, e.g. `https://random-words-1234.trycloudflare.com`.
That is what you share. It is:

- **Temporary** — a fresh one is issued every time you start the tunnel.
- **Only reachable while all three terminals stay running and the PC stays on.**
  Closing any one of them ends the demo.
- **Not a deployment** — there is no DNS record, no persistent Cloudflare
  configuration, and nothing here creates one.

## The `/admin` console is part of the showcase, on purpose

`/admin` is deliberately reachable through the tunnel, using whatever
`DEV_ADMIN_USERNAME`/`DEV_ADMIN_PASSWORD` (or `npm run admin:create`) account you
seeded. It is not hidden, disabled, or mocked — a visitor signing in sees the real
dashboard, participants, commune draws, pool freeze/execute/publish workflow,
reserves, legacy import, approvals, and audit log, backed by whatever data is
actually in your local database.

That means the data in the database at showcase time is what visitors will see
and can interact with. Use seeded/synthetic data
(`prisma:seed`, `seed:mock-applications`) — never a database populated with real
national IDs, phone numbers, or credentials. If you've only ever run the seed
scripts locally, there's nothing to change here; just don't point this setup at
a database you've used for anything real.

## Validating before you post the link

Local (`http://localhost:4000`, Terminal 2 running, before starting the tunnel):
homepage, `/register`, `/application-status`, `/winners`, `/draw`, `/about`,
`/admin/login` → sign in → `/admin` dashboard and a couple of its sub-pages,
refreshing on at least one nested route of each (public and admin) to confirm
the SPA fallback works.

Through the tunnel, from another device on a different network (e.g. a phone on
mobile data, not the same Wi-Fi): repeat the same list, plus watch the browser's
network tab for any request still pointed at `localhost` — if the client build
was produced without `client/.env.production` in place (e.g. a build from before
this setup existed, still cached in `client/dist`), rebuild with `npm run build`.
