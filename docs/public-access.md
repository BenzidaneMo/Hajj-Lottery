# Public access

Everything a citizen can reach without an account: checking their own application,
reading official results, and seeing where each commune's draw stands.

This is the first part of the system that faces the public rather than an
administrator, and the design pressure is different in kind. Every other document
here is about getting a decision right. This one is about giving away as little as
possible while still being useful, and about surviving the four moments when
everybody in the country loads the same page within ten minutes of each other.

## The surface

| Endpoint                                                     | Auth | Purpose                          |
| ------------------------------------------------------------ | ---- | -------------------------------- |
| `POST /api/public/application-status`                        | no   | Check your own application       |
| `GET /api/public/results`                                    | no   | Published results, paginated     |
| `GET /api/public/results/:drawYear/:wilayaCode/:communeCode` | no   | One commune's official result    |
| `GET /api/public/draw-status`                                | no   | Where each commune's draw stands |
| `POST /api/admin/commune-draws/:id/publish-result`           | yes  | SUPER_ADMIN releases a result    |

There is no authentication middleware on the public router and there must never
be one. The status lookup verifies a receipt; that is not a session, and treating
it as one would be the first step towards it becoming a login.

`/api/wilayas` and `/api/communes` were already public — the registration form
needs every commune — and stay where they are. What is new is grouped under one
prefix so that "which paths are public?" has an answer a CDN and a WAF can be
configured from.

## Checking your own application

There are no citizen accounts in this system, no OTP and no SMS. So the
verification is what the applicant already holds: the reference printed on their
receipt, and the mobile number they registered with.

```
POST /api/public/application-status
{ "applicationReference": "HZ-2027-MES-8F42K1", "phoneNumber": "0555 12 34 56" }
```

**Why a POST.** Not for REST reasons. A GET would put a receipt reference and a
mobile number in the request line, where they reach access logs, browser history,
`Referer` headers and every proxy between the citizen and the server, and where a
shared cache would key on them. Neither value is a secret worth much on its own;
writing both into logging infrastructure across the country is still not a
decision anybody would take deliberately.

**Why the phone number and not the national ID.** The national ID is the one value
in this system that identifies a person everywhere else — in the participant
registry, in the paper registers, on every other government service. Accepting it
here would mean a public, unauthenticated endpoint that takes national IDs as
input, which is a thing worth not having regardless of how carefully it is
handled. A phone number is contact information, it is already optional, and it is
never treated as a credential anywhere else in the system either (`phone_verified_at`
is still never set — see [registration.md](registration.md)).

**Normalization.** Both values go through the same functions the rest of the
system uses: `normalizeApplicationReference` folds case, whitespace and dash
style, and `normalizePhoneNumber` folds Arabic-Indic digits, trunk prefixes and
grouping to `+213XXXXXXXXX`. A formatting difference telling somebody their own
application does not exist would be a worse failure than most real ones. Nothing
is _substituted_: the reference alphabet deliberately excludes `I`, `L`, `O` and
`U`, so guessing that a typed `O` meant `0` is never necessary and never done.

**Applicants with no number cannot use it.** A phone number is optional at
registration, and an application submitted without one can never be verified.
That is the correct behaviour — there is no second value to check — and the
registration receipt now says so at the moment it matters rather than leaving it
to be discovered months later.

### It must not become an oracle

The property this endpoint exists to protect is not the confidentiality of a
status. It is that the endpoint must not answer a question nobody asked it.

An endpoint that says _"wrong number"_ for a real reference and _"no such
reference"_ otherwise is a lookup table for which references exist — which is a
map of who applied, buildable by anyone with a script. So:

- **One failure.** Unknown reference, wrong number, malformed reference and an
  applicant with no stored number all produce the same 404, the same
  `STATUS_LOOKUP_FAILED` code and byte-identical bodies. A test asserts the
  responses are equal as text, not merely similar.
- **Nothing is loaded until verification passes.** The reference lookup and the
  comparison happen together, and the commune draw is only read afterwards. A
  caller who fails cannot be distinguished by what the server did next, because
  the server did nothing next.
- **The comparison is constant-time.** Both sides are hashed to a fixed 32 bytes
  and compared with `timingSafeEqual` (`lib/constant-time.ts`). The hashing is not
  for secrecy — a phone number has far too little entropy for that — it is so the
  comparison runs over the same number of bytes whatever was submitted, which also
  keeps the _length_ of the input from being a channel of its own.
- **The comparison always runs.** When no application matched, the submitted value
  is compared against a sentinel that cannot equal a canonical number. An early
  return for an unknown reference would make "no such application" measurably
  faster than "wrong number".
- **Validation failures are not itemised.** A malformed body gets one message
  rather than a field-level report, because every distinguishable failure shape is
  one more bit a caller can use. The client has the same rules and can say
  something more helpful before sending anything.

This does not make the endpoint perfectly timing-uniform, and it is not trying to
be: the database still does more work for a matching reference than a missing one.
It removes the obvious channels at negligible cost, and the per-reference rate
limit below is what actually bounds a search.

### What comes back

```jsonc
{
  "applicationReference": "HZ-2027-MES-8F42K1",
  "drawYear": 2027,
  "wilaya": { "code": "16", "nameAr": "…", "nameFr": "…", "nameEn": "…" },
  "commune": { "code": "16001", "nameAr": "…", "nameFr": "…", "nameEn": "…" },
  "entryType": "PAIRED",
  "applicantCount": 2,
  "status": "IN_DRAW",
  "drawPhase": "ENTRIES_CLOSED",
  "resultsPublished": false,
  "submittedAt": "2026-11-02T09:14:07.221Z",
}
```

Not present, and a test pins the exact key list: national ID, full name, date of
birth, phone number (not even the one just used to verify), participation history,
streak, computed weight, any internal id, and anything administrative. The only
participant column the service reads at all is `phone_number`, because it is the
one it has to compare.

### Public statuses

The internal `ApplicationStatus` is not exposed. `lib/public-status.ts` maps it,
purely, in one place:

| Internal       | Public                                                      |
| -------------- | ----------------------------------------------------------- |
| `PENDING`      | `SUBMITTED`                                                 |
| `ELIGIBLE`     | `IN_DRAW`                                                   |
| `INELIGIBLE`   | `NOT_ELIGIBLE`                                              |
| `SELECTED`     | `AWAITING_RESULTS` before publication, `SELECTED` after     |
| `NOT_SELECTED` | `AWAITING_RESULTS` before publication, `NOT_SELECTED` after |

**The last two rows are the release gate.** A draw concludes in one transaction
that writes the final status onto every pooled application — the outcome is
settled and stored long before anybody may be told it. Passing that straight
through would turn the status lookup into an early results feed for anyone willing
to poll their own reference: unfair to everybody who waits for the announcement,
and a way to learn the outcome of a draw officials have not finished checking.

Both outcomes collapse onto the _same_ value, not two similar ones, so comparing
two applicants' answers reveals nothing either.

Reason codes never appear. `INELIGIBLE` becomes "not eligible" and nothing more —
naming the rule would confirm which national IDs exist and who has won before, for
exactly the reasons in [eligibility.md](eligibility.md).

## Publication

A `DrawResult` existing is **not** the same as a result being public.

Running a lottery and announcing it are different acts. Execution writes the
result the instant the draw concludes; treating that as publication would mean
every commune's outcome went public the moment a button was pressed, before
anybody had checked it and with no named person having decided it was ready.

So a result is private until a `ResultPublication` row exists for it.

### Why a separate table

`draw_results` is immutable by trigger — it is the evidence a lottery produced —
so there is no column on it anything could set afterwards. Adding one would mean
relaxing that trigger, which is a bad trade for a flag.

And publication is an _event_: it has an actor, a moment and an audit record, none
of which belong on a row describing what a random number generator did. Keeping
them apart is what lets "was this drawn?" and "may the public see it?" stay two
questions with two answers.

There is no status column and no `UNPUBLISHED` row. **The existence of the row is
the publication state**, so there is no second source of truth to disagree with
it.

The row copies `draw_year`, `commune_id` and the published totals from the records
it was verified against. That is the same copy-at-freeze pattern
`DrawPool.allocated_spots` and `DrawWinner.selected_weight` already follow, for the
same reason: the public index is the highest-traffic query in the system and must
be one indexed scan rather than a walk up through `draw_results`, `commune_draws`
and `communes`. Nothing can drift, because every row involved is immutable.

### Who, and how

`POST /api/admin/commune-draws/:id/publish-result`, SUPER_ADMIN only.

Scoped administrators may **read** their own territory's result — they have to be
able to check it — and get a 403 for publishing. National, for the same reason
running the draw is national: nobody should announce the draw they are themselves
subject to. Out-of-scope commune draws still 404 first, before the role is
considered, so ids cannot be probed.

The request body is ignored entirely. There is nothing a caller could usefully
say: the winners, the counts and the moment of the draw all come from records
written when the lottery ran, and the publisher comes from the session. A test
posts a winner count, a timestamp, a publisher id and a winner list, and asserts
every one is ignored.

**Idempotent.** `UNIQUE(draw_result_id)` means a second request cannot write a
second publication, so publishing twice returns 200 with `alreadyPublished: true`,
writes nothing, and — the part that matters — produces **no second audit event**.
Concurrent requests resolve the same way: the loser of the unique index re-reads
and reports the existing publication, and its own audit record rolled back with
its transaction.

**One-way.** There is no unpublish method, and the database would refuse one:
UPDATE and DELETE on `result_publications` raise. Somebody who read an official
result yesterday and somebody reading it today must be looking at the same thing.
If a published result ever has to be retracted, that is a governance workflow with
its own approval and its own record — not an UPDATE somebody can issue.

### The integrity gate

Publication is the last point at which anybody looks at a result before citizens
start quoting it. `lib/result-integrity.ts` is a pure function over counts the
service gathers, and it **refuses rather than repairs**:

| Issue                              | What it means                                        |
| ---------------------------------- | ---------------------------------------------------- |
| `DRAW_NOT_COMPLETED`               | The draw was never run, or was cancelled             |
| `RESULT_MISSING`                   | Completed with no result                             |
| `POOL_MISMATCH`                    | The result names a pool the commune did not freeze   |
| `POOL_HASH_MISMATCH`               | The frozen input no longer matches what was recorded |
| `WINNER_COUNT_MISMATCH`            | Winner rows disagree with the result's own count     |
| `SELECTION_EVENT_MISSING`          | The randomness behind the selections is incomplete   |
| `SELECTION_ORDER_BROKEN`           | Not the contiguous 1..n sequence a draw produces     |
| `ALLOCATION_MISMATCH`              | Winners ≠ the pool's frozen allocation               |
| `WINNER_ARCHIVE_MISMATCH`          | Winning people are not all archived                  |
| `WINNER_EXCLUSION_MISSING`         | An archived winner is not excluded for life          |
| `PARTICIPATION_HISTORY_INCOMPLETE` | The ledger is missing years for people in the pool   |

Every failure is reported, not the first, so an administrator learns the state of
their draw in one round trip rather than one problem at a time.

A result that does not add up is a question for the people who ran the draw.
Quietly correcting it during publication would destroy the only evidence that
anything was ever wrong — and the interesting cases are exactly the ones a repair
would hide. `draw_results`, `draw_winners` and `winner_archive` are immutable by
trigger, so the inconsistencies that can actually arise are in the _mutable_
tables around them: a cleared `has_won_hajj`, a deleted ledger row. Both are
tested, and both block.

The counts are aggregates, not row loads. A commune with a hundred thousand
allocated places must not make this check read a hundred thousand winners.

### Audited

`DRAW_RESULT_PUBLISHED`, written by `AuditService.record` **in the publication's
own transaction**, scoped to the commune, carrying the actor from the session. Its
metadata holds identifiers and counts — no winner is named, and nothing personal
reaches the trail, which `assertSafePayload` would refuse anyway.

No reason is required. Publishing is a routine operational act with an
unambiguous before and after; demanding a sentence for it would train everybody to
type one, which is precisely what
[audit-and-governance.md](audit-and-governance.md) argues against.

## Public results

`GET /api/public/results` lists published results, most recently announced first.
`GET /api/public/results/:drawYear/:wilayaCode/:communeCode` returns one in full.

**URLs use official codes, never database ids.** A citizen addresses a commune the
way official correspondence does, the URL stays valid regardless of what the
database does, and no opaque identifier is published for anybody to enumerate.
Wilaya _and_ commune, because a commune code is unique only within its wilaya
(`@@unique([wilayaId, code])`).

**An unpublished result is absent, not filtered.** The listing reads
`result_publications`, so there is no parameter that could reach an unannounced
result. A commune that has drawn but not published, one that never drew, and a
code that does not exist all return the same 404 — distinguishing them would be a
way to find out which communes have finished drawing but not yet announced, which
is exactly the window in which that is worth something.

### What is published

```jsonc
{
  "drawYear": 2027,
  "wilaya": { "code": "16", "nameAr": "…", "nameFr": "…", "nameEn": "…" },
  "commune": { "code": "16001", "nameAr": "…", "nameFr": "…", "nameEn": "…" },
  "allocatedSpots": 12,
  "entryCount": 843,
  "winnerCount": 12,
  "winningParticipantCount": 14,
  "poolHash": "9f2c…",
  "algorithmVersion": "weighted-csprng-v1",
  "drawnAt": "2027-04-11T10:02:44.108Z",
  "publishedAt": "2027-04-13T08:00:00.000Z",
  "winners": [
    {
      "selectionOrder": 1,
      "applicationReference": "HZ-2027-MES-8F42K1",
      "entryType": "PAIRED",
      "participantCount": 2,
    },
  ],
}
```

**Winner names are not published, and that is a deliberate open decision.** Nothing
here assumes full names are legally appropriate to publish, and the safe default is
to not do it silently. A winner is identified by the reference on their own
receipt, which lets somebody find themselves in the list without the list naming
anybody. If the governing authority requires names, that becomes an explicit,
documented policy change with its own consent question — not a field somebody adds.

**No weights.** The internal `DrawWinnerDto` carries `selectedWeight`;
`PublicWinnerDto` does not, and `toPublicWinner` does not even take one as a
parameter. A weight is how many years that household was passed over, and
publishing it publishes that.

**Paired applications are one winning application.** `winnerCount` counts entries,
`winningParticipantCount` counts people, and the second can exceed the first: ten
places filled by nine single and one paired application is ten winning entries and
eleven pilgrims. The secondary applicant's identity is never exposed — a paired
entry is one row with `participantCount: 2`.

**`entryCount` is published; live applicant counts are not.** How many applications
a draw chose from is the transparency this system exists for, it comes from a
frozen pool, and it is a settled historical fact about a concluded draw. How many
people have applied _so far_ is live and privacy-adjacent, and appears nowhere.

**The pool hash is published.** It is a SHA-256 commitment to the frozen input,
letting anybody confirm a result is the one that was drawn. It is not invertible,
it says nothing about who entered, and — as everywhere else in this system — it is
emphatically not a seed.

**The winner list is not paginated.** It is bounded by the commune's frozen
allocation, which is configuration rather than a function of demand, and an
official result served a page at a time is not an official result. It is also the
most cacheable response in the system, so the expensive case is computed once.

### Ordering

Both listings order by draw year descending and then a stable secondary key, not
by geographic code. Wilaya and commune codes are official numbers stored as text,
so `ORDER BY code` yields 1, 10, 11 … 2; this codebase corrects that in the
application (`lib/geo-order.ts`) because Prisma cannot cast inside `orderBy`.

That correction is incompatible with pagination — sorting after `take` reorders
rows within a page and shuffles them between pages. Recency is a stable SQL order
that paginates correctly, and it is what a public results feed should lead with
anyway. A tie-break on `id` makes the order total, so paging cannot show one row
twice and miss another. Callers who want one commune ask for that commune.

## Draw status

`GET /api/public/draw-status` reports where each commune's draw stands: the year,
whether registration is open nationally, the commune's places, its phase, whether
results are announced, and the winner count once they are.

Phases narrow `CommuneDrawStatus`: `DRAFT` and `READY` both read as `ACCEPTING`,
because the difference between them is administrative preparation nobody outside
the commune office can act on. `LOCKED` is `ENTRIES_CLOSED`, `COMPLETED` is
`DRAWN`, `CANCELLED` is `CANCELLED`.

`DRAWN` says nothing about publication — that is a separate flag. A
drawn-but-unpublished draw is honestly reported as drawn, because withholding even
that would be lying about a fact this endpoint exists to report, while revealing
nothing about who won.

`winnerCount` is **null** until publication rather than zero, so "nobody won" and
"you may not know yet" cannot be confused.

Absent from this response, and asserted by test: any applicant count, any pool
information, the snapshot hash, any weight, any application reference, any
participant. A commune with three applicants and twelve places has told everybody
something about three identifiable households, so no count appears here at all.

## Caching

The distinction that matters is between one citizen's data and a public fact.

| Response                | `Cache-Control`                                                     |
| ----------------------- | ------------------------------------------------------------------- |
| Application status      | `no-store`                                                          |
| One published result    | `public, max-age=300, s-maxage=86400, stale-while-revalidate=86400` |
| Results / draw listings | `public, max-age=60, s-maxage=300, stale-while-revalidate=300`      |
| Any failure, anywhere   | `no-store`                                                          |

**`no-store` is the router-wide default** and the cacheable routes opt out of it on
their success path only. That ordering is deliberate and fail-safe: a route that
forgets to say anything is private, and a 404, a 429 or a validation error stays
out of shared caches even on a route whose successful responses are public. A
cached 404 for a commune that publishes an hour later would be the worst possible
caching bug in this system.

An application status must never enter a shared cache. It is gated by a
verification value rather than a session, so no intermediary can tell one caller's
response from another's — there is nothing to `Vary` on. `no-store` rather than
`no-cache`: the latter permits storage and merely requires revalidation, which is
not the same promise.

Express generates weak `ETag`s for these JSON responses, so a conditional request
gets a 304 and a spike costs bandwidth once rather than per client. A test asserts
the round trip. `stale-while-revalidate` lets a CDN keep serving the last good copy
while it refreshes, which is exactly the behaviour wanted during a spike: the
origin sees one request per interval instead of the whole country's.

Nothing here introduces Redis or an in-process response cache. HTTP caching is the
layer a CDN already understands, it needs no invalidation logic, and a published
result never changes so there is nothing to invalidate.

## Traffic and abuse

These endpoints are expected to be hit by everyone at once four times a year:
registration opening, registration closing, a draw being run, and results being
announced. What the application is responsible for is being cheap and being
cacheable; the CDN, WAF, reverse proxy, distributed rate limiting and traffic
shaping belong to production hardening and are deliberately not built here.

What is built:

- **Every listing is paginated**, with the cap enforced server-side.
  `PUBLIC_PAGE_SIZE_DEFAULT` is 25 and `PUBLIC_PAGE_SIZE_MAX` is 100.
  `?pageSize=10000000` is _clamped, not rejected_ — a broken client is more common
  than an attacker, and serving a hundred rows is more useful than an error. There
  is no unpaginated variant of any route.
- **A page is two queries.** A window and a count, regardless of how many communes
  have published. The published totals are read from the publication row rather
  than aggregated per request, so no listing walks a relation per row.
- **Filters land on indexes.** `result_publications(draw_year, commune_id)` for
  results; `commune_draws` by year and commune, with wilaya nesting through the
  already-indexed `communes(wilaya_id)`, for draw status.
- **The public reads touch no expensive tables.** No pool entry, no participant, no
  audit row, no history record is read by any of them.

### Rate limiting

Only the status lookup takes input worth guessing at, so only it is limited — and
by two limiters, because a single per-IP counter cannot address both attacks.

| Limiter       | Budget       | Window | Keyed by             |
| ------------- | ------------ | ------ | -------------------- |
| Per address   | 120 failures | 15 min | IP (IPv6 → /64)      |
| Per reference | 8 failures   | 1 hour | Normalized reference |

**Neither counts a success.** A citizen refreshing their own status on results day
is not the problem, and making them compete for budget with an attacker on the
same mobile network would punish exactly the wrong person. This is the same rule
the login limiter follows.

**The per-address limit is deliberately loose.** Algerian mobile networks put very
large numbers of subscribers behind shared addresses, so a tight per-IP limit on a
results-day endpoint would lock out a whole carrier because of one person. With
only failures counted, 120 in a quarter hour is far beyond anything a human does by
accident and far below what enumeration needs.

**The per-reference limit is the one that matters.** Somebody who has seen a
receipt — a neighbour, a clerk, a photograph on social media — knows a valid
reference and needs only the number, which is nine digits with a known prefix and a
great deal of local structure. Eight wrong answers an hour makes that search take
longer than the draw year.

It is safe to key on a reference precisely because it reveals nothing: a
nonexistent reference and a real one accumulate failures identically, so being
refused never implies the reference exists. A test asserts that guessing at an
unknown reference is refused too.

**Rate-limit state is not published.** `RateLimit` headers are switched off and the
429 body names neither which limit was reached nor how much budget remains. A
counter that reports its own state tells an attacker how to pace themselves, and a
per-reference counter that reported its state would be answering questions about a
specific reference.

**Both stores are in-memory**, like the login limiter. Several API instances would
each keep their own counters, weakening the ceiling proportionally; a shared store
belongs with that deployment change. The address limiter is ordered first so that a
single source cannot mint unbounded keys in the reference limiter, whose key space
is chosen by the caller.

## Internationalization

Every public payload carries `nameAr`, `nameFr` and `nameEn` together, so the
client renders the active language without a second request and without the server
having to guess who is asking. Names are resolved through the authoritative
`Commune`/`Wilaya` relation and never copied onto a result record.

Statuses, phases and entry types travel as **codes**, not prose. The client maps
`SELECTED`, `AWAITING_RESULTS`, `ENTRIES_CLOSED` and the rest to translation keys
under `public.*` in `client/src/i18n/locales/{ar,fr,en}.json`, exactly as it
already does for eligibility and registration errors. A translated string from the
server would be untranslatable by the client and would make the API's contract
depend on a header.

Arabic is the default locale and flips `<html dir="rtl">`, unchanged from
[the client's i18n setup](../README.md).

## Why the public API never exposes raw records

Three tables in particular, and the reasons differ.

**The participant registry** is the identity spine: one row per national ID, with a
name, a date of birth, a phone number and a lifetime exclusion flag. It is behind a
SUPER_ADMIN session and stays there. A public participant endpoint would answer
"does this national ID exist in the system?", which is a question with no safe
answer — and it is the same question the registration flow, the eligibility reason
codes and this lookup all go out of their way to refuse.

**The draw pool** is the frozen input to a lottery: every eligible application,
with its weight. Published, it would reveal exactly how much priority each
household had accumulated, which is a proxy for how many years they have been
waiting and, in a small commune, for who they are. It is also the input the result
is a function of — publishing it alongside the selection events would let anybody
correlate the two. The hash is published; the pool is not.

**The audit trail** names administrators and the changes they made. It is the
record that holds the people running the system to account, and it is not
application data. Publishing it would expose both the operations of the system and
its staff.

The general rule underneath all three: a public endpoint returns a DTO built field
by field in `lib/public-dto.ts` from an explicitly listed set of columns. Nothing
is spread and no Prisma model reaches `res.json` — because the moment one does, a
column added upstream months later becomes public without anybody deciding it
should be.

## Not in this step

- **Winner names.** Deliberately withheld pending an explicit policy decision.
- **Notifications.** No SMS, no email. The system never contacts anybody.
- **Citizen accounts.** No login, no password, no OTP.
- **A live draw visualizer.**
- **Unpublishing or retracting a result.** Prevented at the database level, and
  correcting a published result would be a governance workflow with an approval —
  not a reverse transition.
- **Distributed rate limiting, CDN and WAF configuration.** The API is designed to
  sit behind them; standing them up is production hardening.
