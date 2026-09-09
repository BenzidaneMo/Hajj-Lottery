/**
 * The citizen-facing surface: what a member of the public may see.
 *
 * Everything here is a deliberate publication decision rather than a projection
 * of a database row. The internal models carry national IDs, dates of birth,
 * phone numbers, computed weights, participation streaks and internal ids —
 * none of which appear in any type in this file, and none of which any endpoint
 * that serves these types is allowed to load into one.
 *
 * Two rules shape the whole surface:
 *
 * - **Places are named by their official code, never by a database id.** A
 *   public URL and a public payload identify a commune the way a citizen does.
 * - **Every locale travels together.** A response carries `nameAr`/`nameFr`/
 *   `nameEn` so the client renders the active language without a second request
 *   and without the server having to guess who is asking.
 */

import type { EntryType } from './application.js'

/**
 * An application's state, as its own applicant may see it.
 *
 * Deliberately not the internal `ApplicationStatus`. The internal vocabulary
 * distinguishes states that a citizen has no use for and that would leak the
 * order in which the system worked, and — more importantly — it names the final
 * outcome the moment a draw concludes, which is weeks before that outcome may be
 * announced. See `AWAITING_RESULTS`.
 */
export const PUBLIC_APPLICATION_STATUSES = [
  /** Received; the eligibility engine has not judged it yet. */
  'SUBMITTED',
  /** Accepted and entered in its commune's draw. */
  'IN_DRAW',
  /** Refused. The *reason* is never given publicly — see docs/eligibility.md. */
  'NOT_ELIGIBLE',
  /**
   * The draw has been run and this application's outcome is settled, but the
   * result has not been published. Both `SELECTED` and `NOT_SELECTED` collapse
   * onto this until publication, so the lookup cannot be used to learn a result
   * before it is announced — including by whoever is watching for it to change.
   */
  'AWAITING_RESULTS',
  'SELECTED',
  /**
   * Drawn into the reserve list. Not a winner, and not passed over: this
   * application holds an ordered contingency position and may be called if a
   * winner gives up their place. Whether they have since been called, and
   * whether they said yes, is administrative and is not reported here — a
   * reserve who accepts becomes `SELECTED`.
   */
  'RESERVE',
  'NOT_SELECTED',
] as const

export type PublicApplicationStatus = (typeof PUBLIC_APPLICATION_STATUSES)[number]

/**
 * Where one commune's draw stands, publicly.
 *
 * A narrowing of `CommuneDrawStatus`: `DRAFT` and `READY` are one phase here
 * because the difference between them is administrative preparation nobody
 * outside the commune office needs to see. Whether the *results* are out is a
 * separate flag, never a phase — a drawn-but-unpublished draw and a published
 * one are the same phase and differ only in what may be read.
 */
export const PUBLIC_DRAW_PHASES = ['ACCEPTING', 'ENTRIES_CLOSED', 'DRAWN', 'CANCELLED'] as const

export type PublicDrawPhase = (typeof PUBLIC_DRAW_PHASES)[number]

/**
 * A wilaya or commune, as the public sees one.
 *
 * No `id`. Internal identifiers are absent from every public payload and every
 * public URL: they are opaque, they are enumerable in a way official codes are
 * not, and a citizen has no use for them.
 */
export interface PublicPlaceDto {
  code: string
  nameAr: string
  nameFr: string
  nameEn: string
}

/** Body of `POST /api/public/application-status`. */
export interface ApplicationStatusLookupRequest {
  /** The receipt reference, e.g. `HZ-2027-MES-8F42K1`. */
  applicationReference: string
  /** The primary applicant's mobile number, in any form they might write it. */
  phoneNumber: string
}

/**
 * One application, to the person who can prove they hold its receipt.
 *
 * Carries nothing about anybody's identity — no name, no national ID, no date of
 * birth, not even the phone number that was just used to verify the request —
 * and nothing about priority: no weight, no streak, no participation history. A
 * citizen checking their own application learns the state of that application
 * and nothing about themselves the system could be made to reveal to somebody
 * else holding the same two fields.
 */
export interface PublicApplicationStatusDto {
  applicationReference: string
  drawYear: number
  wilaya: PublicPlaceDto
  commune: PublicPlaceDto
  entryType: EntryType
  /** 1 or 2. Whether the application covers one applicant or a pair. */
  applicantCount: number
  status: PublicApplicationStatus
  drawPhase: PublicDrawPhase
  /** Whether this commune's official result is out. Gates `status` above. */
  resultsPublished: boolean
  submittedAt: string
}

/**
 * One winning entry, as published.
 *
 * The application reference is the public identifier, exactly as it is on the
 * citizen's own receipt, so somebody can find themselves in the list without the
 * list naming anybody. Names are absent — publishing them is a decision for the
 * governing authority to take explicitly, not one to arrive at by default (see
 * docs/public-access.md).
 *
 * `selectedWeight` is deliberately absent even though the internal
 * `DrawWinnerDto` carries it: a weight is one person's accumulated priority, and
 * publishing it would publish how many years they had been waiting.
 */
export interface PublicWinnerDto {
  /** 1-based position in the order the entries were drawn — not a rank. */
  selectionOrder: number
  applicationReference: string
  entryType: EntryType
  /** 1 for SINGLE, 2 for PAIRED. Spots count entries; a pair is one entry. */
  participantCount: number
  /**
   * Whether this entry still holds the place it won.
   *
   * `WITHDRAWN` says only that the place was given up, never why: an
   * abandonment's reason and explanation are administrative and may describe a
   * death or an illness. The original selection is unchanged either way — the
   * list still reports who the lottery drew, in the order it drew them.
   */
  outcome: PublicWinnerOutcome
}

/** An original winner's place, as the public may see it. Never a reason. */
export const PUBLIC_WINNER_OUTCOMES = ['ACTIVE', 'WITHDRAWN'] as const
export type PublicWinnerOutcome = (typeof PUBLIC_WINNER_OUTCOMES)[number]

/**
 * A reserve's standing, as the public may see it.
 *
 * `CALLED` is deliberately visible: a place has been offered and the answer is
 * not in yet, which is a fact about the draw rather than about the person.
 */
export const PUBLIC_RESERVE_OUTCOMES = ['WAITING', 'CALLED', 'PROMOTED', 'DECLINED'] as const
export type PublicReserveOutcome = (typeof PUBLIC_RESERVE_OUTCOMES)[number]

/**
 * One reserve position, as published.
 *
 * Published for the same reason the winner list is: a citizen holding a receipt
 * must be able to find out where they stand without asking anybody. It carries
 * exactly what the winner list carries — reference, entry type, how many people
 * — plus the two orderings that make the reserve list checkable: the position in
 * the call order, and the position in the whole draw it came from.
 */
export interface PublicReserveDto {
  /** 1..N, the order reserves are called in. */
  reservePosition: number
  /** Position in the whole draw: always after every winner. */
  selectionOrder: number
  applicationReference: string
  entryType: EntryType
  /** 1 for SINGLE, 2 for PAIRED. A paired reserve is still one position. */
  participantCount: number
  outcome: PublicReserveOutcome
}

/** A published commune result, without its winner list. */
export interface PublicResultSummaryDto {
  drawYear: number
  wilaya: PublicPlaceDto
  commune: PublicPlaceDto
  /** The commune's places, as they stood when the pool was frozen. */
  allocatedSpots: number
  /** Winning applications. A paired application is one. */
  winnerCount: number
  /**
   * Winning individuals, which can exceed `winnerCount`: ten places filled by
   * nine single and one paired application is ten entries and eleven people.
   */
  winningParticipantCount: number
  publishedAt: string
}

/** A published commune result in full. */
export interface PublicResultDto extends PublicResultSummaryDto {
  /** Applications the draw chose from, taken from the frozen pool. */
  entryCount: number
  /**
   * The SHA-256 commitment to the frozen input the draw ran against. Published
   * so the result can be shown to be the one that was drawn; it is emphatically
   * not a seed, and it reveals nothing about who entered.
   */
  poolHash: string
  algorithmVersion: string
  /** When the draw itself concluded, which is not when it was published. */
  drawnAt: string
  winners: PublicWinnerDto[]
  /**
   * The reserve list, in call order — the second half of the same continuous
   * draw. Published so the order is on the record before anybody is called: a
   * reserve list produced after the fact, or reordered, would be a second
   * lottery, and being able to check that it was neither is the point.
   */
  reserves: PublicReserveDto[]
}

/**
 * One commune's draw, publicly.
 *
 * Carries no applicant count of any kind. How many people have applied is live,
 * privacy-adjacent information during intake, and after the draw the number that
 * matters — how many entries the lottery chose from — is part of the *published*
 * result rather than of a status page.
 */
export interface PublicDrawStatusDto {
  drawYear: number
  /** Whether the national cycle is taking applications. */
  registrationOpen: boolean
  wilaya: PublicPlaceDto
  commune: PublicPlaceDto
  allocatedSpots: number
  phase: PublicDrawPhase
  resultsPublished: boolean
  /** Winning applications, once published. Null before that, never zero. */
  winnerCount: number | null
}

/** One bounded page of a public listing. The whole table is never returned. */
export interface PublicPageDto<T> {
  items: T[]
  page: number
  pageSize: number
  /** Matching rows, not rows returned. */
  total: number
  totalPages: number
}

/**
 * Page bounds for every public listing, enforced server-side.
 *
 * A public endpoint has no authenticated caller to hold responsible, so the cap
 * is not a default a client can raise: `?pageSize=10000000` is clamped, not
 * honoured, and there is no unpaginated variant of any of these routes.
 */
export const PUBLIC_PAGE_SIZE_DEFAULT = 25
export const PUBLIC_PAGE_SIZE_MAX = 100

/** What an administrator gets back from publishing, or re-publishing. */
export interface ResultPublicationDto {
  drawYear: number
  communeCode: string
  wilayaCode: string
  publishedAt: string
  winnerCount: number
  winningParticipantCount: number
  /**
   * True when this call found the result already published and changed nothing.
   * Publishing is idempotent: the second request is not an error, and it writes
   * neither a second publication nor a second audit event.
   */
  alreadyPublished: boolean
}
