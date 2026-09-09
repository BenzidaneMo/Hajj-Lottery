# Reserves and replacements

A commune with `N` places does not draw `N` entries. It draws `2N` — `N` winners
and, immediately afterwards, `N` reserves — in one continuous weighted sample.
When a winner later gives up their place, the next reserve is called for it.

The lottery is never re-run, the reserve list is never regenerated, and no
selection order ever changes.

```
selection   1 … N          →  WINNERS,  positions 1..N
selection   N+1 … 2N       →  RESERVES, positions 1..N
```

Everything below follows from one distinction, and it is worth stating before
anything else:

| Question                                    | Answer lives in                                          | Changes? |
| ------------------------------------------- | -------------------------------------------------------- | -------- |
| What did the lottery decide?                | `draw_winners`, `draw_reserves`, `draw_selection_events` | Never    |
| What is the current administrative outcome? | `winner_abandonments`, `draw_reserves.status`            | Yes      |

A promoted reserve does **not** become "winner #4". They stay reserve #1 of this
draw, permanently, and separately become a winner. Collapsing the two would turn
the published result into a record of who holds a place today rather than of what
the lottery did — and there would then be no way to show that the lottery had
done anything in particular.

## One draw, both halves

The reserve list is produced by the original lottery and by nothing else.

- `lib/lottery.ts` is unchanged. It is still a pure weighted sample without
  replacement, still takes every random value through an injected
  `RandomIntSource`, and still knows nothing about winners or reserves.
- `LotteryService.drawFrom` asks it for `totalDrawSelections(allocatedSpots)`
  entries — `2N` — and slices the result: the first `N` are winners, the rest are
  reserves in the order they came out. The slice is where the two halves are
  distinguished; the draw itself does not distinguish them.
- One `DrawSelectionEvent` is written per selection, so all `2N` are backed by
  the `activeTotalWeight` and `randomValue` that produced them. The reserve order
  is as checkable as the winner order.

What this is not:

- **Not a second draw.** There is no code path that samples again.
- **Not the losers sorted by weight.** Nothing sorts. A ranked reserve list would
  hand the last place to whoever had waited longest, which is a different
  allocation rule that nobody has adopted.
- **Not generated later.** A list assembled when somebody drops out could not be
  shown to be the lottery's own ordering, however honestly it was made. That is
  the entire reason reserves are drawn now rather than then.

`RESERVE_POSITIONS_PER_SPOT` (shared) is `1`, and `totalDrawSelections()` is the
one place the `2N` rule is expressed.

## The insufficient-pool policy

A draw for `N` places now requires a frozen pool of at least `2N` entries.
Anything less is `409 INSUFFICIENT_DRAW_ENTRIES`, the commune draw stays `LOCKED`,
and nothing is written.

This is stricter than before reserves existed, and deliberately so. Ten winners
and five reserves would give a commune a contingency list that runs out, and
_which five of the ten places were the protected ones_ would have been decided by
nobody. So:

| Pool | Places | Outcome                                   |
| ---- | ------ | ----------------------------------------- |
| 20   | 10     | Draws: 10 winners, 10 reserves            |
| 25   | 10     | Draws: 10 winners, 10 reserves, 5 undrawn |
| 15   | 10     | **Refused.** `INSUFFICIENT_DRAW_ENTRIES`  |
| 9    | 10     | **Refused**, as before Step 19            |

Freezing a pool still permits fewer entries than places — that policy is
unchanged, and whether an undersubscribed commune should draw at all remains an
open question for the domain. The refusal happens at execution, where the
question surfaces, rather than being answered silently by a `Math.min`.

## What a reserve is, and is not

At the moment a draw concludes, every reserve:

- has an `Application` with status `RESERVE` — neither `SELECTED` nor
  `NOT_SELECTED`, because they were drawn but hold no place;
- has `has_won_hajj = false`, and **no** `WinnerArchive` row;
- has a participation record for the year with `participated: true, won: false`,
  exactly like anybody else who took part and did not win — so an uncalled
  reserve accrues the same priority for next year as any other non-winner.

Being on the list is not a place. A reserve who is never called has, at the end
of it, taken part in a draw and not won.

## Abandonment

Recording that a winner gave up their place is its own operation:

```
POST /api/admin/commune-draws/:id/winners/:selectionOrder/abandon
{ "reason": "VOLUNTARY_WITHDRAWAL" | "DEATH" | "MEDICAL" | "OTHER",
  "explanation": "..." }
```

- **SUPER_ADMIN only.** See _Authority_ below.
- The `explanation` is required and non-blank — checked by Zod, by the audit
  reason rules, and by a `CHECK` constraint on the table.
- The category is a controlled vocabulary; an unrecognised value is a 400. The
  software asserts nothing by accepting `DEATH` or `MEDICAL` — an official is
  recording a fact established somewhere else.
- It writes one `WinnerAbandonment` row, which is **append-only by trigger**:
  UPDATE and DELETE raise, for everyone. A retraction would decide invisibly that
  somebody had never given up their place, and a reserve may already hold it.

The abandoned winner remains a winner:

|                      | After abandonment                    |
| -------------------- | ------------------------------------ |
| `draw_winners` row   | Unchanged, still selection order _k_ |
| `WinnerArchive` row  | Unchanged                            |
| `has_won_hajj`       | **Still `true`**                     |
| `Application.status` | Still `SELECTED`                     |
| Participation ledger | Still `won: true`                    |

A place that was awarded and given up was still awarded. There is no operation
anywhere in this system that turns a lifetime exclusion back off, and this is not
one.

**Abandonment does not promote anybody.** Calling the next reserve is a separate
request. Two deliberate acts leave a trail that says who decided what; one button
that did both would not.

## Calling, refusing, accepting

```
POST /api/admin/commune-draws/:id/reserves/:reservePosition/call     { "winnerSelectionOrder": 4 }
POST /api/admin/commune-draws/:id/reserves/:reservePosition/accept
POST /api/admin/commune-draws/:id/reserves/:reservePosition/decline  { "explanation": "..." }
```

```
WAITING ──call──▶ CALLED ──accept──▶ ACCEPTED   (terminal: they are now a winner)
                    │
                    └───decline───▶ DECLINED    (terminal: the place reopens)
```

`SKIPPED` and `EXPIRED` do not exist. Nothing skips a reserve, because the order
is enforced rather than chosen; nothing expires one, because silence is never
read as an answer. A state nothing can reach would be an invented lifecycle
rather than a recorded one.

**The position in the path is a confirmation, not a choice.** The service refuses
anything but the first `WAITING` reserve (`409 RESERVE_OUT_OF_ORDER`), so nobody
can reach past reserve #1 to reserve #7 — that would be choosing a winner, which
is what the lottery exists to prevent. Naming the position anyway means two
administrators working from the same list cannot both believe they called
somebody different.

The other refusals:

| Code                      | When                                            |
| ------------------------- | ----------------------------------------------- |
| `WINNER_NOT_ABANDONED`    | Calling for a place nobody has given up         |
| `PLACE_ALREADY_FILLED`    | A second reserve for the same vacated place     |
| `RESERVE_NOT_WAITING`     | The reserve has already been called             |
| `RESERVE_NOT_CALLED`      | Accepting or refusing for somebody nobody asked |
| `NO_RESERVE_AVAILABLE`    | The list is exhausted                           |
| `PARTICIPANT_ALREADY_WON` | The applicant already holds a lifetime win      |

A **declined** reserve is not asked again. The place goes back to being vacant and
the next reserve may be called for it; the refusal stays on the record, showing
who was asked and for what.

There is no separate `RESERVE_ACCEPTED` audit action: accepting _is_ being
promoted, in one transaction, so a second event would describe the same act
twice.

## Promotion

Accepting runs as one transaction:

1. claim the reserve — a conditional `UPDATE ... WHERE status = 'CALLED'`;
2. verify **every** participant is free to win: no archive row, `has_won_hajj`
   still false;
3. write a `WinnerArchive` row per person, `source = RESERVE_REPLACEMENT`;
4. set `has_won_hajj`, conditional on it being false;
5. move the application `RESERVE → SELECTED`;
6. correct the existing participation record for the year to `won: true`;
7. record `RESERVE_PROMOTED`;
8. re-count the places and refuse to commit if the draw would over-allocate.

Any failure unwinds all of it. There is no state in which somebody is excluded
for life without a winner record, or holds a winner record with no account of who
authorised it.

Two details worth stating plainly:

- **`drawnAt` on the archive row is the draw's moment, not the promotion's.** They
  were selected by that lottery; being called is not a second selection. When the
  promotion happened is on the `DrawReserve` row.
- **The ledger is corrected, never appended to.** A reserve already has a
  participation record for the year — execution wrote it from the frozen pool —
  and what changed is the outcome, not the participation. A second row for the
  same year is what `UNIQUE(participant_id, draw_year)` exists to prevent, and it
  would double-count the year for anybody computing a streak.

## Paired entries

A paired application is **one lottery entry** throughout. It consumes one winner
position or one reserve position, never two.

| Situation                | Entries            | People             |
| ------------------------ | ------------------ | ------------------ |
| Paired winner            | 1 place            | 2 lifetime winners |
| Paired reserve, waiting  | 1 reserve position | 0 winners          |
| Paired reserve, promoted | 1 place            | 2 lifetime winners |

- A paired winning application is **abandoned as a whole.** There is no way to
  record half of one, and the next reserve replaces the entire application rather
  than one traveller.
- A paired reserve is **promoted whole or not at all.** Both participants are
  checked before either is written, so an entry with one already-excluded member
  takes the whole transaction down rather than half-promoting a pair.

## Spot accounting

Allocated spots count _winning applications_, and a replacement fills a place
rather than adding one:

```
places held  =  original winners − abandonments + accepted reserves
```

which returns to `allocatedSpots` once every abandonment has been replaced, and is
lower while one is open. It can never exceed the allocation; the promotion
transaction re-counts and refuses to commit if it would.

The **historical** count is a different number and moves only upward. A two-place
draw where one winner abandoned and one reserve was promoted has three people
holding a lifetime Hajj win: both original winners — a place given up was still
awarded — and the replacement. That is correct, not a discrepancy.

## Lifetime exclusion, end to end

|                                   | `has_won_hajj`       |
| --------------------------------- | -------------------- |
| Original winner                   | `true`               |
| Original winner who abandoned     | `true` — permanently |
| Reserve, waiting                  | `false`              |
| Reserve, called, not yet answered | `false`              |
| Reserve, declined                 | `false`              |
| Reserve, promoted                 | `true`               |

`UNIQUE(participant_id)` on `winner_archive` is still the strongest invariant in
the model, and promotion is checked against it twice — once before writing and
once by the constraint itself. A promotion that would give somebody a second
lifetime win is blocked and **nothing is modified**: which of the two records is
the mistake is a question for the people who made them, and answering it
automatically would destroy the evidence.

## Immutability

`draw_reserves` is the only table in a concluded draw that may be updated at all,
and a trigger draws the line down the middle of the row:

- **Refused on UPDATE:** `draw_result_id`, `draw_pool_entry_id`, `application_id`,
  either participant, `selection_order`, `reserve_position`, `selected_weight`,
  `created_at`. Also re-pointing a called reserve at a different winner.
- **Refused outright:** DELETE. A reserve list with a gap in it is not a reserve
  list, and "who was next?" must always have the answer the lottery gave.
- **Allowed:** `status` along the transitions above, `replaces_draw_winner_id`
  from null, `called_at`, `decided_at`.

Also enforced in the database:

- reserve positions occupy `1..N` and selection orders `N+1..2N`, checked against
  the result's own `winner_count`;
- a pool entry cannot be both a winner and a reserve — a trigger on each table, so
  neither can be populated first and then contradicted;
- one abandonment per winning entry (`UNIQUE(draw_winner_id)`);
- one undeclined reserve per vacated place — a **partial** unique index on
  `replaces_draw_winner_id WHERE status <> 'DECLINED'`, which is what lets a
  refusal reopen the place while still making a filled place unfillable;
- the lifecycle's shape as a `CHECK`: each status says exactly which of the
  mutable columns must be set, so a half-written transition cannot be stored at
  all, whatever a service does.

`draw_results`, `draw_winners`, `draw_selection_events`, `winner_archive`,
`draw_pools` and `draw_pool_entries` remain immutable exactly as before. No
endpoint added in this step writes to any of them except the archive, which is
append-only.

## Concurrency

Every operation resolves in the database rather than in a process:

| Race                                        | Resolved by                                       |
| ------------------------------------------- | ------------------------------------------------- |
| Two abandonments of the same winner         | `UNIQUE(draw_winner_id)`                          |
| Two calls for the same reserve              | Conditional `UPDATE ... WHERE status = 'WAITING'` |
| Two calls for the same vacated place        | Partial unique index on the replacement           |
| Two acceptances of the same reserve         | Conditional `UPDATE ... WHERE status = 'CALLED'`  |
| A promotion racing another draw's execution | `UNIQUE(participant_id)` on the archive           |

No in-memory mutex anywhere: production may run many instances, and a lock that
only works within one process is worse than none.

## Audit

Four actions, one per decision somebody actually takes:

| Action             | Target         | Reason required       |
| ------------------ | -------------- | --------------------- |
| `WINNER_ABANDONED` | `DRAW_WINNER`  | Yes — the explanation |
| `RESERVE_CALLED`   | `DRAW_RESERVE` | No                    |
| `RESERVE_DECLINED` | `DRAW_RESERVE` | Yes — the explanation |
| `RESERVE_PROMOTED` | `DRAW_RESERVE` | No                    |

Calling and promoting carry no reason because they follow mechanically from the
abandonment already on the record; demanding a sentence for them would only teach
everybody to type one.

Every event is written **inside the transaction it describes**, is filed under the
commune it concerns, and carries identifiers and counts only: a commune draw id, a
draw result id, a selection order, a reserve position, an abandonment category.
No national ID, no phone number, no name. `assertSafePayload` refuses the first
three by key shape regardless.

## Authority

All four mutations are **SUPER_ADMIN only**. Scoped administrators read their own
commune's winners and reserves — including the recorded abandonment reason —
through `GET /api/admin/commune-draws/:id/result`, and that is the whole of their
authority here.

This is the narrowest authority that makes the workflow possible, chosen
deliberately because the question is open. Whether a wilaya office should be able
to record an abandonment in its own territory is a policy decision nobody has
taken, and the way to leave it open is to refuse for now: widening an authority
later is a decision, while narrowing one is a retraction.

Out-of-scope behaviour is unchanged — `403` for a role that may not act, `404`
for a commune draw outside an administrator's reach, byte-identical to one that
does not exist.

## Public visibility

The published result now carries the reserve list, and each entry carries a
coarse outcome:

```jsonc
{
  "winners":  [{ "selectionOrder": 1, "applicationReference": "…", "entryType": "SINGLE",
                 "participantCount": 1, "outcome": "ACTIVE" | "WITHDRAWN" }],
  "reserves": [{ "reservePosition": 1, "selectionOrder": 3, "applicationReference": "…",
                 "entryType": "SINGLE", "participantCount": 1,
                 "outcome": "WAITING" | "CALLED" | "PROMOTED" | "DECLINED" }]
}
```

The reserve list is published for the same reason the winner list is: so the
order is on the record _before_ anybody is called. A reserve list produced after
the fact, or reordered, would be a second lottery, and being able to check that it
was neither is the point.

What is never public:

- the abandonment's **reason** or **explanation**, or who recorded either — a
  `WITHDRAWN` winner is a place given up, and why is administrative and may
  describe a death or an illness. The public query does not select those columns
  at all;
- national IDs, phone numbers, dates of birth, names, weights, internal ids —
  unchanged from Step 17.

The original result is never rewritten. A withdrawn winner stays on the winner
list, in the same position, with the same reference; a promoted reserve appears
as a promoted reserve and does **not** appear among the winners.

For the citizen's own status lookup:

| Application      | Before publication | After publication |
| ---------------- | ------------------ | ----------------- |
| Won              | `AWAITING_RESULTS` | `SELECTED`        |
| Drawn as reserve | `AWAITING_RESULTS` | `RESERVE`         |
| Promoted reserve | `AWAITING_RESULTS` | `SELECTED`        |
| Not drawn        | `AWAITING_RESULTS` | `NOT_SELECTED`    |

`RESERVE` collapses onto the same holding value as the other two before
publication — three outcomes told apart early are three outcomes somebody can
learn by polling their own reference. The lookup never reports whether a reserve
has been _called_: that is administrative, and about another identifiable
household's circumstances.

## Not in this step

- **Public UI for reserves.** The API carries the reserve list; the React pages
  render the winner list as before. Showing reserves, and a withdrawn winner, is a
  deliberate presentation decision for a later step.
- **Abandonment by a promoted reserve.** Abandonment targets an original
  `DrawWinner`. A replacement who later gives up their place is a second-order
  case with no established policy.
- **A reserve who declines being reconsidered.** Terminal, by design.
- **Automatic expiry of a call.** Nothing turns silence into an answer.
- **Notifications.** Nobody is told they have been called except by whoever calls
  them; there is no SMS, no OTP and no citizen account.
- **Result retraction, un-winning, or clearing `has_won_hajj`.** Still absent, and
  still deliberately so.
