# Authorization and geographic scoping

Step 05 established _who_ an administrator is. This step establishes _what_
they may reach. The two stay separate: `requireAuthenticatedUser` still does
authentication only, and never consults a role.

## Roles

| Role            | Reach                                 |
| --------------- | ------------------------------------- |
| `SUPER_ADMIN`   | National — every wilaya and commune   |
| `WILAYA_ADMIN`  | One wilaya and the communes inside it |
| `COMMUNE_ADMIN` | One commune                           |

Roles are a PostgreSQL enum, mirrored in `shared/src/roles.ts`, with a
compile-time assertion (`server/src/lib/roles.ts`) that the two never drift.

## Two separate gates

- **`requireRole(...roles)`** — mounted at the route. Returns **403**. Used
  where a whole capability belongs to particular roles.
- **Geographic scope** — applied inside the query, not as a separate check.
  Returns **404**.

They answer different questions and are never merged into one middleware.

## Scope is a query filter, not an `if`

Every scoped read builds its `where` clause from the caller's stored scope:

```ts
const ceiling = communeScopeFilter(scopeFor(user)) // the caller's maximum
const narrowing = requested.wilayaId ? { wilayaId: requested.wilayaId } : {}
where: {
  AND: [ceiling, narrowing]
} // intersection only
```

Two properties follow from this shape:

1. **A requested filter can only narrow.** Because the ceiling and the request
   are `AND`ed, a `WILAYA_ADMIN` of wilaya 7 asking for `?wilayaId=8` gets the
   intersection — which is empty — instead of wilaya 8's data. The client
   cannot widen its own scope by editing a query string.
2. **The check cannot be forgotten.** Omitting the filter changes what the
   query returns rather than merely skipping a conditional, so a missing scope
   is a visible bug rather than a silent privilege leak.

`AuthorizationService` is the only place these queries live.

## 403 versus 404

- **Wrong role → 403.** The caller knows their own role, and the endpoint's
  existence is not secret.
- **Right role, wrong territory → 404, byte-identical to a nonexistent id.**
  A `WILAYA_ADMIN` probing commune ids in another wilaya learns nothing: the
  response for "exists but not yours" and "does not exist" is the same. Tests
  assert this equality, so a future "helpful" 403 breaks the build.

## Scope lives in the database, and so do its rules

`users.wilaya_id` and `users.commune_id` are the only authoritative source of
an administrator's reach. Nothing in a request body, query string or cookie
contributes to it.

PostgreSQL enforces the invariants, not just the application:

- A **CHECK constraint** allows only the three legal role/scope shapes
  (national with no places, wilaya-only, wilaya-and-commune).
- A **composite foreign key** on `(commune_id, wilaya_id)` referencing
  `communes(id, wilaya_id)` makes it impossible to store a commune that
  belongs to a different wilaya than the one assigned. This is why `Commune`
  carries an otherwise redundant `@@unique([id, wilayaId])`.

`resolveScope()` fails closed: a record that somehow violates these rules
throws rather than degrading to a wider scope.

## Account safety rules

`AdminAccountService` holds the rules that must hold no matter which endpoint
or script performs the change. The management UI does not exist yet; the rules
do, so they are not reinvented per endpoint later.

- **No escalation.** Only a `SUPER_ADMIN` may grant national access, and a
  scoped administrator may only assign inside their own territory.
- **No self-editing.** Nobody changes their own role or scope, including a
  `SUPER_ADMIN` — a single compromised session cannot widen itself.
- **Last `SUPER_ADMIN` invariant.** Deactivating, deleting or demoting the
  last active `SUPER_ADMIN` is refused with 409. Deactivated accounts do not
  count as cover.
- **Validated assignments.** `validateAssignment` rejects impossible
  combinations with 422 before the database has to, giving a clear error
  instead of a constraint violation.

## Auditing

Not implemented, and no placeholder rows are written. `prepareScopeChange`
returns a `ScopeChangeRecord` — actor, target, previous scope, new scope,
timestamp — which is the shape a future audit log will persist.

## Frontend

`GET /api/auth/me` returns role, active status and the resolved scope
(wilaya/commune with names for display). The sidebar hides areas the role
cannot open, using `ADMIN_AREA_ROLES` from `shared/` so client and server
share one definition.

**None of this is a security control.** Hiding a link is a courtesy; the
server refuses the same request whether or not the link was rendered, and
admin screens request the scoped `/api/admin/...` endpoints, which narrow
server-side regardless of what the client asks for.

## Endpoint map

| Endpoint                        | Auth | Role          | Scope         |
| ------------------------------- | ---- | ------------- | ------------- |
| `/api/wilayas`, `/api/communes` | no   | —             | none (public) |
| `/api/admin/wilayas`            | yes  | any admin     | scoped        |
| `/api/admin/communes`           | yes  | any admin     | scoped        |
| `/api/participants/*`           | yes  | `SUPER_ADMIN` | national      |

The public geographic endpoints stay unrestricted on purpose: the citizen
registration form must be able to list every commune.

Participant endpoints are `SUPER_ADMIN`-only rather than scoped, because a
participant record has no commune — a person is reached through the annual
application that names one, and applications do not exist yet. When they do,
`WILAYA_ADMIN` and `COMMUNE_ADMIN` should reach participants _through_
applications rather than by loosening this rule.

The temporary `x-internal-api-key` from Step 04 has been removed: the
endpoints it guarded now sit behind real authentication and role checks, so
the shared secret that bypassed both no longer exists.

## Not yet implemented

- Administrator management endpoints and UI (the service rules are ready)
- Audit log persistence
- Scoping of applications, participants-through-applications, draws and
  winners — none of those models exist yet
