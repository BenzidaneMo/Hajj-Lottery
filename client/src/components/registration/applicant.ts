/** One applicant's fields as the form holds them: all strings, all required. */
export interface ApplicantFormValues {
  nationalId: string
  firstNameAr: string
  lastNameAr: string
  firstNameLatin: string
  lastNameLatin: string
  dob: string
  gender: 'MALE' | 'FEMALE' | ''
  phoneNumber: string
}

export type ApplicantFieldErrors = Partial<Record<keyof ApplicantFormValues, string>>

/** Lives apart from ApplicantFields so that file exports only a component. */
export const EMPTY_APPLICANT: ApplicantFormValues = {
  nationalId: '',
  firstNameAr: '',
  lastNameAr: '',
  firstNameLatin: '',
  lastNameLatin: '',
  dob: '',
  gender: '',
  phoneNumber: '',
}
