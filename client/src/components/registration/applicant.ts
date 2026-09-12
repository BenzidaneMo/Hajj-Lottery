/** One applicant's fields as the form holds them: all strings, all optional. */
export interface ApplicantFormValues {
  nationalId: string
  fullName: string
  dob: string
  gender: 'MALE' | 'FEMALE' | ''
  phoneNumber: string
}

export type ApplicantFieldErrors = Partial<Record<keyof ApplicantFormValues, string>>

/** Lives apart from ApplicantFields so that file exports only a component. */
export const EMPTY_APPLICANT: ApplicantFormValues = {
  nationalId: '',
  fullName: '',
  dob: '',
  gender: '',
  phoneNumber: '',
}
