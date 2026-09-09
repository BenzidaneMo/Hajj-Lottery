import {
  NATIONAL_ID_LENGTH,
  normalizeTypedNumber,
  type ApplicationReceiptDto,
  type CreateApplicationRequest,
  type EntryType,
} from '@hajj-lottery/shared'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { CommuneSelect, WilayaSelect } from '../components/geo'
import {
  EMPTY_APPLICANT,
  type ApplicantFieldErrors,
  type ApplicantFormValues,
} from '../components/registration/applicant'
import { ApplicantFields } from '../components/registration/ApplicantFields'
import { ApplicationReceipt } from '../components/registration/ApplicationReceipt'
import { Alert, Button, Card, Loading, PageHeader, RadioGroup } from '../components/ui'
import { ApiError } from '../lib/api'
import { submitApplication, useRegistrationWindow } from '../lib/applications'

interface FormErrors {
  primary: ApplicantFieldErrors
  secondary: ApplicantFieldErrors
  wilayaId?: string
  communeId?: string
}

const NO_ERRORS: FormErrors = { primary: {}, secondary: {} }

export function Register() {
  const { t } = useTranslation()
  const { data: window_, isLoading } = useRegistrationWindow()

  const [entryType, setEntryType] = useState<EntryType>('SINGLE')
  const [wilayaId, setWilayaId] = useState<string | undefined>(undefined)
  const [communeId, setCommuneId] = useState<string | undefined>(undefined)
  const [primary, setPrimary] = useState<ApplicantFormValues>(EMPTY_APPLICANT)
  const [secondary, setSecondary] = useState<ApplicantFormValues>(EMPTY_APPLICANT)

  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS)
  const [submissionError, setSubmissionError] = useState<string | undefined>(undefined)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [receipt, setReceipt] = useState<ApplicationReceiptDto | undefined>(undefined)

  /**
   * Client-side checks exist to spare the citizen a round trip, nothing more.
   * Every one of them is repeated on the server, which is the only place a
   * rule is actually enforced.
   */
  const validate = (): FormErrors | undefined => {
    const next: FormErrors = { primary: {}, secondary: {} }

    // Compared after folding, so an ID typed in Arabic-Indic digits is judged
    // the same way the server will judge it. A bare /\d/ would discard those
    // digits entirely and reject a perfectly valid entry.
    const canonical = (values: ApplicantFormValues) => normalizeTypedNumber(values.nationalId)

    const checkApplicant = (values: ApplicantFormValues): ApplicantFieldErrors => {
      const found: ApplicantFieldErrors = {}
      if (canonical(values).length !== NATIONAL_ID_LENGTH) {
        found.nationalId = t('register.errors.nationalId')
      }
      if (values.fullName.trim().length < 2) found.fullName = t('register.errors.fullName')
      if (!values.dob) found.dob = t('register.errors.dob')
      return found
    }

    next.primary = checkApplicant(primary)
    if (entryType === 'PAIRED') {
      next.secondary = checkApplicant(secondary)
      if (canonical(primary) === canonical(secondary) && !next.secondary.nationalId) {
        next.secondary.nationalId = t('register.errors.samePerson')
      }
    }
    if (!wilayaId) next.wilayaId = t('register.errors.wilaya')
    if (!communeId) next.communeId = t('register.errors.commune')

    const hasErrors =
      Object.keys(next.primary).length > 0 ||
      Object.keys(next.secondary).length > 0 ||
      next.wilayaId !== undefined ||
      next.communeId !== undefined

    return hasErrors ? next : undefined
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmissionError(undefined)

    const found = validate()
    setErrors(found ?? NO_ERRORS)
    if (found || !wilayaId || !communeId) return

    const toApplicant = (values: ApplicantFormValues) => ({
      nationalId: values.nationalId,
      fullName: values.fullName,
      dob: values.dob,
      ...(values.phoneNumber.trim() ? { phoneNumber: values.phoneNumber } : {}),
    })

    const request: CreateApplicationRequest = {
      entryType,
      wilayaId,
      communeId,
      primary: toApplicant(primary),
      ...(entryType === 'PAIRED' ? { secondary: toApplicant(secondary) } : {}),
    }

    setIsSubmitting(true)
    try {
      setReceipt(await submitApplication(request))
    } catch (error) {
      setSubmissionError(messageFor(error, t))
    } finally {
      setIsSubmitting(false)
    }
  }

  if (receipt) {
    return (
      <div>
        <PageHeader title={t('register.receipt.pageTitle')} />
        {/* The status lookup verifies a reference against the primary
            applicant's number, so an application submitted without one can
            never be checked online. Said here rather than discovered later. */}
        <ApplicationReceipt receipt={receipt} canCheckOnline={primary.phoneNumber.trim().length > 0} />
      </div>
    )
  }

  if (isLoading) return <Loading label={t('common.loading')} />

  if (window_ && !window_.isOpen) {
    return (
      <div>
        <PageHeader title={t('pages.register.title')} />
        <Alert variant="info" title={t('register.closed.title')}>
          {t('register.closed.body')}
        </Alert>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title={t('pages.register.title')}
        description={window_ ? t('register.subtitle', { year: window_.drawYear }) : undefined}
      />

      <form className="flex max-w-3xl flex-col gap-8" onSubmit={handleSubmit} noValidate>
        {submissionError && <Alert variant="error">{submissionError}</Alert>}

        <Card title={t('register.sections.entryType')}>
          <RadioGroup
            name="entryType"
            value={entryType}
            disabled={isSubmitting}
            onChange={(value) => setEntryType(value as EntryType)}
            options={[
              { value: 'SINGLE', label: t('register.entryType.SINGLE') },
              { value: 'PAIRED', label: t('register.entryType.PAIRED') },
            ]}
          />
          <p className="mt-2 text-sm text-stone-500">{t('register.entryType.hint')}</p>
        </Card>

        <Card title={t('register.sections.place')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <WilayaSelect value={wilayaId} onChange={setWilayaId} required />
            <CommuneSelect wilayaId={wilayaId} value={communeId} onChange={setCommuneId} required />
          </div>
          {(errors.wilayaId ?? errors.communeId) && (
            <p className="mt-2 text-xs text-red-600">{errors.wilayaId ?? errors.communeId}</p>
          )}
          <p className="mt-2 text-sm text-stone-500">{t('register.sections.placeHint')}</p>
        </Card>

        <Card title={t('register.sections.primary')}>
          <ApplicantFields
            idPrefix="primary"
            values={primary}
            errors={errors.primary}
            disabled={isSubmitting}
            onChange={setPrimary}
          />
        </Card>

        {entryType === 'PAIRED' && (
          <Card title={t('register.sections.secondary')} description={t('register.sections.secondaryHint')}>
            <ApplicantFields
              idPrefix="secondary"
              values={secondary}
              errors={errors.secondary}
              disabled={isSubmitting}
              onChange={setSecondary}
            />
          </Card>
        )}

        <div>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? t('register.submitting') : t('register.submit')}
          </Button>
        </div>
      </form>
    </div>
  )
}

/**
 * Turns an API failure into something a citizen can act on, using the error
 * code rather than the server's wording so the message stays translated.
 */
function messageFor(error: unknown, t: (key: string) => string): string {
  if (!(error instanceof ApiError)) return t('register.errors.unknown')

  switch (error.code) {
    case 'ALREADY_APPLIED':
      return t('register.errors.alreadyApplied')
    case 'APPLICANT_NOT_ELIGIBLE':
      return t('register.errors.notEligible')
    case 'INVALID_COMMUNE':
      return t('register.errors.invalidCommune')
    case 'REGISTRATION_CLOSED':
      return t('register.errors.closed')
    case 'COMMUNE_DRAW_NOT_CONFIGURED':
      return t('register.errors.communeNotDrawing')
    case 'TOO_MANY_ATTEMPTS':
      return t('register.errors.tooMany')
    case 'VALIDATION_FAILED':
      return t('register.errors.validation')
    default:
      return t('register.errors.unknown')
  }
}
