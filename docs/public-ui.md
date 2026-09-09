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
`SELECTED` and `NOT_SELECTED` onto `AWAITING_RESULTS`, the panel shows "Results not yet published",
and there is no branch anywhere in the client that turns a draw phase plus a flag into an outcome.
The whole point of the release gate is that polling one's own reference cannot front-run the
announcement.

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

Four columns, and they are the entire published record of a winner:

| Column                | Why it is publishable                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| Order drawn           | `selection_order` as the draw persisted it. Not a ranking — the first entry drawn did not win by more.       |
| Application reference | Already printed on that applicant's own receipt. Somebody can find themselves; nobody can find anybody else. |
| Type                  | Single or paired.                                                                                            |
| Pilgrims              | 1 or 2, derived from the entry type.                                                                         |

**Winner names are not published.** That is an open policy decision for the governing authority to
take explicitly, not something to arrive at because a column happens to be available. The API does
not send names and `WinnerList` has no column for them; a test asserts the exact column set, so
adding a fifth fails there before it reaches the public.

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

| File                          | Covers                                                                                                                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `application-status.test.tsx` | Form states, identical failures, no private data, no echo, the result gate, rate limiting, network and 5xx handling, all three languages, `noindex`, storage.                                  |
| `winners.test.tsx`            | Listing, empty state, code-based filters, pagination, bounded page size, no refetch on locale change, the exact winner column set, the safe 404.                                               |
| `draw.test.tsx`               | Draw status rendering and privacy, the four visualiser states, polling intervals and termination, reduced motion, read-only requests, and the static `Math.random` guard over the client tree. |
| `public-safety.test.tsx`      | Static scans: no admin/participant/application endpoint in any public module, no browser storage, one POST in the whole public client, and route integrity.                                    |

## Not in this step

- **Winner names.** An explicit policy decision, not an omission.
- **Per-selection live events.** The server exposes none; inventing them on the client is exactly what
  this step refuses to do. If a genuine live draw is wanted later, it needs a server-side event
  surface first — at which point the visualiser's state machine is already the right shape for it.
- **A public "available draw years" endpoint.** The year filter is a bounded number field (2000–2200,
  matching the server's CHECK) rather than a picker, because a select built from whatever happened to
  be on the current page would present an incomplete list as a complete one.
- **Citizen accounts, OTP, SMS, notifications.**
- **Result retraction**, and any client path that could imply one.
