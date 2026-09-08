# Legacy historical import

Everything before this platform existed is on paper. Those registers are the only
record of who has been entering the Hajj lottery and losing, year after year — and
that record is what the priority weighting turns into a better chance next time,
and what lifetime exclusion turns into never entering again.

So an import is not a data-loading convenience. It is the single largest
unilateral change anybody can make to who wins future lotteries, made from a
source nobody can re-derive once the register is filed away. The whole design
follows from taking that seriously.

## The core principle

**Paper records are imported as historical facts, not reconstructed as web-era
records.** A 2011 register becomes `ParticipationHistory` rows and, for its
winners, `LegacyWinner` rows. It does not become `Application` rows, a `DrawPool`,
a `DrawResult` or `DrawWinner` rows — because none of those things happened. This
system did not run that draw, has no pool it was drawn from, and no random value
that produced it. Manufacturing them would put rows in the winner tables that
claim to describe a lottery nobody can point to.

## The pipeline

```
    upload ──► stage ──► validate ──► review ──► approve ──► import
              (staging tables only)              (SUPER_ADMIN)  (one transaction)
                    nothing authoritative moves before here ───────────┘
```

| Status             | What it means                                              |
| ------------------ | ---------------------------------------------------------- |
| `UPLOADED`         | The bytes were accepted as a file                          |
| `VALIDATING`       | Rows are being staged and checked                          |
| `READY_FOR_REVIEW` | Checking finished; somebody must look at it                |
| `APPROVED`         | A national administrator accepted it — nothing written yet |
| `IMPORTED`         | The authoritative tables hold it. Terminal                 |
| `REJECTED`         | Refused. Terminal                                          |
| `FAILED`           | The file itself could not be staged. Terminal              |

Transitions live in `lib/import-lifecycle.ts` as a lookup table, so a transition
that is not in the table cannot happen. A database trigger refuses to move a batch
out of `IMPORTED`, `REJECTED` or `FAILED`, and refuses to delete one at all.

`VALIDATING` is a real state rather than a formality. Staging and checking
thousands of rows is not one transaction, so a batch can genuinely be caught
there — and a batch stuck in `VALIDATING` is exactly what an administrator needs
to see.

## Supported formats and the template

CSV (UTF-8) and XLSX. Nothing else, and neither is trusted by its name.

Required columns:

| Column         | Meaning                                    |
| -------------- | ------------------------------------------ |
| `national_id`  | The person. 18 digits, any digit script    |
| `full_name`    | Corroborating, never identifying           |
| `dob`          | `YYYY-MM-DD` or `DD/MM/YYYY`               |
| `commune_code` | Official commune code — never a name       |
| `draw_year`    | The year of that draw                      |
| `participated` | Whether they entered. Never inferred       |
| `won`          | Whether they were selected. Never inferred |

Optional: `phone_number`, `notes`.

Headers are matched against an explicit alias table (`shared/src/import.ts`) after
being lowercased, having runs of spaces/dashes/underscores collapsed, and having
French accents stripped — so `National ID`, `national-id`, `Année` and `annee` all
land. Arabic and French spellings are listed alongside the English ones.

**There is no fuzzy matching.** A header the table does not name is ignored and
reported; a required column it cannot find rejects the file. Similarity scoring is
how a column headed `gagnant` in a file where it meant something else silently
becomes the winner flag — and the winner flag excludes somebody from every future
draw for the rest of their life.

Truth values are read from a fixed list per language (`true/1/oui/نعم/x`,
`false/0/non/لا`). Anything else is an error, and so is an empty cell.

## Unknown is not false

The most important rule in the whole pipeline.

An empty `participated` cell is a gap in the register, not a claim that somebody
stayed home. The ledger deliberately distinguishes "no record" from "a record
saying they did not take part" (see [participation-history.md](participation-history.md)),
and an import that filled blanks with `false` would convert every silence in a
paper register into an authoritative negative claim — one that the streak walk
then reads as a year that broke somebody's run of patience.

So missing `national_id`, `commune_code`, `draw_year`, `participated` or `won` are
validation errors, and the staged row keeps `NULL` rather than a manufactured
`false`.

## Upload security

The file is treated as hostile. Not because administrators are, but because a
spreadsheet is a program and this one passed through however many hands before
reaching theirs.

- **Never written to disk.** `multer.memoryStorage()`, parsed from the request
  buffer, discarded. Path traversal and leftover-file cleanup are not problems to
  be solved carefully; they do not exist. No client-supplied filename ever reaches
  a filesystem call.
- **Size** is capped at 5 MB, enforced by the upload middleware _before_ the bytes
  are all in memory — a limit you discover having exceeded is not a limit.
- **Rows** at 50,000, **columns** at 32, **one cell** at 500 characters, all
  applied while reading rather than after a permissive parser has materialised the
  file.
- **Type is decided by content, not by claim.** The extension says what the file
  is called and the content type says what the browser guessed; both are checked,
  and then the magic bytes decide. A `.csv` that begins with a ZIP header is
  refused rather than parsed as either.
- **CSV must be UTF-8.** Bytes that will not decode are refused rather than
  re-guessed: reading an Arabic register under the wrong code page produces
  plausible-looking names that are wrong, and a wrong name on an identity record
  is worse than a rejected upload.
- **Formulas are refused, never evaluated.** A formula cell is read as its formula
  rather than its cached result — that result is whatever machine last saved the
  file computed — and any value starting `=` is flagged `FORMULA_CELL`. There is
  no legitimate register in which somebody's national ID is computed from another
  cell.
- **No macros, no external references, no links followed.** exceljs reads the
  sheet; nothing executes.
- **Formula injection on the way out.** Values that came from a file are rendered
  inert in the API response (a leading `=`, `+`, `-`, `@` or control character gets
  a `'` prefix). The _stored_ value is untouched, because it is the evidence a
  reviewer is being asked to judge; what changes is that no downstream export turns
  a review screen into a formula.

CSV is parsed by `lib/csv.ts` — a small RFC 4180 reader written here rather than
taken from a package, because what this needs is not parsing so much as refusing,
with the limits applied during the read. XLSX goes through `exceljs`.

**Known advisory, deliberately unfixed for now:** `npm audit` reports a moderate
`uuid` bounds-check issue pulled in transitively by `exceljs@^4.4.0`. The only
automated fix (`npm audit fix --force`) downgrades `exceljs` to `3.4.0` — a major,
breaking version change to the library this entire import path depends on — which
is a larger compatibility/security risk than the advisory itself. Left as-is
pending a dependency/security review during production hardening, not silently
ignored.

## Staging

Every row lands in `import_rows` before anything authoritative is touched, is
normalized by the same utilities the rest of the API uses, and is checked three
times over.

`import_rows` holds national IDs, names and dates of birth by nature — matching a
row to a person is the entire job. That is why it is staging rather than a
permanent store, and why the audit trail records none of it.

Note what the table deliberately does _not_ enforce: the ledger's rule that you
cannot win a draw you did not enter. A register that says otherwise has to be
storable, because the row is the evidence for the conflict a reviewer is being
shown. Refusing it at the database would mean the administrator is told the upload
failed rather than which line is wrong.

## Validation, in three passes

The rules are pure functions (`lib/import-validation.ts`): no database, no clock,
no randomness. Every fact they need arrives in a context the service builds. That
is what makes the checks re-runnable — the same file and the same database state
produce the same verdicts, whether they are being staged for review or re-checked
inside the transaction about to write them.

**1. The row on its own.** Well-formedness, a real commune, a year a draw could
have happened in, an outcome that is not self-contradictory.

**2. The row against the rest of the file.** Repeats of the same person and year,
and sequences that cannot have happened.

**3. The row against the database.** The identity registry, the participation
ledger, and lifetime exclusions already recorded.

Verdicts:

| Status     | Blocks? | Meaning                                   |
| ---------- | ------- | ----------------------------------------- |
| `VALID`    | no      | Nothing found                             |
| `WARNING`  | no      | Worth seeing, safe to proceed past        |
| `CONFLICT` | yes     | Well-formed, and disagrees with something |
| `INVALID`  | yes     | Does not say anything usable              |

The distinction between the last two matters: `INVALID` is a broken row,
`CONFLICT` is a question only a human can answer.

## Conflict handling

**Nothing is silently repaired.** Every disagreement is reported and blocks; none
is resolved by preferring one source over the other.

### Inside one file

- **Identical repeats** of the same person and year are consolidated: the first is
  kept, the rest are `DUPLICATE_ROW_IN_FILE` warnings and write nothing. Nothing
  is in dispute.
- **Differing repeats** are `CONFLICTING_DUPLICATE_IN_FILE` on _both_ rows — a
  reviewer needs to see the disagreement, not a survivor. `won=false` beside
  `won=true` for one person-year blocks, and so does a differing commune.
- **Chronology.** Winning is a lifetime entitlement, so two wins for one person
  block, and so does taking part in a year _after_ the year they won:

  ```
  2022 lost   2023 lost   2024 won   2025 lost   ← 2025 blocks
  ```

### Against the database

- **Identity.** The national ID identifies the person; name and date of birth
  corroborate. A disagreement is `IDENTITY_CONFLICT` on _that person's_ record —
  never a second participant with the same national ID. Case and spacing are
  transcription noise and are ignored. A different phone number is a warning:
  people change numbers, and the registry's is never replaced from a spreadsheet.
- **Existing history.** An identical existing record is `ALREADY_RECORDED`, a
  warning, and the row writes nothing. A differing one is
  `CONFLICTS_WITH_EXISTING_HISTORY` and blocks; the authoritative row is never
  overwritten.
- **Lifetime exclusion.** If the person has already won:
  - the file records a _second_ win → `ALREADY_A_WINNER`, blocked. One person, one
    Hajj.
  - the file records a loss in a year _before_ the win → coherent, and exactly the
    history an import exists to establish.
  - the file records participation _after_ the win →
    `CONTRADICTS_WINNER_CHRONOLOGY`, blocked.

  `has_won_hajj` is never cleared. A permanent exclusion is not something an
  uploaded spreadsheet reverses by omission.

Conflicting source rows are kept, never deleted: the row is the evidence for the
conflict.

## Participant identity matching

1. Normalize the national ID with `lib/national-id.ts` — Arabic-Indic and Persian
   digits folded, separators stripped, canonical 18 ASCII digits.
2. Look the person up by that.
3. Found → reuse them, **untouched**. Their name, date of birth and phone number
   are whatever the registry says. Any disagreement was raised as a conflict, not
   resolved here.
4. Absent → create them, but only during the final import.

A register written in Arabic-Indic digits resolves to the person already known by
the ASCII form. That is the whole reason normalization is centralised.

## Commune resolution

By official code, always. Names are transliterated inconsistently, renamed over
decades and repeated across wilayas; matching on them would attach somebody's
history to the wrong territory in a way nobody would notice. An unknown code is a
validation error, and **no commune is created** to accommodate it.

The imported record stores the commune _of that year_, so a person who moved keeps
the history they actually accrued where they accrued it.

A controlled mapping for historical commune names is a future addition, and it is
a mapping table an administrator maintains — never a fuzzy match invented at
import time.

## Draw years

Validated against the same reference year the ledger uses, so nothing in the
future can be imported. An imported year does **not** need a `DrawYear` record:
`DrawYear` is the configuration of a cycle this platform ran, and a 2011 paper
draw was not one. `ParticipationHistory` is sufficient.

## Approval

Legacy import is sensitive in a way that ordinary administration is not: it grants
lifetime priority and imposes lifetime exclusion, across communes, from a source
that cannot be re-derived.

- **Uploading and reviewing** are open to every administrator, scoped. What their
  role limits is _reach_: a scoped administrator's file may only name their own
  territory, and a row that goes further is refused per row
  (`OUT_OF_SCOPE_COMMUNE`) so the overreach is visible rather than silent.
- **Approving, rejecting and executing** are `SUPER_ADMIN` only.
- **Nobody reviews the import they uploaded.** Checked in the service, and again
  by a `CHECK` constraint — a rule that lives only in a service is a rule a later
  refactor can drop.
- A decision requires a reason, refused blank at three layers (Zod, the service,
  a `CHECK`).

### Why not `ApprovalRequest`

The batch already has a lifecycle with an approver, a moment and a reason on it.
An `ApprovalRequest` pointing at a batch that also carries its own status would
give two answers to "is this approved?", and they could disagree. The separation
of duties that matters — the requester is not the reviewer — is expressed here by
the same kind of `CHECK` constraint, on the batch itself. See
[audit-and-governance.md](audit-and-governance.md) for the workflow that does use
`ApprovalRequest`, and why.

## The import transaction

One transaction, all of it:

```
BEGIN
  claim the batch  (APPROVED → IMPORTED, conditional)
  re-check every row against the database as it is now
  create or reuse participants
  write ParticipationHistory   (source = LEGACY_IMPORT, verified = true)
  write LegacyWinner rows
  set has_won_hajj             (compare-and-set)
  link each staged row to what it produced
  write the audit event
  confirm the counts
COMMIT
```

Any failure unwinds all of it including the claim, leaving the batch `APPROVED`
and retryable. A half-imported batch would mean some people have their waiting
years and others do not, with no way to tell which from the outside.

**The claim is the concurrency guard** — a conditional `UPDATE ... WHERE status =
'APPROVED'`, not a lock held in this process. Two executions arriving together
serialize on the row and the loser writes nothing. Production may run many
instances; an in-memory guard would protect exactly one of them.

**Everything is re-checked**, even though it was checked at staging. Time passed:
a real draw may have concluded and made somebody a winner, another batch may have
written the same year. The check that counts is the one made against the state
being written into.

**Batched, not per row.** Participants, history and winners go in through
`createMany` a thousand at a time, and the staged rows are linked back with a
chunked `VALUES` join. One statement per row would be tens of thousands of round
trips inside a transaction holding locks. What is _not_ done is a blind `upsert`:
conflicts are reviewed before the write, never resolved by it.

## Verification policy

**An approved import writes `verified: true`.** This is a deliberate resolution of
a real tension, and it is worth stating plainly.

The ledger's rule is that unverified history does not count toward a streak,
precisely so that an unreviewed pile of legacy rows cannot inflate somebody's
priority. But an imported batch _has_ been reviewed: staged, checked, its conflicts
read, and accepted by a national administrator who did not upload it. That is
exactly the act the flag exists to record.

The unverified stage is staging itself. Writing the final rows unverified would
mean an approved import counted for nothing — an approval that approved nothing —
and an administrator would then have to verify twelve thousand rows one at a time
to undo it.

`source` is always `LEGACY_IMPORT`, decided here and never by the file. A register
cannot declare itself to be the output of a draw this platform ran.

## Legacy winner provenance

`LegacyWinner` is a second winner model, on purpose.

`WinnerArchive` is the output of an executed draw: it names a `DrawResult`, a
`DrawPoolEntry` and a selection order, none of which a paper register has or could
have. Forcing legacy winners into that shape would mean four nullable foreign keys
and a row claiming to describe a draw this system never ran.

So the two provenances stay visibly different, and "was this a web-era draw or a
transcribed register?" is answered by which table the row is in:

| Web era                     | Legacy                    |
| --------------------------- | ------------------------- |
| `DrawResult` + `DrawWinner` | `LegacyWinner`            |
| `WinnerArchive`             | `LegacyWinner`            |
| Pool entry, selection order | Import batch, import row  |
| Random value, algorithm     | Source filename, checksum |

What they share is the invariant that matters: `UNIQUE(participant_id)`, one win
per person for life, in both.

`has_won_hajj` is set by a compare-and-set on `hasWonHajj: false` with the count
checked. That is what closes the window between approval and execution: if a real
draw selected one of these people in the meantime, the update matches fewer rows
than expected and the entire import rolls back rather than quietly recording a
second lifetime win.

Legacy winner rows are immutable by trigger, like the web-era ones. A second
winner model with weaker protection would just be the easier one to edit.

## Geographic scoping

A batch has no geography of its own; its rows do.

- **Batch visibility**: an administrator sees a batch when at least one of its rows
  lands in their territory, or when they uploaded it. The second clause matters for
  a batch whose rows all named communes that do not exist — it touches nobody's
  territory, and its uploader still has to find out why.
- **Row visibility**: narrowed to the caller's communes, through one filter
  (`AuthorizationService.importRowScope`) that every query about a batch's contents
  goes through. The uploader is the exception: they supplied every row, so
  withholding any would hide the lines they need to correct while telling them
  nothing new.
- **Counts follow the rows.** The summary is computed per request, not stored, so a
  `COMMUNE_ADMIN` reviewing a national register is told what it does to their
  commune and learns nothing about the size of anybody else's import.
- **Out of scope is 404**, byte-identical to an id that was never issued, so nobody
  can discover whether another commune has imported anything by probing. A wrong
  _role_ is 403.

## Auditing

Four events: `LEGACY_IMPORT_CREATED`, `_APPROVED`, `_REJECTED`, `_COMPLETED`. Four
rather than one because the four moments differ in actor and in consequence:
uploading stages nothing authoritative, approving still writes nothing, and only
completion changes what a future lottery sees.

Each carries the actor, the batch, the checksum, the year span and safe counts.
**None carries the register.** No national ID, no name, no date of birth, no phone
number — `assertSafePayload` refuses them outright rather than masking them, and a
test asserts the trail contains none of the values from the imported file.

A batch is filed under the _uploader's_ own reach. This is a narrow, deliberate
exception to the rule that audit scope comes from the target: a scoped
administrator's file cannot name anywhere outside their reach, so their reach _is_
the batch's coverage — and it is known before the rows are staged, which is when
the first event is recorded. A national administrator's import is filed
nationally, and scoped administrators do not see it, which is the same rule the
rest of the trail follows.

## Repeat imports

The SHA-256 of the uploaded bytes is stored, uniquely. Re-uploading the same file
returns `409 DUPLICATE_IMPORT_SOURCE` naming the batch that already holds it:
_"Identical source file already processed."_ An administrator reviews that batch
rather than creating another.

The checksum is an integrity and identity mechanism only — never a credential, and
never proof that the _contents_ are new. Two different files can carry the same
rows, so row-level duplicate detection runs on every import regardless.

## Corrections after the fact

Do not delete and re-import. There is no un-import: `IMPORTED` is terminal by
trigger, legacy winner rows are immutable, and the batch is the provenance for
every row it wrote.

A mistake discovered afterwards goes through the existing historical correction
workflow — a scoped administrator raises an `ApprovalRequest`, a `SUPER_ADMIN`
corrects directly — which amends the record in place, requires a reason, and is
audited. The correction sets `source = ADMIN_CORRECTION`, so the current claim is
visibly an administrator's; the import batch and staged row it came from stay
exactly as they were. Provenance is never rewritten. See
[audit-and-governance.md](audit-and-governance.md).

## Retention

**The uploaded file is not retained at all.** It is parsed in memory and
discarded. What survives is the batch record, the checksum, and the staged rows.

Staged rows _are_ retained, including for imported and rejected batches, and this
is a choice rather than an oversight: they are the evidence for what was written
and for every conflict a reviewer decided about, and deleting a conflicting source
row would destroy the reason it was a conflict.

They also hold national IDs, names and dates of birth. A retention policy that
eventually redacts staged rows for long-settled batches is the right next step;
this step does not implement automatic deletion, because a deletion schedule
nobody has decided on is worse than none.

## API

| Endpoint                               | Role        | Notes                                  |
| -------------------------------------- | ----------- | -------------------------------------- |
| `POST /api/admin/imports`              | any admin   | multipart, one file field named `file` |
| `GET /api/admin/imports`               | any admin   | Batches touching your territory        |
| `GET /api/admin/imports/:id`           | any admin   | 404 out of scope                       |
| `GET /api/admin/imports/:id/summary`   | any admin   | Counts over the rows you may see       |
| `GET /api/admin/imports/:id/rows`      | any admin   | Paged, scoped                          |
| `GET /api/admin/imports/:id/conflicts` | any admin   | Only what blocks                       |
| `POST /api/admin/imports/:id/approve`  | SUPER_ADMIN | Not the uploader; reason required      |
| `POST /api/admin/imports/:id/reject`   | SUPER_ADMIN | Terminal; reason required              |
| `POST /api/admin/imports/:id/execute`  | SUPER_ADMIN | Body ignored entirely                  |

The execute endpoint ignores its body. There is nothing a client could usefully
say: which rows to write, whether to skip conflicts, what to mark verified — every
one of those is a decision the batch already carries, and accepting any of them
from a request would make the approval mean something different from what was
approved. A test posts them all and asserts they are ignored.

## Deferred

- **A retention/redaction policy** for staged rows, as above.
- **A historical commune-name mapping table**, for registers using names that have
  since changed. Deliberately not a fuzzy match.
- **Import corrections as a first-class workflow** — today a mistake is corrected
  record by record through the existing approval flow, which is right but does not
  yet let a reviewer see "everything batch X wrote" as one screen.
- **Reversing an import.** There is no un-import and there should not be one
  without a policy decision about what happens to a lifetime exclusion that turns
  out to have been transcribed wrongly.
