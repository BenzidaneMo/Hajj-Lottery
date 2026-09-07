/**
 * A participant identity record, as exposed by the participant API.
 *
 * This is the administrative view: it carries the national ID, so it must
 * only ever be returned from access-controlled endpoints. It deliberately
 * has no draw year, commune, status or weight — those belong to the annual
 * application models, which reference a participant by `id`.
 */
export interface ParticipantDto {
  id: string
  nationalId: string
  fullName: string
  /** Calendar date, `YYYY-MM-DD`. No time component. */
  dob: string
  hasWonHajj: boolean
  createdAt: string
  updatedAt: string
}
