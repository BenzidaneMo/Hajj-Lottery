# Citizen registration

A citizen submits one application per draw year, for exactly one commune, with
no account and no password. `POST /api/applications` is public by design.

## Participant versus Application

- **Participant** — who someone is. One record per national ID, for life.
- **Application** — how that person is taking part in one particular year.

Identity is never copied onto an application. There is no `secondary_name` or
`secondary_dob` column; both applicants are Participant rows the application
points at. A test asserts the `applications` table has no identity columns, so
this cannot drift.

## The flow

1. Validate the body's shape (Zod, `.strict()`).
2. Resolve the commune: it must exist, be active, and belong to the wilaya the
   form claimed. `commune.wilayaId` in the database is authoritative; the
   submitted `wilayaId` is only ever compared against it.
3. Take the draw year from the server.
4. In one transaction: find-or-create each participant, refuse if either has
   won before, then create the application and its participation rows.
5. Return a receipt.

Everything in steps 2–4 is decided server-side. The frontend repeats some
checks for a faster round trip, and none of them are load-bearing.

## Duplicate prevention

The rule is one application per person per draw year, whichever slot they
occupy. Two unique constraints on `applications` cannot express that: someone
listed as primary on one application and secondary on another satisfies both.

So every participant of every application also gets a row in
**`application_participants`**, whose primary key is `(draw_year,
participant_id)`. Role is irrelevant to that key, so the second attempt
collides no matter how it arrives:

| Attempt                                          | Caught by                     |
| ------------------------------------------------ | ----------------------------- |
| Same person applies twice                        | `application_participants` PK |
| Same person, different commune or wilaya         | `application_participants` PK |
| Primary on one application, secondary on another | `application_participants` PK |
| Same person as secondary on two applications     | `application_participants` PK |

Because the guarantee is a database constraint rather than a read-then-write
check, concurrent submissions resolve correctly: one wins, the others get a
`P2002` that becomes a `409 ALREADY_APPLIED`. Tests fire three simultaneous
registrations and assert exactly one survives.

`application_participants.draw_year` is part of a composite foreign key back to
`applications(id, draw_year)`, so a participation row cannot claim a different
year than its application — Prisma will not even let the field be set
independently.

Two further CHECK constraints hold the shape: `entry_type` must agree with
whether a secondary applicant is present, and the two applicants must differ.

## Participant reuse

An existing participant is reused **untouched** — not the name, the date of
birth, or the phone number.

Overwriting identity from an unauthenticated public form would let anyone who
knows a national ID rewrite that person's details or attach their own phone to
them. _Reporting_ a mismatch would be worse: it would turn registration into an
oracle for which national IDs are registered. So the submitted values are used
only when creating a new record.

**Deferred:** correcting a genuine mistake in stored identity is an
administrative workflow, and does not exist yet.

## Phone numbers

Contact information, never a credential. Nothing authenticates on a phone
number and `phone_verified_at` is never set — there is no OTP in this system.

`normalizePhoneNumber` canonicalizes to `+213XXXXXXXXX`, accepting `0555…`,
`+213555…`, `00213555…` and a bare `213555…`, grouped with spaces or dashes,
in Latin or Arabic-Indic digits. One person cannot become two records by
typing their number differently in different years. Only Algerian mobile
numbers (5, 6, 7) are accepted, since the field exists to reach an applicant.

Digit folding and separator stripping are shared with national IDs
(`lib/digits.ts`) rather than implemented twice.

## Application references

`HZ-2027-MES-8F42K1` — prefix, draw year, a three-letter commune label, and six
random characters.

- **Random, not sequential**, so it reveals neither how many people have
  applied nor a neighbour's reference.
- **No database id and no national ID.**
- Drawn from a CSPRNG over an alphabet without `I`, `L`, `O` or `U`, so it
  survives being handwritten and read aloud.
- Uniqueness is guaranteed by the unique index, not by the generator: the
  service retries the whole transaction on collision.

The commune token is a human label, not an identifier — several communes may
share one, and nothing depends on it.

## What the citizen gets back

The receipt carries a reference, year, entry type, status, commune and wilaya
names, and a timestamp. No names, national IDs, dates of birth, phone numbers
or database ids — it is safe to print at a shared counter or photograph.

## Abuse and privacy

- The JSON body is capped at 32kb globally, which is where the limit can
  actually take effect (the parser runs before any router).
- `POST /api/applications` is rate limited per IP.
- Registration bodies are never logged; they are full of national IDs.
- Refusals are deliberately uninformative. A previous winner and their partner
  get one message that names neither applicant nor the reason, and an invalid
  commune reads identically whether it does not exist or belongs to another
  wilaya.

## Eligibility

Whether an application may take part is not decided here. Registration checks
that intake is open and settles the draw year, then hands everything else to
`EligibilityService` — including the commune's validity and the previous-winner
rule, which used to live in this service.

The verdict is reached inside the same transaction that creates the
application, so an accepted one is stored as `ELIGIBLE` and a refused one is
never stored at all. See [eligibility](eligibility.md).

## Deferred

- Weighting — `calculated_weight` exists and stays NULL
- Historical participation, the draw itself, winner processing
- Status lookup by reference for citizens
- Administrative application management
- A real draw lifecycle. The year currently comes from `DRAW_YEAR` /
  `REGISTRATION_OPEN` environment configuration, which is a placeholder.
