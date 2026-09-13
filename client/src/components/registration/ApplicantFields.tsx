import { limitToDigits, NATIONAL_ID_LENGTH } from '@hajj-lottery/shared'
import { useTranslation } from 'react-i18next'

import { Label } from '../shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../shadcn/select'
import { Input } from '../ui'
import type { ApplicantFieldErrors, ApplicantFormValues } from './applicant'

export interface ApplicantFieldsProps {
  values: ApplicantFormValues
  errors: ApplicantFieldErrors
  disabled?: boolean
  onChange: (values: ApplicantFormValues) => void
  /** Distinguishes the primary and secondary field sets for autofill and ids. */
  idPrefix: string
  /** The Mahram slot admits a male participant only. */
  allowedGenders?: readonly ('MALE' | 'FEMALE')[]
}

/** The identity fields for one applicant, used for both people on a pair. */
export function ApplicantFields({
  values,
  errors,
  disabled,
  onChange,
  idPrefix,
  allowedGenders,
}: ApplicantFieldsProps) {
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
        hint={errors.nationalId ? undefined : t('register.fields.nationalIdHint')}
        disabled={disabled}
        required
      />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-gender`}>
          {t('register.fields.gender')}
          <span aria-hidden="true" className="ms-0.5 text-red-600">
            *
          </span>
        </Label>
        <Select value={values.gender} onValueChange={update('gender')} disabled={disabled} required>
          <SelectTrigger
            id={`${idPrefix}-gender`}
            // Matches `Input`'s own box exactly (border + py-2 + text-sm line
            // height = 38px) instead of the default `h-9` (36px), so the
            // gender field lines up with its neighbours in the grid rather
            // than sitting two pixels short.
            className="w-full data-[size=default]:h-auto"
            aria-invalid={Boolean(errors.gender)}
          >
            <SelectValue placeholder={t('register.fields.genderPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {allowedGenders?.includes('MALE') !== false && (
              <SelectItem value="MALE">{t('register.fields.genderMale')}</SelectItem>
            )}
            {allowedGenders?.includes('FEMALE') !== false && (
              <SelectItem value="FEMALE">{t('register.fields.genderFemale')}</SelectItem>
            )}
          </SelectContent>
        </Select>
        {errors.gender && <p className="text-xs text-destructive">{errors.gender}</p>}
      </div>
      <p className="col-span-full -mb-2 text-sm font-medium text-stone-600">
        {t('register.fields.arabicNameSection')}
      </p>
      <Input
        id={`${idPrefix}-first-name-ar`}
        label={t('register.fields.firstNameAr')}
        autoComplete="off"
        dir="rtl"
        lang="ar"
        value={values.firstNameAr}
        onChange={(event) => update('firstNameAr')(event.target.value)}
        error={errors.firstNameAr}
        disabled={disabled}
        required
      />
      <Input
        id={`${idPrefix}-last-name-ar`}
        label={t('register.fields.lastNameAr')}
        autoComplete="off"
        dir="rtl"
        lang="ar"
        value={values.lastNameAr}
        onChange={(event) => update('lastNameAr')(event.target.value)}
        error={errors.lastNameAr}
        disabled={disabled}
        required
      />
      <p className="col-span-full -mb-2 text-sm font-medium text-stone-600">
        {t('register.fields.latinNameSection')}
      </p>
      <Input
        id={`${idPrefix}-first-name-latin`}
        label={t('register.fields.firstNameLatin')}
        autoComplete="off"
        dir="ltr"
        value={values.firstNameLatin}
        onChange={(event) => update('firstNameLatin')(event.target.value)}
        error={errors.firstNameLatin}
        disabled={disabled}
        required
      />
      <Input
        id={`${idPrefix}-last-name-latin`}
        label={t('register.fields.lastNameLatin')}
        autoComplete="off"
        dir="ltr"
        value={values.lastNameLatin}
        onChange={(event) => update('lastNameLatin')(event.target.value)}
        error={errors.lastNameLatin}
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
        hint={errors.phoneNumber ? undefined : t('register.fields.phoneNumberHint')}
        disabled={disabled}
        required
      />
    </div>
  )
}
