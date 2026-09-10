import {
  localizedGeoName,
  NATIONAL_ID_LENGTH,
  normalizeTypedNumber,
  type ApplicationReceiptDto,
  type CreateApplicationRequest,
  type EntryType,
  type SupportedLocale,
} from '@hajj-lottery/shared'
import { PencilIcon } from 'lucide-react'
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
import { Field } from '../components/public/DescriptionField'
import { StepIndicator } from '../components/public/StepIndicator'
import { Alert, Button, Card, Loading, PageHeader, RadioGroup } from '../components/ui'
import { ApiError } from '../lib/api'
import { submitApplication, useRegistrationWindow } from '../lib/applications'
import { useCommunesByWilaya, useWilayas } from '../lib/geo'

interface FormErrors {
  primary: ApplicantFieldErrors
  secondary: ApplicantFieldErrors
  wilayaId?: string
  communeId?: string
}

const NO_ERRORS: FormErrors = { primary: {}, secondary: {} }

type StepKey = 'entryType' | 'location' | 'primary' | 'secondary' | 'review'

/**
 * The registration workflow, presented as a wizard.
 *
 * This is a presentation change only: one `POST /api/applications` still
 * carries the whole application, `validate()` still runs the exact checks the
 * single-page form ran, and the server still re-decides everything —
 * eligibility, the draw year, whether the commune is accepting entries — on
 * submission regardless of what this component thinks it has confirmed along
 * the way. The steps exist so a citizen fills in one thing at a time instead
 * of meeting all of it in a single scroll; `secondary` only appears in the
 * list at all when entry type is `PAIRED`, and the last step is always a
 * review of everything before it submits.
 */
export function Register() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale
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

  const stepKeys: StepKey[] = [
    'entryType',
    'location',
    'primary',
    ...(entryType === 'PAIRED' ? (['secondary'] as const) : []),
    'review',
  ]
  const [stepIndex, setStepIndex] = useState(0)
  const currentKey = stepKeys[stepIndex]

  // Only for the names shown on the review step — the values that actually
  // travel to the server are the ids `WilayaSelect`/`CommuneSelect` already
  // hold, exactly as before.
  const { data: wilayas } = useWilayas()
  const { data: communes } = useCommunesByWilaya(wilayaId)
  const selectedWilaya = wilayas?.find((entry) => entry.id === wilayaId)
  const selectedCommune = communes?.find((entry) => entry.id === communeId)

  /**
   * Client-side checks exist to spare the citizen a round trip, nothing more.
   * Every one of them is repeated on the server, which is the only place a
   * rule is actually enforced.
   */
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

  const checkSecondary = (): ApplicantFieldErrors => {
    const found = checkApplicant(secondary)
    if (canonical(primary) === canonical(secondary) && !found.nationalId) {
      found.nationalId = t('register.errors.samePerson')
    }
    return found
  }

  const checkLocation = (): Pick<FormErrors, 'wilayaId' | 'communeId'> => ({
    wilayaId: wilayaId ? undefined : t('register.errors.wilaya'),
    communeId: communeId ? undefined : t('register.errors.commune'),
  })

  /** The full check, run once more immediately before the request is sent. */
  const validate = (): FormErrors | undefined => {
    const location = checkLocation()
    const next: FormErrors = {
      primary: checkApplicant(primary),
      secondary: entryType === 'PAIRED' ? checkSecondary() : {},
      ...location,
    }

    const hasErrors =
      Object.keys(next.primary).length > 0 ||
      Object.keys(next.secondary).length > 0 ||
      next.wilayaId !== undefined ||
      next.communeId !== undefined

    return hasErrors ? next : undefined
  }

  /** Validates only the step being left, so an earlier mistake elsewhere does not block leaving this one. */
  const goNext = () => {
    if (currentKey === 'location') {
      const location = checkLocation()
      setErrors((prev) => ({ ...prev, ...location }))
      if (location.wilayaId ?? location.communeId) return
    } else if (currentKey === 'primary') {
      const found = checkApplicant(primary)
      setErrors((prev) => ({ ...prev, primary: found }))
      if (Object.keys(found).length > 0) return
    } else if (currentKey === 'secondary') {
      const found = checkSecondary()
      setErrors((prev) => ({ ...prev, secondary: found }))
      if (Object.keys(found).length > 0) return
    }
    setStepIndex((index) => Math.min(index + 1, stepKeys.length - 1))
  }

  const goBack = () => setStepIndex((index) => Math.max(0, index - 1))
  const goToStep = (key: StepKey) => setStepIndex(Math.max(0, stepKeys.indexOf(key)))

  const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    // One `<form>` for the whole wizard, so Enter in a field advances the
    // step it belongs to (or submits, on the last one) the way a browser's
    // own submit-on-Enter already works — rather than doing nothing, which is
    // what a bare `onClick` on the Next button would leave keyboard users with.
    if (currentKey === 'review') void handleSubmit()
    else goNext()
  }

  const handleSubmit = async () => {
    setSubmissionError(undefined)

    const found = validate()
    setErrors(found ?? NO_ERRORS)
    if (found) return

    const toApplicant = (values: ApplicantFormValues) => ({
      nationalId: values.nationalId,
      fullName: values.fullName,
      dob: values.dob,
      ...(values.phoneNumber.trim() ? { phoneNumber: values.phoneNumber } : {}),
    })

    const request: CreateApplicationRequest = {
      entryType,
      wilayaId: wilayaId as string,
      communeId: communeId as string,
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

  const stepLabels = stepKeys.map((key) => t(`register.steps.${key}`))

  return (
    <div>
      <PageHeader
        title={t('pages.register.title')}
        description={window_ ? t('register.subtitle', { year: window_.drawYear }) : undefined}
      />

      <div className="mb-8 max-w-5xl mx-auto">
        <StepIndicator steps={stepLabels.map((label) => ({ label }))} current={stepIndex + 1} />
      </div>

      <form className="flex max-w-5xl mx-auto flex-col gap-6" onSubmit={handleFormSubmit} noValidate>
        {submissionError && <Alert variant="error">{submissionError}</Alert>}

        {currentKey === 'entryType' && (
          <Card title={t('register.sections.entryType')}>
            <RadioGroup
              name="entryType"
              value={entryType}
              disabled={isSubmitting}
              onChange={(value) => setEntryType(value as EntryType)}
              options={[
                {
                  value: 'SINGLE',
                  label: t('register.entryType.SINGLE'),
                  description: t('register.entryType.descriptions.SINGLE'),
                },
                {
                  value: 'PAIRED',
                  label: t('register.entryType.PAIRED'),
                  description: t('register.entryType.descriptions.PAIRED'),
                },
              ]}
            />
            <p className="mt-3 text-sm text-stone-500">{t('register.entryType.hint')}</p>
          </Card>
        )}

        {currentKey === 'location' && (
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
        )}

        {currentKey === 'primary' && (
          <Card title={t('register.sections.primary')}>
            <ApplicantFields
              idPrefix="primary"
              values={primary}
              errors={errors.primary}
              disabled={isSubmitting}
              onChange={setPrimary}
            />
          </Card>
        )}

        {currentKey === 'secondary' && (
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

        {currentKey === 'review' && (
          <div className="flex flex-col gap-4">
            <ReviewSection title={t('register.sections.entryType')} onEdit={() => goToStep('entryType')}>
              <Field label={t('register.sections.entryType')}>{t(`register.entryType.${entryType}`)}</Field>
            </ReviewSection>

            <ReviewSection title={t('register.sections.place')} onEdit={() => goToStep('location')}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('geo.wilaya.label')}>
                  {selectedWilaya ? localizedGeoName(selectedWilaya, locale) : '—'}
                </Field>
                <Field label={t('geo.commune.label')}>
                  {selectedCommune ? localizedGeoName(selectedCommune, locale) : '—'}
                </Field>
              </div>
            </ReviewSection>

            <ReviewSection title={t('register.sections.primary')} onEdit={() => goToStep('primary')}>
              <ApplicantSummary values={primary} />
            </ReviewSection>

            {entryType === 'PAIRED' && (
              <ReviewSection title={t('register.sections.secondary')} onEdit={() => goToStep('secondary')}>
                <ApplicantSummary values={secondary} />
              </ReviewSection>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={goBack}
            disabled={stepIndex === 0 || isSubmitting}
          >
            {t('register.wizard.back')}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {currentKey === 'review'
              ? isSubmitting
                ? t('register.submitting')
                : t('register.submit')
              : t('register.wizard.next')}
          </Button>
        </div>
      </form>
    </div>
  )
}

function ReviewSection({
  title,
  onEdit,
  children,
}: {
  title: string
  onEdit: () => void
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  return (
    <Card
      title={title}
      actions={
        // Five sections, five otherwise-identical "Edit" buttons — the visible
        // label stays short, but the accessible name says which section so a
        // screen reader does not announce the same word five times running.
        <Button
          variant="ghost"
          onClick={onEdit}
          aria-label={t('register.review.editSection', { section: title })}
        >
          <PencilIcon aria-hidden="true" className="size-4" />
          {t('register.review.edit')}
        </Button>
      }
    >
      {children}
    </Card>
  )
}

function ApplicantSummary({ values }: { values: ApplicantFormValues }) {
  const { t } = useTranslation()
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      <Field label={t('register.fields.nationalId')}>{values.nationalId}</Field>
      <Field label={t('register.fields.fullName')}>{values.fullName}</Field>
      <Field label={t('register.fields.dob')}>{values.dob}</Field>
      <Field label={t('register.fields.phoneNumber')}>{values.phoneNumber || '—'}</Field>
    </dl>
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
