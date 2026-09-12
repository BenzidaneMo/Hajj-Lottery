# Administrative operations console

The screens an official uses to run a draw: configure it, check its input, freeze
it, run it, publish it, and handle what happens afterwards. Everything under
`/admin`, plus the read endpoints added to support it.

The console is a **view onto server decisions**. It does not evaluate
eligibility, compute a weight, order a reserve list, decide a role or narrow a
territory. Where it appears to — offering only the transitions a lifecycle
permits, hiding a button a role cannot use — it is reading a table the server
also reads, and the server refuses the request regardless of what was rendered.

## Information architecture

| Route                                  | Screen                                           | Who                          |
| -------------------------------------- | ------------------------------------------------ | ---------------------------- |
| `/admin`                               | Dashboard — what needs attention                 | all                          |
| `/admin/applications`                  | Applications table                               | all, scoped                  |
| `/admin/applications/:id`              | One application: applicants, eligibility, weight | all, scoped                  |
| `/admin/participants`                  | National identity registry                       | SUPER_ADMIN                  |
| `/admin/history`                       | One person's participation ledger                | all, scoped                  |
| `/admin/draws`                         | Draw years — the national cycle                  | read all, write SUPER_ADMIN  |
| `/admin/communes`                      | Commune draws and their allocations              | read all, write SUPER_ADMIN  |
| `/admin/communes/:id`                  | One commune's whole workflow                     | read scoped, act SUPER_ADMIN |
| `/admin/winners`                       | Concluded draws, published and not               | all, scoped                  |
| `/admin/imports`, `/admin/imports/:id` | Legacy register pipeline                         | SUPER_ADMIN                  |
| `/admin/approvals`                     | Correction requests awaiting a decision          | SUPER_ADMIN                  |
| `/admin/audit`                         | The trail                                        | SUPER_ADMIN                  |
| `/admin/admins`                        | Administrator accounts                           | SUPER_ADMIN                  |
| `/admin/settings`                      | The session you are working in                   | SUPER_ADMIN                  |
| `/admin/*`                             | An address with no page                          | all                          |

The whole operational sequence for one commune lives on **one** page
(`/admin/communes/:id`) rather than four. It is one sequence, and an operator
following it should not have to hold their place across several screens.

## shadcn/ui as the component foundation

The admin console is built on [shadcn/ui](https://ui.shadcn.com) — Radix
primitives with Tailwind styling, vendored into the repository rather than
installed as a dependency.

**Where it lives.** `client/src/components/shadcn/`, not `components/ui/`.
`components/ui/` already holds the public portal's hand-written kit in
PascalCase (`Button.tsx`, `Table.tsx`), and shadcn generates kebab-case
(`button.tsx`, `table.tsx`) — which collide on a case-insensitive filesystem.
`components.json` points the `ui` alias at the new directory, so
`npx shadcn@latest add <component>` continues to work.

**What is installed.** Only what is used: `alert`, `alert-dialog`, `badge`,
`breadcrumb`, `button`, `card`, `command`, `dialog`, `dropdown-menu`, `input`,
`label`, `pagination`, `popover`, `progress`, `radio-group`, `scroll-area`,
`select`, `separator`, `sheet`, `skeleton`, `sonner`, `table`, `tabs`,
`textarea`, `tooltip`.

Three of shadcn's blocks were deliberately **not** taken:

- **`sidebar`** persists its collapsed state in a cookie. Nothing in this
  application writes to browser storage except the locale preference, and a rail
  that opens and closes is not worth starting. The rail is composed from
  `ScrollArea`, `Separator` and `NavLink` instead.
- **`calendar`** would pull in a date-picker and its locale data to choose two
  days on the audit screen. Native `<input type="date">` is already localised,
  keyboard-operable and correct under RTL.
- **`switch`** was considered for the account "active" column and rejected: a
  toggle implies reversibility, and deactivation is one-way. A badge plus a
  `Deactivate` button says what is actually true.

**Local changes to generated components**, all documented in the files
themselves:

- `badge.tsx` gains `success`, `warning` and `info` variants. A settled outcome
  and a step in progress are different things across every workflow here, and
  shadcn's four variants would have left colour saying nothing.
- `sheet.tsx` gains logical `start`/`end` sides in place of `left`/`right`, so
  the mobile rail slides from the side the language begins on.
- `sonner.tsx` drops `next-themes`, which is a Next.js concern this app does not
  have.
- Physical direction utilities (`pl-`, `pr-`, `ml-`, `right-4`, `text-left`) are
  replaced by logical ones (`ps-`, `pe-`, `ms-`, `end-4`, `text-start`)
  throughout, and directional chevrons carry `rtl:rotate-180`. A test asserts no
  physical utility survives in any admin or shadcn module.

**Custom components** compose those primitives rather than replacing them:
`AdminPage`/`Metric`/`TablePager`, `DataTable`, `StatusBadge`, `ErrorNotice`,
`ConfirmDialog`/`ReasonDialog`/`FactList`, `PlacePicker`,
`DrawLifecycleStepper`, `PoolPanel`, `ResultPanel`.

**Theme (Step 25).** The console was already built on the shared `primary-*`/
`gold-*` ramp and typography rules `index.css` defines for the whole
application (Cairo under `dir="rtl"`, Plus Jakarta Sans otherwise) — a
targeted review found one real outlier: `AdminLogin.tsx`, the one screen
outside `AdminLayout`, still used the public portal's older `components/ui/*`
kit and a literal `bg-stone-50`. It was rebuilt on the same shadcn primitives
(`Card`, `Button`, `Input`, `Alert`, `Label`) everything else here uses, and
the literal background became `bg-background`. No token in `index.css`
changed — the ramp was already right; this was an application-of-existing-
tokens fix, not a new theme.

## Status vocabulary

`components/admin/StatusBadge.tsx` holds one table per domain vocabulary. That
is the whole point of it: without a single mapping, `LOCKED` ends up green on one
screen and amber on another, and an operator learns that colour means nothing.

Colour is never the message. Every badge renders a translated word, so a screen
reader, a monochrome print-out and an operator who cannot distinguish two greens
all receive the same information; the variant only makes severity scannable.

Two choices worth stating. `INELIGIBLE` and `NOT_SELECTED` are neutral, never
destructive — one is the rules applied and the other is the ordinary outcome for
most applicants, and painting either red would report a fault where there is
none. `ABANDONED` is likewise neutral: giving up a place is not a failure of the
person who won it.

## Role-aware navigation and geographic scope

The rail is filtered by `canOpenAdminArea` from
`shared/src/scope.ts` — the same table the server reads. **This is a courtesy,
not a control.** Typing the address of a hidden section renders its page, which
makes its request, which the server answers or refuses; a refusal is displayed
as a refusal.

Scope is never applied in the browser. Every list endpoint intersects the
caller's ceiling with whatever the query string asked for, so a filter can only
narrow:

- A `WILAYA_ADMIN`'s dashboard is **not** the national dashboard with rows
  removed. The server counted only their wilaya, so there is no national figure
  in the response to leak.
- `governance` (import and approval queues) is `null` for a scoped
  administrator, not zero and not omitted.
- The weight **breakdown** and the participation **streak** are withheld from
  scoped administrators, because a person's history spans communes. The console
  says they are withheld rather than showing a blank.
- An out-of-scope resource is a 404 byte-identical to one that never existed.
  The console's 404 wording therefore covers both without implying which.

## Endpoints added for the console

The console needed four aggregate reads that did not exist. Everything else uses
the endpoints Steps 04–20 already built.

| Endpoint                          | Role        | Why it had to be on the server                                                                                                        |
| --------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/admin/dashboard`        | any, scoped | Composing it client-side would be one request per commune and would put every commune's detail in a browser to render a dozen totals. |
| `GET /api/admin/applications`     | any, scoped | Paged and filtered in SQL. Fetching a wilaya and narrowing in React would make the ceiling a page's decision.                         |
| `GET /api/admin/applications/:id` | any, scoped | Applicants for one application, with the identity reduced (below).                                                                    |
| `GET /api/admin/participants`     | SUPER_ADMIN | The registry has no commune, so no scope could narrow it — which is why it is national-only.                                          |

Plus administrator accounts, which had a service (`AdminAccountService`) and no
routes: `GET /api/admin/admins`, `POST /api/admin/admins`,
`PATCH /api/admin/admins/:id/scope`, `POST /api/admin/admins/:id/deactivate` —
all SUPER_ADMIN.

**Step 25** added six more, all covered in their own section below:
`GET /api/admin/imports/template.csv`, `GET /api/admin/imports/template.xlsx`
(any administrator — the templates carry no data, only column names),
`POST /api/admin/commune-draws/batch/validate`,
`POST /api/admin/commune-draws/batch/execute` (SUPER_ADMIN), and
`GET /api/admin/commune-draws` gained real pagination and a `wilayaId`/`status`
filter it did not have before (see _Commune draws_ below).

### Identity in the console

`AdminApplicantDto` carries `nationalIdSuffix` — the last four digits — and no
phone number. Four digits is enough to confirm the person at the counter is the
person on the application, and not enough to copy an identity out of a screen;
`ImportRowDto` made the same choice for the same reason. The unabridged registry
is national work, and no administrative flow here contacts anybody, so a phone
number would be exposure without a use.

A national ID is matched **only in full**, never as a prefix. A registry that
answered "which IDs begin with these digits?" would be a way to discover who
exists. It also never reaches a route: there is no `/participants/:nationalId`,
so an ID cannot end up in browser history, a bookmark, a referrer header or a
screen-share of the address bar.

## The draw workflow

`DrawLifecycleStepper` shows five states, each one the server actually holds:

```
Configured → Settled → Pool frozen → Lottery run → Result published
DRAFT        READY     LOCKED        COMPLETED     (a ResultPublication exists)
```

There is deliberately no "validating" and no "drawing" step. Validation writes
nothing and leaves the draw exactly where it was; execution is a single
transaction with no observable middle. A step for either would show an operator
a position the system cannot be in. `PUBLISHED` is marked done only when the
server reports a publication — never inferred from the draw being finished,
because a result can sit concluded and unannounced for as long as the decision
takes.

Administrative transitions come from `administrativeCommuneDrawTransitions` in
`shared/src/draw-configuration.ts`. Those tables moved to `shared` in this step
so the console can offer only moves that exist; `server/src/lib/draw-lifecycle.ts`
imports the same tables and remains the only thing that decides. `COMPLETED` is
filtered out of the offered set — only winner processing may reach it.

### Pool validation and freezing

Validation is a dry run: it writes nothing, may be repeated, and reports **every**
blocker rather than stopping at the first. Passed and blocked are separate
statements, not two shades of one banner — an operator must never mistake "ready,
with notes" for "cannot proceed". Nothing on the panel offers to repair a
blocker.

The freeze confirmation states the commune, the year, the allocation, the entry
count, the total weight, and the selection breakdown: _N winners and N reserves
— 2N selections in one continuous draw. One selected application occupies one
position._ The operator is asked for none of those numbers, and a test asserts
the dialog contains no input at all. After freezing, the snapshot hash is shown
with a note that it is **not a seed**. There is no unlock button, for anybody.

### Execution

SUPER_ADMIN only. The confirmation lists the frozen pool's entry count and total
weight, the pool hash, `LOTTERY_ALGORITHM_VERSION`, and the 2N breakdown, and
warns that every selected person is excluded from future draws for life.

`executeDraw` sends **no body at all** — not a winner count, not a seed, not an
algorithm version. The server ignores one anyway; sending none makes it plain
that nothing in the browser influences the outcome, and a test asserts the
request body is absent.

There is no polling and no animation pretending a selection is happening. The
backend transaction is the operation; the console shows its result.

## Winners and reserves

The two lists are kept apart, on separate tabs, in separate tables, in the
server's order. `draw_winners` and `draw_reserves` say what the lottery decided
and never move; `winner_abandonments` and `draw_reserves.status` say what has
happened since. Merging them would turn the record of a lottery into a record of
who holds a place today.

- A **withdrawn winner** stays in the winners table, at the same position, with
  the same reference, labelled _Gave up the place_. Never shown as not-selected,
  never moved to the reserve list.
- The abandonment's **reason and explanation are never displayed** on the
  operational list — they may describe a death or an illness.
- A **promoted reserve** keeps its reserve number and stays in the reserve list.
  It is never relabelled "Winner #4".
- The reserve order is rendered exactly as received. `ResultPanel.tsx` contains
  no `.sort(`, no `.reverse(`, and a test asserts it; another test feeds a
  deliberately reversed list and asserts the page shows it reversed.

### Recording a withdrawal

`ReasonDialog` with a `RadioGroup` of `ABANDONMENT_REASONS` and a mandatory
explanation. Both are required before anything is sent. The dialog states, in
words, what it does **not** do: the person remains an original winner of this
draw, their position in the order is unchanged, and their lifetime Hajj win
still stands.

It does not call a reserve. Abandoning and calling are two deliberate requests
so the trail can say who decided what, and a test asserts no `/call` request
follows an abandonment.

### Calling a reserve

There is **no per-row call button**, and a test asserts the reserve table
contains no buttons at all. A button on row 7 would suggest an official could
choose row 7, and choosing within the order is choosing a winner.

Instead, a single action bar offers _Call the next reserve_ when a place is
vacant. The position it sends is the next `WAITING` one as the server's own list
reports it — found, never chosen — and the server refuses any other regardless.

Acceptance uses an `AlertDialog` stating the consequence: the applicant becomes
a Hajj winner, is excluded from every future draw for life, and keeps their
reserve number. For a **paired** reserve the wording changes to say both pilgrims
are promoted together and that it cannot be promoted in part.

Refusal requires an explanation, and states that the place reopens for the next
reserve and that this one is not asked again.

## Commune draws: pagination, allocation editing, batch execution (Step 25)

`GET /api/admin/commune-draws` used to return the caller's entire scope,
unbounded — every commune draw a `WILAYA_ADMIN` or `SUPER_ADMIN` could see, in
one response. It now returns a `Page<CommuneDrawListItemDto>`
(`{ items, page, pageSize, total, totalPages }`), filtered server-side by
`drawYearId`, `communeId`, `wilayaId` and `status` — the same `Page<T>` shape
`AdminConsoleService` already used for applications and participants
(`server/src/lib/pagination.ts`, extracted from that service so the two share
one implementation). Page size is a **closed set** — 10, 25 or 50, whichever
the console offers — validated with `z.coerce.number()` piped into a refine
against exactly those three values, not the general 1–100 admin cap: this
screen has no search box wide enough to justify a bigger page, and a caller
asking for an arbitrary page size the UI never offered is refused, not
silently clamped. `TablePager` gained optional `pageSize`/`onPageSizeChange`/
`total` props for the size selector and the "Showing X–Y of Z" summary; the
audit log's own three-prop call is unaffected.

The list row also gained three booleans — `poolFrozen`, `executed`,
`published` — sourced from a `pool`/`result.publication` include already
folded into the same scoped query, not a second per-row request. They are
existence checks only (`pool !== null`, `result !== null`,
`result.publication !== null`); nothing about a pool's or a result's content
crosses into this list.

### Allocation editing and optimistic concurrency

This editing surface did not exist before Step 25 — there was no dialog
anywhere that sent `allocatedSpots` to `PATCH /api/admin/commune-draws/:id`,
even though the service already accepted it. It was built with a real
concurrency guard from the start rather than added afterward:

- Opening the dialog issues a **fresh** `GET` for that one commune draw. It
  never trusts the row the list last loaded, which can be stale by the time an
  operator clicks the button.
- The allocation input is **disabled**, with the reason stated, whenever the
  freshly-read status is not `DRAFT`/`READY` — the same rule
  `allowsSpotChanges` already enforces server-side, surfaced before the
  request is even attempted rather than after it is refused.
- Submitting sends `expectedUpdatedAt` — the `updatedAt` the fresh `GET`
  returned — alongside `allocatedSpots`. `updateCommuneDrawSchema` requires
  one whenever the other is present. The service does a conditional
  `updateMany({ where: { id, updatedAt: expectedUpdatedAt } })` instead of the
  plain `update` it used before; a `count` of zero means the record moved
  since it was read, and the service throws a dedicated 409
  `COMMUNE_DRAW_ALREADY_CHANGED` rather than writing over somebody else's
  change. `updatedAt` was chosen deliberately over a new `version` column —
  it already existed, was already exposed on the DTO, and mirrors the
  conditional-claim pattern `DrawExecutionService.execute` already uses for
  its own `LOCKED → COMPLETED` transition. Status-only transitions (the
  lifecycle buttons on the detail page) are unaffected and still write
  unconditionally — only an allocation change now carries the token.
- On a 409, the console shows the same generic "This has already changed.
  Reload and try again." text every other conflict already shows — the
  server's own message is never surfaced, conflict or otherwise — and the
  retry re-fetches the fresh record into the still-open dialog rather than
  resubmitting the same stale value.
- There is no client-side cache to invalidate (this app has none — see
  _Performance_ below); a successful save just calls the list's own
  `reload()`.

### Batch draw execution

**Execute All Validated Draws**, SUPER_ADMIN only, scoped to whichever draw
year the commune-draws screen is currently filtered to. It is an
orchestration layer over the existing `DrawExecutionService.execute`, not a
second selection engine — nothing here reads `Math.random`, combines pools
across communes, or derives a seed from the batch, and each named commune
still runs through exactly the same atomic transaction it would if run one at
a time from its own detail page (which keeps its own execute button,
unchanged).

Two requests, always in that order, never collapsed into one:

1. **`POST /commune-draws/batch/validate`** (`{ drawYearId }`) computes a
   readiness preview and changes nothing. A commune is `ready` when
   `status === 'LOCKED'`, a pool exists, and the pool's `entryCount` is at
   least twice the allocation; otherwise it is `notReady` with a reason
   (`NOT_LOCKED`, `NO_POOL`, `INSUFFICIENT_ENTRIES`), or `alreadyCompleted`.
   This check is deliberately coarse — it does not re-verify the pool's hash
   or re-run eligibility, because that is `execute()`'s job and duplicating it
   here would be a second verification engine the two could silently
   disagree with. "Ready" is a preview; `execute()` remains the final word,
   and a commune that slips out of readiness between the two requests simply
   reports its own real error rather than being silently dropped.
2. The console shows the ready/not-ready/already-completed counts and an
   explicit irreversibility warning, and only an explicit confirmation click
   sends **`POST /commune-draws/batch/execute`** (`{ drawYearId,
communeDrawIds }`) — exactly the `ready` ids the first request returned,
   never a freshly re-discovered or widened set. There is no auto-execute
   path anywhere between the two calls.

`executeBatch` loops those ids and calls `drawExecutionService.execute(id,
actor)` **once per commune, each its own independent call** — never one
shared transaction across communes. If one commune fails, the others already
committed stay committed, and the failing one stays in whatever state it was
already in; nothing is rolled back and nothing is retried automatically. Each
outcome is reported as `completed`, `skipped` (the commune turned out to
already be `COMPLETED` — not an error, just nothing left to do) or `failed`
(a real error, with the server's own `ApiErrorCode` attached — e.g.
`INSUFFICIENT_DRAW_ENTRIES`, `COMMUNE_DRAW_NOT_FOUND`). Because the server
answers only once the whole batch has finished — this system has no held
connections or live per-selection events anywhere, on the public side or
here — the console shows a single bounded loading state while the request is
in flight and then renders the complete outcome table at once; it does not
claim to show live per-commune progress a one-shot response cannot provide.

The real concurrency guarantee is unchanged and is **not** re-implemented
here: `execute()`'s own conditional `LOCKED → COMPLETED` claim is what makes
two simultaneous attempts at the same commune resolve to exactly one
success, whether both come from one batch, two batches, or a batch racing a
lone detail-page click. `BatchDrawExecutionService` keeps a small in-process
`Set` of commune-draw ids currently mid-call purely to short-circuit an
obvious double click before it reaches the database — a UX nicety, explicitly
not the safety mechanism, and it knows nothing about a second server
process.

One additional audit event, `COMMUNE_DRAW_BATCH_EXECUTED`, is recorded after
the loop — filed under the draw year (target type `DRAW_YEAR`), carrying the
actor, the targeted/succeeded/failed/skipped counts, and the **failed**
commune-draw ids only. The succeeded ids are not repeated here: each one is
already individually on the trail via that commune's own
`COMMUNE_DRAW_EXECUTED` event (written inside `execute()` itself, unchanged),
so the batch event plus the per-commune events together still let the whole
operation be reconstructed, without a payload that grows without bound for a
large batch.

## Official applicant eligibility rules (Step 25)

Three rules joined the existing deterministic eligibility pipeline
(`server/src/lib/eligibility-rules.ts`), evaluated in the same fixed-order,
pure function every other rule already goes through — there is no separate
engine for these, client-side or otherwise, and the frontend's own checks in
`pages/Register.tsx` are a courtesy that spares a round trip, never the
authority.

- **Minimum age.** An applicant must have completed 19 full years on the
  server's own registration instant — `application.createdAt` on
  re-evaluation, "now" at submission — never the browser's clock, a
  draw-year shortcut, or `drawYear - birthYear`. `calculateAgeAt`/
  `isAtLeastMinimumAge` (`shared/src/eligibility-age.ts`) are the one shared
  implementation, imported by the rules, the registration wizard's own
  immediate feedback, and the legacy-import validator alike — leap days and
  month/day boundaries are handled by comparing calendar dates directly,
  never by subtracting years. Reason codes: `UNDER_MINIMUM_AGE` (primary),
  `SECONDARY_UNDER_MINIMUM_AGE` (paired partner).
- **Mahram.** A female applicant under 45 must be paired with a male Mahram;
  45 or older, pairing is optional. A pair is specifically one female primary
  and one male secondary — male+male and female+female pairs are both
  refused. Reason codes: `MAHRAM_REQUIRED` (a woman under 45 registered
  alone), `INVALID_MAHRAM_GENDER` (the secondary is not male),
  `INVALID_PAIRED_GENDERS` (the pair is not female+male),
  `GENDER_UNAVAILABLE` (an existing identity record predates gender
  collection and cannot satisfy the rule until corrected).
- **Nationality** continues to be established through the existing identity
  registry / national-ID process — Step 25 added no separate nationality
  field or check, by design.

`Participant.gender` (a new nullable `Gender` enum column) carries this.
Nullable because existing records predate its collection; a `null` gender
cannot satisfy the Mahram rule and reports `GENDER_UNAVAILABLE` rather than
guessing. A registration for an existing participant whose stored gender is
still `null` backfills it from the submitted value — the one narrow,
deliberate exception to "existing participants are reused untouched": gender
is being recorded for the first time, not corrected, and without it a
historical participant could never clear the Mahram check in any future
year's application.

**Registration UI.** `pages/Register.tsx` reorders its wizard so the primary
applicant's identity (including gender) is filled in **first**, because
nothing else can be decided before it: a male primary is forced to `SINGLE`
and never shown an entry-type choice; a female primary under 45 is forced to
`PAIRED` (the Mahram step is mandatory, not offered); only a female primary
45 or older sees an actual "on my own or with a Mahram" choice. The secondary
applicant's own gender field is restricted to male wherever the flow reaches
it. This is presentation only — the same three server-side rules above run
again, unconditionally, on submission.

**Legacy import.** The canonical schema
(`national_id, full_name, dob, commune_code, draw_year, participated, won`,
plus optional `phone_number, notes`) gained two more **optional** columns:
`registered_at` (the historical registration date) and `gender`. Neither is
required, because most real registers will not have them, and the importer
never invents either:

- If a file names the `registered_at` column at all, an empty cell on a row
  is `INSUFFICIENT_HISTORICAL_AGE_EVIDENCE` (a warning, not a rejection) — a
  gap in the evidence, not a claim either way. When both `dob` and
  `registered_at` are present and valid, the same minimum-age rule runs
  against them and blocks the row with `UNDER_MINIMUM_AGE_AT_REGISTRATION` if
  it fails, and — because the canonical schema has no historical companion
  column — a woman under 45 with no recorded Mahram evidence is flagged
  `INSUFFICIENT_HISTORICAL_MAHRAM_EVIDENCE` rather than assumed either
  eligible or ineligible.
- If a file names the `gender` column, an empty cell is
  `INSUFFICIENT_HISTORICAL_GENDER_EVIDENCE`; an unrecognised value is
  `INVALID_GENDER`. A row with no `gender` column at all carries no gender
  opinion — this is a genuine gap in what the file can attest, never coerced
  into a value, matching the same "unknown is not false" principle the rest
  of the import already follows for `participated`/`won`.
- A column the file never names at all produces no per-row issue: an
  optional column absent from the header is a schema-level gap the import
  guide already states, not something every row needs to be told about
  individually.

## History, imports, approvals, audit

**History.** Addressed by participant id, reached from an application or the
registry — there is no free-text person search, because a participant has no
commune. Corrections are a tri-state form (`Leave unchanged` by default, so a
submission never re-asserts values nobody meant to touch) plus a mandatory
reason. A scoped administrator's submission creates an `ApprovalRequest` and
changes nothing; a SUPER_ADMIN's applies directly. Nothing is editable inline.

**Imports.** Upload → validate → review → approve → execute. The page states
that uploading writes nothing authoritative. Conflicts are listed and block;
nothing offers to resolve, ignore or override one, and a test asserts no such
control exists. The uploader is not offered a decision on their own batch (the
service and a CHECK constraint refuse it too). Execution warns that past winners
are excluded for life and that there is no un-import. Staged rows show only the
last four digits of a national ID.

**Step 25** added a sample-template pair (`Download Sample CSV`/`Download
Sample XLSX`) and an inline column guide to the upload card, without touching
the staged pipeline itself. Both samples are generated on request
(`server/src/lib/import-sample.ts`) directly from
`REQUIRED_IMPORT_COLUMNS`/`OPTIONAL_IMPORT_COLUMNS` — the same constants
`import-validation.ts` enforces against — so they cannot drift from the real
schema; a server test uploads the generated CSV and XLSX back through the
real validator and asserts every row comes back `VALID` as the strongest
guarantee of that. The two download routes
(`GET /api/admin/imports/template.csv`/`.xlsx`) are registered ahead of
`GET /api/admin/imports/:id` — Express matches route patterns in registration
order, and `template.csv` would otherwise be read as an id — and set
`Content-Disposition: attachment`, since the client and API are different
origins in every environment and a plain anchor's `download` attribute is
ignored cross-origin. The column guide (a dialog, not a new page) lists
required and optional columns, the accepted boolean vocabulary, and states
the historical-data rule verbatim in every locale: _"Missing values will be
logged as gaps, not assumed as non-participants."_

**Approvals.** Approving _is_ applying, in one transaction — the dialog says so.
The author of a request is offered `Withdraw` but not `Approve`/`Reject`. A
decided request offers nothing: `PENDING → decided` happens once, by trigger, and
a changed mind is a new request.

**Audit.** Read-only, and there is no other kind. There are no edit, delete or
clear controls anywhere, and a test asserts the only row action is `View`.
Payloads are rendered key by key; nothing is masked here because
`assertSafePayload` refuses to store an unsafe payload in the first place — what
is present is what was allowed to be recorded. A null actor is labelled _No
signed-in actor_ rather than left blank: a failed login records nothing about the
attempt, and that absence is the point.

## Administrator management

SUPER_ADMIN only, and unscoped: an administrator's authority is not a property of
a territory even when it names one, so a scoped list would tell a `WILAYA_ADMIN`
who can overrule them while hiding everyone else who can.

Four rules, all enforced in `AdminAccountService` and all surfaced before an
operator runs into them:

1. Nobody changes their own role or scope. The row for your own account offers
   no actions at all.
2. Nobody grants reach they do not hold themselves.
3. A `COMMUNE_ADMIN`'s commune must be inside their wilaya — the form follows the
   role rather than validating afterwards, and the composite foreign key rejects
   the inconsistency outright.
4. The last active national administrator cannot be deactivated or demoted. The
   row says so instead of offering a button that fails.

There is **no password reset** and **no deletion**. Changing somebody else's
credential is a different operation with safeguards that do not exist yet, and an
account is the actor on audit records that must outlive it. Deactivation is the
operation, and it revokes their sessions in the same transaction — an account
disabled only for future sign-ins is not disabled.

## Security boundaries

- **Nothing is stored.** No `localStorage`, `sessionStorage`, IndexedDB or
  cookie in any admin or shadcn module; a test scans for all four. The session is
  an HttpOnly cookie the browser attaches and JavaScript never reads.
- **No token, password or key** is held by the client, and a test scans for
  `Authorization:` headers and API-key names.
- **No randomness.** `Math.random` and `crypto.getRandomValues` are banned across
  `client/src`, admin modules included.
- **Only the admin API.** A test collects every `/api/…` literal in the admin
  modules and asserts the set is exactly `/api/admin` and `/api/auth`.
- **No identifying value in an address.** No admin route takes a national ID, a
  phone number or an application reference.
- **The server's own error message is never shown.** `errorMessageKey` maps a
  status to one of a fixed set of translated sentences; an unrecognised failure
  falls back to the generic one rather than leaking what came back.
- **Frontend role state is never authorization.** Every test that concerns a
  role asserts on the request that was sent or on the server's answer being
  honoured — never on a hidden button meaning a blocked action.

## Accessibility

- Every table is named (`aria-label`) and every list has an accessible name;
  pages carry several tables, so unnamed ones would be indistinguishable.
- Loading is a skeleton with the real headings already in place, so the layout
  does not jump; empty says so in words; errors offer a retry.
- Confirmations are Radix `AlertDialog`/`Dialog`: focus is trapped, Escape
  closes, and the page behind is inert. `window.confirm` is never used and a test
  asserts it appears nowhere — it cannot be translated, cannot be read
  right-to-left, and cannot state a consequence in more than one line.
- Forms carry visible `<Label>`s. `ReasonDialog` sets `noValidate` so the
  browser's untranslated bubble does not pre-empt the translated message, while
  the field keeps `required` for assistive technology.
- Status changes announce: the applications count and the pager position are
  `aria-live="polite"`.
- Colour is never the only signal — see _Status vocabulary_.
- `prefers-reduced-motion` is honoured globally in `index.css`, which suppresses
  Radix's open/close animations at the source rather than per component, so a
  component added later cannot forget.

## RTL

Arabic is the default locale and flips `<html dir="rtl">`. The console uses
logical CSS properties throughout — `ps-`/`pe-`, `ms-`/`me-`, `start-`/`end-`,
`text-start` — and a test asserts no physical `pl-`/`pr-`/`ml-`/`mr-` utility
survives in any admin or shadcn module. Directional icons carry
`rtl:rotate-180`. The mobile rail uses `Sheet side="start"`, a logical side added
to the generated component.

Every visible string goes through i18n; there are no hardcoded UI strings, and
the three locale files are structurally identical (1070 keys each, verified).
Numbers and dates use `lib/format.ts`, which maps `ar` to `ar-DZ` so numerals
stay Western as Algerian paperwork writes them.

## Responsive behaviour

Desktop and tablet first. Below `md` the rail becomes a `Sheet`. Tables scroll
inside their own `overflow-x-auto` container, so a long reference never makes the
whole console slide sideways. Metric grids collapse from four columns to two to
one. Tables are not redesigned into cards — an operator comparing rows needs
them aligned.

## Performance

- One request per screen. The dashboard is a single endpoint rather than a fan
  out over communes.
- Paging is bounded server-side (`ADMIN_PAGE_SIZE_DEFAULT` 25,
  `ADMIN_PAGE_SIZE_MAX` 100), and an over-large `pageSize` is refused, not
  clamped. Commune draws narrow that further to a closed set — 10, 25 or 50
  only, see _Commune draws_ above.
- Text search is debounced (`useDebounced`, 350 ms); a request per keystroke
  would be a request storm from one impatient hand.
- Changing a filter resets to page 1 — page 3 of the previous filter is not
  page 3 of this one.
- `useAsync` matches responses to the request that is current, so an overtaken
  response never wins.
- No polling on any admin page. No client-side store and no cache: a stale count
  on an operations screen is worse than a second request.

## Not in this step

Deferred, with the reasons unchanged from Step 19:

- automatic reserve-call expiry; reconsidering a declined reserve; abandonment
  after a promoted reserve;
- result retraction, un-winning, clearing `has_won_hajj`;
- notifications, SMS, OTP, citizen accounts;
- winner-name publication;
- administrator password reset and account deletion;
- distributed rate limiting, CDN/WAF and other production infrastructure.

Deferred from Step 25, specifically:

- **Live per-commune batch progress.** The batch-execute response is one-shot,
  matching this console's existing no-held-connections policy; a progress bar
  that updates commune-by-commune while the request is still in flight would
  need a mechanism (polling a batch-status endpoint, SSE) that does not exist
  anywhere else in this system and was not added for this alone.
  `completed`/`skipped`/`failed` are reported once the whole batch returns.
- **Correcting a `null` gender on an existing participant** outside the
  narrow first-registration backfill described above — there is no admin
  screen to set or fix gender on a participant record directly. Until one
  exists, a legacy participant with no recorded gender stays unable to
  satisfy the Mahram rule (`GENDER_UNAVAILABLE`) until they next register and
  supply it themselves.
- **A historical registration-date field on the participation ledger.**
  `registered_at` exists only as an optional legacy-import column used to
  evaluate age/Mahram evidence at staging time — it is not stored on
  `ParticipationHistory` or anywhere else, so it cannot be inspected,
  corrected or reported on afterward. Re-running the same file re-derives it
  from the file again.
- **A version/edit screen for `updatedAt` conflicts.** A 409
  `COMMUNE_DRAW_ALREADY_CHANGED` is resolved by re-fetching and reapplying the
  edit by hand; there is no three-way merge or diff view.
