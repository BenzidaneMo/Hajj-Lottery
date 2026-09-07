# Administrator authentication

Step 05 established administrator **identity**. Authorization — what a
`SUPER_ADMIN`, `WILAYA_ADMIN` or `COMMUNE_ADMIN` may actually do, and which
wilaya or commune they are scoped to — is deliberately not implemented yet.

## Architecture

Server-side sessions, stored in PostgreSQL through Prisma.

1. `POST /api/auth/login` verifies credentials with argon2id.
2. On success the server generates a 256-bit random token, stores **only its
   SHA-256 digest** in `sessions.token_hash`, and returns the raw token in an
   `HttpOnly` cookie.
3. Subsequent requests are authenticated by `requireAuthenticatedUser`, which
   hashes the cookie value and looks the session up.
4. `POST /api/auth/logout` deletes the row, so the session dies server-side —
   a captured cookie is worthless afterwards.

Because only the digest is persisted, a leaked database dump cannot be
replayed as a live session. And because the token is random rather than
signed, there is no session secret to manage or rotate.

| Endpoint                | Auth required | Purpose                    |
| ----------------------- | ------------- | -------------------------- |
| `POST /api/auth/login`  | no            | Establish a session        |
| `GET /api/auth/me`      | yes           | Current administrator      |
| `POST /api/auth/logout` | yes           | Revoke the current session |

`requireAuthenticatedUser` answers only "who is calling?". Role checks arrive
as a separate `requireRole(...)` middleware so the two can never be conflated
at a call site.

## Cookie and session strategy

| Attribute  | Value               | Why                                               |
| ---------- | ------------------- | ------------------------------------------------- |
| `HttpOnly` | always              | JavaScript cannot read it, so XSS cannot steal it |
| `Secure`   | production only     | local development runs over plain HTTP            |
| `SameSite` | `Lax`               | primary CSRF defence (see below)                  |
| `Path`     | `/api`              | never sent to anything but the API surface        |
| `Max-Age`  | `SESSION_TTL_HOURS` | 8 hours by default                                |

Nothing authentication-related is kept in `localStorage`, and the frontend
never sees a token — it only knows whether `GET /api/auth/me` succeeds.

Expired sessions are deleted when next presented, and
`AuthService.purgeExpiredSessions()` exists for periodic cleanup. Deactivating
a user revokes all of their sessions on their next request.

## CSRF

**No CSRF token framework is used.** The protection is layered:

1. **`SameSite=Lax`** — browsers will not attach the session cookie to
   cross-site requests, including the form posts that CORS does not preflight.
2. **Explicit CORS allowlist** — `CLIENT_ORIGIN` is parsed into a list of
   permitted origins and served with `credentials: true`. A wildcard origin is
   never emitted, and is in any case invalid alongside credentials.
3. **`verifyRequestOrigin`** — state-changing requests (`POST`/`PUT`/`PATCH`/
   `DELETE`) carrying an `Origin` header that is not on the allowlist are
   rejected with `403`. A missing `Origin` is allowed, since non-browser
   callers omit it and are not subject to CSRF.

> **Deployment constraint this creates:** `SameSite=Lax` only sends the cookie
> when the admin client and the API are **same-site**. In production they must
> share a registrable domain (`admin.example.dz` + `api.example.dz`), or be
> served as one origin behind a reverse proxy. Splitting them across unrelated
> domains would require `SameSite=None`, which removes defence (1) and would
> mean adopting real CSRF tokens.

## First administrator

There is no default administrator and no default password anywhere in the
codebase. Credentials come only from environment variables, and if they are
absent, **no account is created**.

**Development:**

```bash
# in .env
DEV_ADMIN_USERNAME="dev.admin"
DEV_ADMIN_PASSWORD="a sufficiently long dev password"

npm run seed:admin
```

This refuses to run when `NODE_ENV=production`. Re-running it resets the
development password, so it is idempotent.

**Production bootstrap:**

```bash
ADMIN_USERNAME="…" ADMIN_PASSWORD="…" npm run admin:create
```

Pass the credentials as one-off environment variables — do not commit them to
`.env`. The script refuses passwords shorter than 12 characters, and if the
administrator already exists in production it exits without touching the
password, so it can never be used to overwrite a live account.

Change the password after the first sign-in. A self-service password change is
not implemented yet.

## Brute-force protection

`POST /api/auth/login` is rate limited to 10 failed attempts per 15 minutes,
keyed by **IP address and submitted username together**, so one attacker
cannot lock a real administrator out and a shared NAT does not lock out
everyone behind it. Successful logins do not consume the budget.

The store is in-memory: running more than one API instance gives each its own
budget. A shared store belongs with that deployment change.

## Failure responses

Every authentication failure — unknown username, wrong password, deactivated
account, malformed body — returns exactly the same `401` with
`Invalid username or password`. `AuthService.verifyCredentials` returns `null`
in all of those cases so the distinction cannot leak by accident, and a dummy
argon2 verification runs on the unknown-user path so response timing does not
reveal which usernames exist.

## The temporary internal API key is gone

`x-internal-api-key` (Step 04) has been removed. The participant endpoints it
guarded now require a real session plus `requireRole(SUPER_ADMIN)`, so the
shared secret — which had no identity, no roles and no audit trail, and
bypassed both — no longer exists anywhere in the codebase or configuration.
See [authorization.md](authorization.md).

## Not yet implemented

- Password change and reset flows
- Session listing/revocation UI, and "sign out everywhere"
- Audit logging of authentication events
- Scheduled cleanup of expired session rows
