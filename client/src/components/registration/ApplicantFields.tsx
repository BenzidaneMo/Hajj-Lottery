import { limitToDigits, NATIONAL_ID_LENGTH } from '@hajj-lottery/shared'
import { useTranslation } from 'react-i18next'

import { Input } from '../ui'
import type { ApplicantFieldErrors, ApplicantFormValues } from './applicant'

export interface ApplicantFieldsProps {
  values: ApplicantFormValues
  errors: ApplicantFieldErrors
  disabled?: boolean
  onChange: (values: ApplicantFormValues) => void
  /** Distinguishes the primary and secondary field sets for autofill and ids. */
  idPrefix: string
}

/** The identity fields for one applicant, used for both people on a pair. */
export function ApplicantFields({ values, errors, disabled, onChange, idPrefix }: ApplicantFieldsProps) {
  const { t } = useTranslation()

  const update = (field: keyof ApplicantFormValues) => (value: string) =>
    onChange({ ...values, [field]: value })

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Input
        id={`${idPrefix}-national-id`}
        label={t('register.fields.nationalId')}
        // Numeric, but not type="number": leading zeros are significant and
        // spinners make no sense for an 18-digit identifier.
        inputMode="numeric"
        autoComplete="off"
        value={values.nationalId}
        // Accepts digits only and stops at 18, so the field cannot hold more
        // than a national ID can mean. Arabic-Indic digits count and are left
        // in the script they were typed — the field must not rewrite itself
        // under the citizen's cursor in the app's default language.
        onChange={(event) => update('nationalId')(limitToDigits(event.target.value, NATIONAL_ID_LENGTH))}
        error={errors.nationalId}
        disabled={disabled}
        required
      />
      <Input
        id={`${idPrefix}-full-name`}
        label={t('register.fields.fullName')}
        autoComplete="off"
        value={values.fullName}
        onChange={(event) => update('fullName')(event.target.value)}
        error={errors.fullName}
        disabled={disabled}
        required
      />
      <Input
        id={`${idPrefix}-dob`}
        label={t('register.fields.dob')}
        type="date"
        value={values.dob}
        onChange={(event) => update('dob')(event.target.value)}
        error={errors.dob}
        disabled={disabled}
        required
      />
      <Input
        id={`${idPrefix}-phone`}
        label={t('register.fields.phoneNumber')}
        type="tel"
        inputMode="tel"
        autoComplete="off"
        placeholder="0555 12 34 56"
        value={values.phoneNumber}
        onChange={(event) => update('phoneNumber')(event.target.value)}
        error={errors.phoneNumber}
        disabled={disabled}
      />
    </div>
  )
}
