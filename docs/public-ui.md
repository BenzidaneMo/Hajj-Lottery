# Public citizen portal

The citizen-facing half of the platform: four pages that read the public API, plus the draw
visualiser. Everything here is public, account-free and read-only. The server side of the same
surface is documented in [public-access.md](public-access.md), which this document assumes.

There is no citizen login anywhere in this step, no OTP, no SMS, and no client-side session of any
kind. A visitor's whole relationship with this application lasts as long as the tab.

## Pages

| Route                                         | Component                 | Reads                                                         |
| --------------------------------------------- | ------------------------- | ------------------------------------------------------------- |
| `/application-status`                         | `pages/ApplicationStatus` | `POST /api/public/application-status`                         |
| `/winners`                                    | `pages/Winners`           | `GET /api/public/results`                                     |
| `/results/:drawYear/:wilayaCode/:communeCode` | `pages/PublicResult`      | `GET /api/public/results/:year/:wilaya/:commune`              |
| `/draw`                                       | `pages/Draw`              | `GET /api/public/draw-status`                                 |
| `/draw/:drawYear/:wilayaCode/:communeCode`    | `pages/DrawWatch`         | `GET /api/public/draw-status`, then the result once published |

Geography comes from the existing public reference API (`/api/wilayas`,
`/api/wilayas/:id/communes`) through `lib/geo.ts`. **No commune list is bundled into the frontend**
— 1541 communes in three languages is not something to ship twice and let drift.

The layout, header, footer and language switcher are the ones the earlier steps established. No
existing route changed; the two detail routes are additions.

Three more routes complete the citizen-facing surface but sit outside this document's original scope
because they do not read `/api/public`: `/` (`pages/Home`), `/register` (`pages/Register`, reading
`GET /api/applications/registration-window` and posting to `POST /api/applications`) and `/about`
(still a placeholder). Their visual design, the registration wizard, and the shared design system
behind all of it are covered in
["A public design system, and the registration wizard"](#a-public-design-system-and-the-registration-wizard)
below.

## Addressing: codes, never ids

Every public URL and every public request names a place by its **official code**, and a commune code
always travels with its wilaya code because commune codes are unique only within a wilaya.

`components/geo/PlaceCodeFilters.tsx` exists for this. The admin pickers next door select by database
id, which is what the admin API takes; the public filters hand back codes, which is what goes into
the query string and the address bar. `/results/2027/27/2703` is a URL that can be read out over the
telephone, printed on a notice, and stays valid whatever the database does underneath.

No internal id appears in any public URL, any public request, or any rendered public payload.

## Status lookup

Two values, both of which the applicant already holds: the reference printed on their receipt, and
the mobile number given on the application. The form **posts**. Neither value ever enters the URL,
the browser history, a bookmark, a `Referer` header or a shared cache key.

### Preserving the server's enumeration resistance

The endpoint answers an unknown reference, a wrong number, a malformed reference and an applicant who
never gave a number with the same 404, byte for byte. A more helpful _page_ — "that reference exists,
check the number" — would give away through rendering exactly what the API spent its design refusing
to give away through its responses.

So `pages/ApplicationStatus.tsx` renders **one message for every way the lookup can miss**, and
`failureKey` deliberately collapses `notFound` and `validation` onto the same key. Client-side
validation checks emptiness and nothing else: a reference-shape check would tell somebody probing the
form which strings are worth sending. The test suite compares the two failure paths against each
other rather than against a fixed string, so whatever the page says, it must say the same thing to
both.

Rate limiting gets its own message, which names no cause. On a per-reference limiter a real and an
invented reference accumulate failures identically, so the message must not distinguish them, and it
does not invite an immediate retry.

### What a successful lookup shows

Reference, draw year, wilaya, commune, entry type, applicant count, public status, draw phase,
whether results are published, and submission time. Every one of those fields is named explicitly in
`components/public/ApplicationStatusPanel.tsx`. Rendering the DTO by walking its keys would mean a
field added to the API later appears on this page without anybody deciding it should — the server
builds its public DTOs field by field for the same reason.

**Never rendered:** national ID, phone number (not even the one just used to verify — the server does
not return it), date of birth, name, participant or application id, weight, participation history,
eligibility reason code, or anything administrative.

### The result gate

`resultsPublished` is read from the server, never inferred. Before publication the server collapses
`SELECTED`, `RESERVE` and `NOT_SELECTED` onto `AWAITING_RESULTS`, the panel shows "Results not yet
published", and there is no branch anywhere in the client that turns a draw phase plus a flag into an
outcome. The whole point of the release gate is that polling one's own reference cannot front-run the
announcement — and three outcomes told apart early are three outcomes somebody can learn by polling,
so the reserve collapses onto the same holding value as the other two rather than a similar one.

After publication a reserve reads **`RESERVE`**, with its own badge colour and its own explanation of
what a reserve position is. What the panel deliberately does _not_ say is where in the list they
stand or whether anybody has been called: the DTO carries no reserve position, and the reserve
lifecycle vocabulary — waiting, called, promoted, declined — belongs to the published result's
reserve list, where it describes the draw, rather than to a page describing one identifiable
applicant. A **promoted** reserve reads `SELECTED`, because the server says so; nothing on the client
derives that.

### Nothing is stored

No `localStorage`, no `sessionStorage`, no IndexedDB, no cookie. `tests/public-safety.test.tsx`
scans the public modules for all four. The only thing this application stores at all is the locale
preference, in `i18n/index.ts`.

The page carries `<meta name="robots" content="noindex, nofollow">` while mounted (`lib/document.ts`,
`useNoIndex`), removed on unmount so the results pages — which _should_ be indexable — are not caught
by a tag left behind. No application reference appears in any canonical URL, and no public route
takes one.

Reference and print buttons are provided; the print view carries only the verified result.

## Winners and official results

`/winners` lists announced results, most recently announced first, filtered by year, wilaya and
commune. It reads the publication table, so a commune that has drawn but whose result nobody has
published is **absent** rather than filtered — there is no combination of filters on that page that
reaches one.

`/results/:drawYear/:wilayaCode/:communeCode` is one commune's result in full, and is designed to be
shareable: it identifies nobody, it is the most cacheable response in the system, and its 404 carries
no information (never drew, drawn-but-unannounced and no-such-commune are the same response, and the
page shows the same "nothing announced" state for all three).

### Winner display policy

Five columns, and they are the entire published record of a winner:

| Column                | Why it is publishable                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| Order drawn           | `selection_order` as the draw persisted it. Not a ranking — the first entry drawn did not win by more.       |
| Application reference | Already printed on that applicant's own receipt. Somebody can find themselves; nobody can find anybody else. |
| Type                  | Single or paired.                                                                                            |
| Pilgrims              | 1 or 2, derived from the entry type.                                                                         |
| Status                | Whether the place is still held — `outcome` from the DTO, as one of two words. Never _why_.                  |

**Winner names are not published.** That is an open policy decision for the governing authority to
take explicitly, not something to arrive at because a column happens to be available. The API does
not send names and `WinnerList` has no column for them; a test asserts the exact column set, so
adding a sixth fails there before it reaches the public.

### Withdrawn winners

A winner who later gave up their place shows as **"Gave up the place"**, and everything else about
their row is unchanged: same position, same reference, same table.

That is the whole point. The winner list is the **original draw**, and the original draw does not
move. A withdrawn winner is not removed from it, not renumbered, not shifted down, and — the failure
that would matter most — not shown as not-selected or as a reserve. They were selected by this
lottery and remain an original winner of it; what changed afterwards is an administrative fact
recorded beside the selection rather than instead of it. When at least one row carries the status, the
table adds a sentence saying so, rather than leaving a reader to infer that a withdrawn winner was
never a winner.

Nobody takes their place _in this list_ either. A promoted reserve appears in the reserve list, as a
reserve — see below.

The badge is deliberately **neutral rather than red**. Giving up a place is not a failure and not a
disqualification, and an error colour beside somebody's reference would read as a judgement on
circumstances the page says nothing about — and could not, since the reason is never published.

**Why is never shown.** The abandonment's reason (`VOLUNTARY_WITHDRAWAL`, `DEATH`, `MEDICAL`,
`OTHER`), its explanation, the administrator who recorded it and when are administrative. The public
query does not select those columns at all — it reads only whether an abandonment row exists — so
there is nothing in the response for the page to render, by accident or otherwise. This is not a
field hidden with CSS; it never leaves the database.

### Reserves

`/results/:drawYear/:wilayaCode/:communeCode` carries a second table, under its own heading, for
`PublicResultDto.reserves`.

Five columns, mirroring the winner list: reserve position, application reference, type, pilgrims,
status.

**Separate lists, because they are separate things.** A commune with N places drew 2N entries in one
continuous sample; the first N won a place and the rest hold an ordered contingency position. A
reserve **is not a winner**. Appending them to the winner table, or merging the two under one
heading, would say something about their standing that is not true, so the page keeps two headings,
two tables and a sentence explaining the difference.

**The order is the server's, and the client never touches it.** No sort by weight, by status, by
reference or by anything else; no client-side derivation of a position; no filtering. `ReserveList`
passes the array through to `Table` unmodified, and a test feeds it a deliberately hostile ordering —
positions descending, statuses mixed — and asserts the rendered rows come out in exactly that order.
A page that re-ordered this list would be showing a different lottery than the one that ran.

**A promoted reserve keeps its reserve number.** `PROMOTED` says they became a winner; it does not
move them into the winner table and does not renumber them. The original draw said "reserve #1" and
still says it. Both facts stay readable side by side:

```
Original draw     Reserve #1
Current outcome   Promoted to winner
```

Nothing in the client can move a row between the two tables — there is no code path that could, which
is stronger than a rule saying it should not.

| Status     | Shown as           |
| ---------- | ------------------ |
| `WAITING`  | Waiting            |
| `CALLED`   | Called             |
| `PROMOTED` | Promoted to winner |
| `DECLINED` | Declined           |

**Which winner a reserve replaced is not shown.** That relationship exists server-side but is not part
of the public contract, and publishing "reserve #1 replaced winner #4" would publish a link between
two identifiable households. The page shows the two facts independently: an original winner who gave
up a place, and a reserve who was promoted.

The summary reports reserve positions as a **figure of their own**, never added to the winner count: a
reserve does not occupy a place, so summing them would misstate how many pilgrims the commune is
sending.

Weights are likewise absent. A weight is one household's accumulated priority — how many years they
have been waiting — and publishing it beside a reference would publish that. The random value and the
active total weight remain internal audit information and appear nowhere.

The pool hash and algorithm version _are_ published, on the result page, under "Verification": the
hash is a commitment to the frozen input so the result can be shown to be the one that was drawn. It
is emphatically not a seed and it identifies nobody.

## Public draw status

`/draw` shows where each commune's draw stands: year, wilaya, commune, allocated places, phase, and
whether the result is announced. It carries **no applicant count of any kind**, no eligible list, no
pool, no entry and no weight, because the endpoint behind it carries none of those.

`winnerCount` is null rather than zero before publication, and renders as "not yet announced" rather
than as a number — so a commune that has drawn cannot be told apart from one where nobody won.

## Live draw visualiser

### Transport: polling, and why

**Polling `GET /api/public/draw-status`.** Not SSE, not WebSockets. The reasoning is in
`lib/draw-watch.ts` and is worth restating:

The server has no public real-time surface, and the reason is structural rather than incidental. A
draw is **one database transaction** that either commits whole or unwinds whole; there is no moment
at which a partially-drawn commune is a real, observable state. Publication is then a separate,
later, deliberate act by a national administrator. So there is no stream of per-selection events to
subscribe to.

Opening an SSE channel or a WebSocket over that would carry exactly the same information as a GET,
at the cost of one held connection per viewer, on the one page whose defining problem is that a great
many people open it simultaneously — and it would advertise a liveness the system does not have.

Polling a cacheable GET is the opposite trade in every respect that matters here:

- **The same bytes for every viewer.** A CDN can serve a hundred thousand watchers from one origin
  request, and the endpoint's `stale-while-revalidate` keeps it serving while it refreshes.
- **Cheap.** One indexed row (`pageSize=1` — the watcher asks for its own commune, not a page).
- **Authoritative.** It is the state, not a projection of one.
- **Movable.** Putting it behind a CDN or reverse proxy later is a deployment change, not a rewrite.

No Redis, no message broker, no new infrastructure.

### Intervals

Armed only from _inside_ a completed request, never on a bare interval, so a slow origin cannot
accumulate overlapping requests — which is precisely the failure mode that turns a busy page into a
stampede.

| State                 | Interval                | Why                                                                                                |
| --------------------- | ----------------------- | -------------------------------------------------------------------------------------------------- |
| `ACCEPTING`           | 120 s                   | Nothing changes minute to minute two months before a draw.                                         |
| `ENTRIES_CLOSED`      | 60 s                    | The draw could be run today.                                                                       |
| `DRAWN`, unpublished  | 20 s                    | The one transition worth waiting for.                                                              |
| `DRAWN`, published    | **stops**               | Immutable by trigger, no retraction path. Nothing left to ask.                                     |
| `CANCELLED` / no draw | **stops**               | A settled answer.                                                                                  |
| after a failure       | 15 s, doubling to 120 s | A page full of watchers retrying on a fixed interval is what keeps a struggling origin struggling. |

Polling also **stops entirely while the tab is hidden** and resumes on `visibilitychange`. Draw day
means a great many people leave this open in a background tab.

There is no jitter, deliberately: jitter needs randomness, and the client generates none (see below).
The cache headers and `stale-while-revalidate` are what absorb a synchronised herd.

The page says plainly whether it is still watching, so somebody who leaves it open can tell that it
has stopped rather than waiting on a page that will never change.

### States

| State         | Mapped from                                                                    | Shows                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `WAITING`     | phase `ACCEPTING` or `ENTRIES_CLOSED`                                          | Commune, allocated places, registration state.                                                                                                |
| `DRAWING`     | phase `DRAWN`, not published                                                   | "The draw has been held; the result is being verified before it is announced." Allocated places. Winner count explicitly _not yet announced_. |
| `COMPLETED`   | phase `DRAWN`, published                                                       | The official result and the winning applications, in the server's persisted selection order.                                                  |
| `UNAVAILABLE` | phase `CANCELLED`, no such draw, or a failed read with nothing to fall back on | A safe message.                                                                                                                               |

`DRAWING` means "held, not yet announced" — a real state the API reports — and not a guess that a
selection is happening at this instant. There is no progress bar in that state, because there is no
progress to report and a bar filling up would be an animation of nothing.

The full result is fetched **once**, and only after the status says it is published. Polling the
result endpoint for a 404 while waiting would put load on the origin for an answer already available
in the cheaper response next door.

### Why the frontend never performs the draw

The browser does not select, sample, weight, shuffle or randomise anything. It holds no candidate
list. It calls no random number generator — `Math.random` is banned repo-wide and
`tests/draw.test.tsx` enforces that over the whole client tree, exactly as the server suite does over
`server/src`, with comments stripped so modules may explain why they avoid it. A second test asserts
that the visualiser and its watcher contain no `Math.random`, no `crypto.getRandomValues`, no
`.sort(`, no `shuffle` and no mention of weight at all.

The reason is not tidiness. This is an official government lottery, and a page that appeared to
resolve chance in front of the visitor would misrepresent where the decision was made. The decision
was made once, on the server, inside one transaction, from the operating system's CSPRNG, and it is
immutable by database trigger before anybody sees it.

Nothing the client can send runs, advances or influences a draw: the two endpoints it calls are
reads, executing a draw is a `SUPER_ADMIN` POST behind a session on an entirely different router, and
a test asserts that every request the visualiser issues is a `GET` under `/api/public/`.

### Visual design

Restrained on purpose. No spinning wheel, no slot machine, no jackpot flashing, no cascade of
rejected candidates. Those graphics all say the same untrue thing.

The one piece of motion is a **paced reveal** of the winner list — rows appearing at 220 ms
intervals, in the server's persisted order. It changes _when_ a row appears and nothing else; no row
is reordered, withheld or chosen in the browser. It exists so a list of a hundred references does not
arrive as a wall.

## Accessibility

- **Reduced motion.** `usePrefersReducedMotion` (`lib/document.ts`) watches the media query rather
  than reading it once, so turning the preference on mid-draw stops the animation. Under it the
  whole winner list renders at once — applied during render, not corrected in an effect, so the
  visitor who asked for less movement does not get a flash of an empty table — and the pulsing
  indicator stops. **Nothing about the result requires seeing it move**: every number on screen is
  also present as text.
- **Screen readers.** The visualiser's state line is a `role="status"` `aria-live="polite"` region
  carrying the whole state in plain text, so it is announced when it changes. The lookup's result
  region exists from the first render so its outcome is announced rather than its appearance.
- **Semantic structure.** `PageHeader` renders the `h1`; sections carry their own headings, the
  filter bar is a labelled `section` with an `sr-only` `h2`, results use `dl`/`dt`/`dd`, and winner
  lists are real tables with `th scope="col"`.
- **Keyboard and focus.** Every control is a native `button`, `input`, `select` or link; the UI kit's
  visible `focus-visible` outlines apply throughout. Nothing is reachable only by pointer.
- **Direction.** Arabic is the default and flips `<html dir="rtl">`. Layout uses logical properties
  (`ps-`/`pe-`, `ms-`/`me-`, `text-start`) throughout, as the rest of the app does.

## Internationalisation

Every visible string goes through a translation key, in `ar` (RTL, default), `fr` and `en`, kept
structurally parallel. Nothing is concatenated: values reach templates through i18next interpolation
so a translator can place them where their language places them.

`lib/format.ts` produces the values. Two decisions there:

- **Algerian locale tags.** `ar` becomes `ar-DZ`, not bare `ar` — generic Arabic renders numerals in
  Arabic-Indic form (٤٢) while Algeria writes them in the Western form all of its paperwork uses. A
  citizen comparing a printed result against this page must see the same digits on both.
- **Years are ungrouped.** `2027`, never `2,027`. A draw year is a label, not a quantity.

Counts use `{{total}}` rather than i18next's reserved `count`, deliberately: Arabic has six plural
categories, these lines need none of them, and the number is interpolated already locale-formatted.

Wilaya and commune names arrive in all three languages in every payload (`PublicPlaceDto`), so
switching language re-renders and asks the server for nothing.

## Caching and performance

- **Stable query keys.** `lib/public.ts`'s `usePublicQuery` is keyed by the request path and fetches
  only when that path changes. Two renders producing the same path are the same question. There is no
  store, no eviction policy and no global cache — the server already says how long each answer is good
  for, and a second cache in front of that could only disagree with it. A test asserts that switching
  language issues no new request.
- **Bounded pages.** The UI asks for 20 rows, well inside the server's cap of 100, and the page size
  is not settable from any screen. `boundedPageSize` clamps anyway. There is no "show all" and no
  unpaginated variant. A test asserts every public request carries a `pageSize` at or under the cap.
- **No idle polling.** Only the visualiser polls, only while there is something to watch, only while
  the tab is visible, and it stops permanently once the draw is settled.
- **No N+1.** A listing is one request; the visualiser is one status request plus at most one result
  request. Filter changes reset to page 1 rather than issuing a request per keystroke of geography.
- **Print.** Results and the status panel have print styles; controls, filters and pagination carry
  `print:hidden`.

### Traffic spikes

The whole public surface is built around four moments when everybody in the country loads the same
page within ten minutes: registration opening, registration closing, a draw being run, and results
being announced.

The client's contribution to surviving those is to make its requests **cacheable and few**: identical
URLs across viewers (no per-viewer parameters, no cache-busting), bounded pages, no polling outside an
active draw, no background-tab polling, no client cache that would defeat the server's
`Cache-Control`. Everything under `/api/public` can therefore sit behind a CDN or reverse proxy
without a code change, which is where the actual capacity comes from — the origin is not being asked
to absorb it.

## Testing

`client/tests/`, Vitest + Testing Library + jsdom (`npm run test --workspace client`, and part of the
root `npm test`). `fetch` is stubbed globally and an unstubbed request throws, because several of
the assertions are about requests _not_ being made.

| File                          | Covers                                                                                                                                                                                                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `application-status.test.tsx` | Form states, identical failures, no private data, no echo, the result gate, rate limiting, network and 5xx handling, all three languages, `noindex`, storage.                                                                                                                           |
| `winners.test.tsx`            | Listing, empty state, code-based filters, pagination, bounded page size, no refetch on locale change, the exact winner column set, the safe 404.                                                                                                                                        |
| `reserves.test.tsx`           | Withdrawn winners staying put in the winner list, the reserve section, API order preserved against a hostile ordering, all four reserve statuses, promoted reserves not relabelled, the exact reserve column set, no abandonment reason or replacement link, all three languages.       |
| `draw.test.tsx`               | Draw status rendering and privacy, the four visualiser states, polling intervals and termination, reduced motion, read-only requests, and the static `Math.random` guard over the client tree.                                                                                          |
| `public-safety.test.tsx`      | Static scans: no admin/participant/application endpoint in any public module, no browser storage, one POST in the whole public client, and route integrity.                                                                                                                             |
| `register.test.tsx`           | The registration wizard: per-step validation, the wilaya→commune dependency (loading, disabled, empty states), the review step's edit links, single vs. paired flows, the same-person rejection, server refusal handling, no national ID or phone in the address bar, Arabic rendering. |
| `home.test.tsx`               | The three primary actions, the registration-window banner reflecting the server's own state, no link to `/admin`, Arabic rendering.                                                                                                                                                     |
| `register-safety.test.tsx`    | The same static scans as `public-safety.test.tsx`, over the registration modules specifically — they are excluded from that file's endpoint scan because they legitimately call `/api/applications`, which every other public module is forbidden to name.                              |

## A public design system, and the registration wizard

Added after the rest of this document was written, to give the citizen-facing pages one visual
language instead of each carrying its own. It touches presentation only: every validation rule, every
request shape and every server contract described above and in
[public-access.md](public-access.md) and [registration.md](registration.md) is unchanged.

### One design system, two component sets

`client/src/components/ui/` — the plain kit the original public pages were built on (`Card`, `Button`,
`Alert`, `Badge`, `Input`, `Select`, `RadioGroup`, `PageHeader`, `EmptyState`, `ErrorState`, `Loading`,
`Table`, `Pagination`) — is still the foundation for every public page, and stayed the foundation
rather than being replaced: it already had the right DOM shape and ARIA roles, and every existing test
asserts against those, not against class names. What changed is the styling underneath each one, moved
onto the same CSS custom properties (`bg-card`, `text-foreground`, `border-border`, `bg-primary`, …)
the administrative console's shadcn/ui layer already defined in `index.css` — so a `Card` on `/winners`
and a `Card` in `/admin` now share one set of tokens, without the public pages taking on Radix or
adopting shadcn's component API wholesale.

Three shadcn/Radix primitives were pulled into the public tree deliberately, each for behaviour the
plain kit cannot offer:

- **`Select`** (`components/shadcn/select.tsx`), for `WilayaSelect`/`CommuneSelect` — see below.
- **`Progress`**, for the registration step indicator.
- **`Breadcrumb`**, for the two detail pages that sit two levels deep (`PublicBreadcrumb.tsx`).

New shared pieces live in `client/src/components/public/`: `PageSection` (a titled block, replacing
several ad-hoc heading/paragraph pairs), `DescriptionField` (`Field`/`StatTile`, the `dt`/`dd` pair
every detail panel — the status panel, the receipt, the result page, the draw stage — used to define
locally), `StepIndicator` (the wizard's progress display) and `PublicBreadcrumb`.

### A bug fixed in the vendored `Progress`, not worked around

shadcn's `Progress` fills by `transform: translateX(-${100 - value}%)` on a full-width bar. A
transform is a physical operation — it does not mirror under `dir="rtl"` — so the vendored version
fills left-to-right even in Arabic. The fix (`components/shadcn/progress.tsx`) replaces the transform
with a plain `width: ${value}%` on a normal block box: block layout places a narrower box at its
container's _inline-start_ edge, which **is** governed by `dir`, so the bar grows from the right in
Arabic and the left in French/English with no variant needed — the same class of fix Step 21 made to
the vendored `Sheet`'s `side` prop.

### The geography pickers become searchable Selects, and a Radix gotcha worth recording

`WilayaSelect`/`CommuneSelect` (`components/geo/`) moved from a native `<select>` to shadcn's `Select`,
matching the pattern the admin console's `PlacePicker` already established, with three states beyond
"has options": a `t('common.loading')` placeholder while the request is in flight, the load-error
message on failure, and (new key: `geo.commune.empty`) an explicit empty state when a wilaya
genuinely has no communes returned. `CommuneSelect` still resets its own selection when the wilaya
changes and stays `disabled` until one is picked — that logic did not move.

Getting the "nothing chosen yet" state right took two attempts. Radix's `Select.Root` is _controlled_
the instant its `value` prop is anything but `undefined`, so passing `undefined` before a choice and a
real id afterwards flips it from uncontrolled to controlled mid-life — a React warning, and the kind
of bug that is easy to ship because it still renders. The fix was a sentinel value substituted for
`undefined`, `value={value ?? UNSET}` — except the first version used `UNSET = '__unset__'`, which
kept the component controlled but rendered a **blank trigger**, because Radix's `Select.Value` only
falls back to its `placeholder` when the value is `''` or `undefined`, not merely "unmatched by any
item". `UNSET = ''` satisfies both constraints at once: always defined (so always controlled), and the
one value Radix itself treats as "nothing selected" (so the placeholder shows). An item's own `value`
still may never be `''` — that constraint is unrelated and unchanged — but the `Select.Root`'s own
controlled value is a different string and can be.

### The registration wizard

`pages/Register.tsx` presents the same registration this document's sibling,
[registration.md](registration.md), describes — one `POST /api/applications`, decided entirely by the
server — as five steps instead of one long form: participation type, location, the primary applicant,
the second applicant (present only when entry type is `PAIRED`), and a review screen. `StepIndicator`
is purely presentational; it has no validation logic and no opinion about which step may be entered.

Each `Next` validates only the step being left — `checkLocation`/`checkApplicant`/`checkSecondary`,
the same three checks the single-page form ran, just invoked individually instead of all at once — and
blocks advancing on failure. The review step re-runs the complete `validate()` immediately before
submission regardless, as a final check the wizard's own step-by-step gating cannot bypass. Every
section on the review screen carries an "Edit" control that jumps back to it directly; because five
otherwise-identical buttons are a real screen-reader annoyance, each one's accessible name includes the
section title (`register.review.editSection`, `"Edit: {{section}}"`) while the visible label stays a
plain "Edit".

The whole step sequence is one `<form>`, not five, so pressing Enter in a field submits to whichever
action the current step means — `Next`, or `Submit application` on the review step — the way a native
form's submit-on-Enter already behaves, rather than doing nothing.

### The landing page

`pages/Home.tsx` was a two-line placeholder; it now states what the service is, offers three primary
actions (`Register`, `Check application status`, `View results` — plain links to the existing routes,
nothing new server-side), and shows the current registration window by reading the same
`GET /api/applications/registration-window` `/register` itself uses. That call is a courtesy — a
visitor learns before clicking rather than after — not a second source of truth; `/register` re-checks
the window regardless, exactly as before.

### Bundle size: why `/register` is the one public page that is lazy

`routes/index.tsx` already lazy-loads the entire admin console behind `RequireAuth`, on the reasoning
that `/results/...` — the address a whole commune opens at once — must never download an operations
console it will not render. The same reasoning applies one level down: `Select`, `Popover` and `Label`
together are the heaviest dependency this step added to the public tree, and only `/register` uses
them. Left eager, they landed in the one chunk every public page shares, growing it from 429.8 kB
(gzip 128.0 kB) to 510.3 kB (gzip 154.7 kB) — paid by every visit to `/winners`, `/draw` and the result
pages, for a control none of them render.

`Register` is now `React.lazy`-loaded, the same pattern the admin pages use, with a `Suspense`
boundary in `AppLayout` (mirroring the one `RequireAuth` already has) around the shared `<Outlet />`.
That returned the shared chunk to 440.3 kB (gzip 132.1 kB) — within noise of the pre-existing baseline
— with the registration-specific weight (`Register-*.js`, ~14 kB, plus the shared `select-*.js` chunk
already paid for once the admin console is opened) fetched only by the one route that needs it.

## About page, footer and developer attribution

`/about` (`pages/About.tsx`) was a placeholder; it now carries the project's own description — grounded
in the root [README.md](../README.md), never in an invented statistic or claim of government
affiliation — across the same sections `PageSection`/`Card`/`Badge` build everywhere else in the
citizen portal: what the platform is, the six-stage lifecycle from registration to publication, the
integrity properties behind a draw (immutable pools, CSPRNG randomness, the permanent audit trail),
the winner/reserve distinction repeated from the result page's own framing, language support, the
technology list, and a closing developer-attribution section — deliberately last, since the project is
the subject of the page and the developer is a credit on it, not the other way around.

`components/layout/Footer.tsx` grew from a single copyright line into three columns — project identity,
navigation, developer — plus the same copyright line at the bottom. None of it links to `/admin` or
`/admin/login`; the citizen footer is a different application's chrome from the console's, on purpose.

**One list, two renderers.** `Header`/`MobileNavSheet` and `Footer` both need the public route list;
it used to live only in `Header.tsx`. It is now `config/nav.ts`'s `PUBLIC_NAV_ITEMS`, imported by both,
so a route added or renamed later changes one file rather than two that must be kept in step by hand.

**Social links, and why they are hand-drawn.** `components/SocialLinks.tsx` renders the developer's five
profiles from `config/site.ts` — the one place their URLs live, so About and Footer read the same list
rather than each keeping a copy — as `target="_blank" rel="noopener noreferrer"` links, each with an
`aria-label` naming the platform. `lucide-react` (the icon set the rest of the app uses) does not ship
brand marks, so the five glyphs in `components/icons/brands.tsx` are hand-drawn `fill="currentColor"`
paths, kept apart from `icons/index.tsx`'s stroke-based functional set: a brand logo is a solid mark,
not a line drawing, and installing a whole icon-brand package for five fixed paths would be the
dependency this step was told not to add.

Every visible string on both surfaces — including the developer's name and handle, even though they do
not change by language — goes through the same `ar`/`fr`/`en` locale files as the rest of the app,
verified for structural parity the same way. The one thing that does not move between languages is the
literal `DEVELOPER.name`/`.handle` and each `SocialLink.href` in `config/site.ts`: a URL and a proper
name are not translatable content.

## Visual theme, typography and the landing hero

A later pass over the same public tree Step 22 restyled — not a second redesign. It changes the design
tokens the existing `ui`/`shadcn` kits already read from `index.css`, the fonts, the landing hero and the
footer; no page's markup structure, component API or business logic moved.

### One typography system, chosen by direction

`index.css` maps writing direction to a font family rather than locale name: `html[dir="rtl"]` reads
**Cairo**, `:root`'s default reads **Plus Jakarta Sans** — so French and English (both LTR) share one
family and Arabic gets one built for the script, without the app ever branching on which of the three
languages is active. Both load from Google Fonts (`index.html`'s `<link>`, with `preconnect` ahead of
it); the fallback stack on both rules is a plain system sans-serif, so a blocked or slow font request
never leaves the app unreadable, only briefly un-styled.

### The color ramp is the project's own logo, not a generic palette

`public/image/Logo.png`/`.webp` — the Kaaba-and-lottery-ticket mark now used in `Logo.tsx`, replacing
the placeholder abstract shield — fixed the exact greens and gold this step's `--color-primary-*`/
`--color-gold-*` tokens in `index.css` are drawn from, rather than the other way around. `primary-700`
(`#006233`) and `primary-800` (`#004d28`) are the logo's own two greens; `primary-900` is a new, darker
step added only because `Draw.tsx`/`Winners.tsx` already referenced a `hover:text-primary-900` that had
never actually resolved to a color (the scale stopped at 800). `gold-*` is deliberately small and used in
exactly one decorative place — the hero eyebrow's accent bar — never as a second interactive color or as
text on a light background, where it fails WCAG contrast on its own.

### The landing hero: a real photograph, held to the same RTL rule everywhere else breaks

`Home.tsx`'s hero now carries an aerial photograph of the Kaaba (`public/image/Kaaba-home-hero.webp`),
masked rather than placed full-bleed: a `mask-image` linear gradient fades the photo in from transparent
to full strength over roughly the right two-thirds of the hero, so the text column sits on the plain
gradient background and never on top of the image — no dark scrim is needed anywhere for the heading to
stay readable, because the two never overlap.

The photo is the one deliberate exception to "always use logical properties" in this codebase. It stays
physically on the right (`right-0`, not `end-0`) in Arabic, French and English alike, and the text column
is pinned to the physical left with `mr-auto` rather than left to its normal inline-start position. A
photograph of one real, specific place has one true arrangement — the two minarets, the Kaaba's actual
position between them — and mirroring it under `dir="rtl"` the way a logical property would misrepresent
Masjid al-Haram's own layout. Only the text's own internal alignment still follows `dir`, exactly as
everywhere else. The image is `loading="lazy"` inside an `lg:`-only ancestor, so a phone visitor's
browser does not fetch the ~550KB photograph at all — only a desktop viewport, where the mask has room to
read as a blend rather than a hard edge, pays for it.

### A new public endpoint, added deliberately and only after the alternative was refused

`Home.tsx` gained a four-tile trust summary below "How it works" — total Hajj places, municipalities,
wilayas, and a static "certified draws" badge. The first three needed real numbers, and this step's own
governing spec is explicit that a public page may not carry a fabricated statistic. Wilaya and commune
counts already have a real source (`/api/wilayas`, `/api/communes`); a total across every commune's
`allocated_spots` did not — nothing in the codebase aggregates it, by design (see "No
`eligible_application_count`" under Draw configuration in `CLAUDE.md`).

Rather than invent a number or silently compute one client-side by paging through every commune's already
public `allocatedSpots` on every homepage load, the choice was to add `GET /api/public/stats`
(`server/src/routes/public.ts`, `getPublicStats`, `PublicResultsService.getPlatformStats`) — one query
that sums `allocated_spots` across every `CommuneDraw` ever configured, any year, any status, alongside
two cheap `count()`s for active wilayas and communes. `PublicPlatformStatsDto` (`shared/src/public.ts`) is
the DTO; the response is cached the same as `/api/public/draw-status` (`cachePublicListing`), since the
numbers move only as fast as an administrator configures a new commune draw. Nothing here is
privacy-adjacent — a wilaya count, a commune count, and a sum of a figure that is already published per
commune reveal nothing about who applied or who won — and the route takes no input, so there is nothing to
validate.

This is the one place this step touched server code; everywhere else stayed public-UI-only. `Home.tsx`'s
`StatTile` shows a skeleton while `usePublicStats()` (`lib/public.ts`) is loading and an em dash — never
an error banner — if the request fails, the same "a missing number should not read as a broken page"
choice the registration-window banner already made. `KaabaIcon` is hand-drawn locally in `Home.tsx` (no
icon set ships one); the mosque and pin icons are lucide's own `MosqueIcon`/`MapPinIcon`.

### Motion: Framer Motion, but code-split so `/winners` never pays for it

Framer Motion is a new dependency — Step 22 and 23 deliberately avoided adding one for their own visual
work, and this step's first pass at the hero (a hand-rolled `IntersectionObserver` hook, no library) held
to that. It was replaced with Framer Motion on explicit direction mid-step, for the hero's staggered
entrance and the primary CTA's hover/tap feedback.

Importing `motion` directly would have put the whole animation engine in the chunk every public page
shares — measured at the time: the shared chunk grew from 440 kB to 589 kB (gzip 132 kB → 181 kB) for a
component only `/` renders, the exact regression Step 22's `/register` lazy-load was written to avoid.
The fix is Framer Motion's own supported code-splitting shape: `Home.tsx` renders `m.div`/`m.img` (the
lightweight variant) inside one `<LazyMotion features={loadMotionFeatures} strict>`, where
`loadMotionFeatures` is a dynamic `import('../lib/motion-features')` — a one-line module whose only
content is `export default domAnimation`. Rollup places `domAnimation` (the actual feature
implementation) in its own chunk, fetched only once `LazyMotion` mounts, never inside the shared bundle.
`components/public/Reveal.tsx` — the "how it works" cards' viewport-triggered entrance — uses the same
`m` import and relies on `Home.tsx`'s `LazyMotion` ancestor rather than carrying its own.

Net effect on the shared chunk: 507 kB (gzip 155.7 kB) after code-splitting, against a 440 kB (gzip
132 kB) pre-Step-24 baseline — the framer-motion core (`m`, `LazyMotion`, `useReducedMotion`) still ships
eagerly, since it is small and `Home.tsx` is not itself lazy (it is the entry route), but the ~37 kB
(gzip 14 kB) `domAnimation` feature set is a separate, async chunk `/winners`, `/draw` and the result
pages never fetch.

Every animation reads `useReducedMotion()` and substitutes a reduced variant (no vertical travel, no
scale) rather than skipping the entrance outright — content still appears, it just does not move. jsdom
has no `IntersectionObserver`; `tests/setup.ts` gained the same kind of inert stand-in it already had for
`ResizeObserver`, since nothing in this suite asserts on the animation itself, only on what it wraps.

### The footer: four columns, and a dark band that is the brand's own dark green

`Footer.tsx` moved from three light columns to four on a dark `bg-primary-800` band: brand identity (logo,
tagline, the developer's social profiles via `SocialLinks variant="dark"` — a new variant, since the
existing `circle` style's stone tones read as a smudge on a dark background), site navigation
(`footer.navHeading`, now "Quick Links" rather than "Navigation"), official government resources, and
direct contact details. A sub-footer repeats the copyright line beside two legal-placeholder triggers.

**Official government links are a courtesy, not a claim.** `config/site.ts`'s `OFFICIAL_LINKS` points at
three real Algerian government sites relevant to this domain — the Ministry of the Interior, the Ministry
of Religious Affairs and Wakfs (which administers Hajj affairs), and Dzair Digital Services, the national
digital-services portal — each verified against its own site or press coverage before being named, rather
than guessed. `footer.officialLinksHint` states plainly that these are external resources with no
affiliation to this project, so the column cannot be misread as a claim of the government affiliation
Step 23 already established this platform does not make.

**Contact is separate from social.** `SOCIAL_LINKS` in `config/site.ts` went back to profile links only
(github/linkedin/x/facebook/portfolio); email and phone moved to a new `CONTACT` export, rendered in the
footer's contact column as their own labelled rows (an icon plus the visible address/number) rather than
icon-only circles — a citizen reaching out directly is a different action from following a profile, and
the two are laid out to read that way. The phone number keeps `dir="ltr"` on its own link regardless of
page direction, the same reasoning `lib/format.ts` already applies to numerals under Arabic.

**Two placeholder dialogs, not two dead links.** Privacy Policy and Terms of Service do not exist yet.
Rather than a link to nowhere or fabricated legal text, both open the same small dialog
(`components/shadcn/dialog.tsx`, already vendored — the underlying Radix `Dialog` primitive is the one
`Sheet`'s mobile navigation already loads eagerly, so this adds a thin wrapper, not a new dependency)
stating plainly that the page has not been published yet.

## Not in this step

- **Winner names.** An explicit policy decision, not an omission.
- **Per-selection live events.** The server exposes none; inventing them on the client is exactly what
  this step refuses to do. If a genuine live draw is wanted later, it needs a server-side event
  surface first — at which point the visualiser's state machine is already the right shape for it.
- **A public "available draw years" endpoint.** The year filter is a bounded number field (2000–2200,
  matching the server's CHECK) rather than a picker, because a select built from whatever happened to
  be on the current page would present an incomplete list as a complete one.
- **Citizen accounts, OTP, SMS, notifications.** Nobody is told they have been called except by
  whoever calls them.
- **Result retraction**, and any client path that could imply one.
- **The replacement relationship.** "Reserve #1 replaced winner #4" is not in the public contract, and
  adding it would publish a link between two identifiable households. The page shows the two facts
  independently.
- **Abandonment after promotion, reconsidering a declined reserve, and automatic call expiry.** None
  of these exists server-side (see docs/reserves-and-replacements.md), so there is nothing to render;
  each is a policy decision before it is a screen.
