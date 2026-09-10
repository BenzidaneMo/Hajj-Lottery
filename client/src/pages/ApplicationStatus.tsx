import type { PublicApplicationStatusDto } from '@hajj-lottery/shared'
import { SearchIcon, ShieldCheckIcon } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { ApplicationStatusPanel } from '../components/public/ApplicationStatusPanel'
import { classifyPublicError } from '../components/public/publicError'
import { Alert, Button, Card, Input, PageHeader } from '../components/ui'
import { useNoIndex } from '../lib/document'
import { lookupApplicationStatus } from '../lib/public'

/**
 * Checking one's own application, without an account.
 *
 * This page is the citizen half of an endpoint built to refuse being an oracle,
 * and it has to not undo that. The server answers an unknown reference, a wrong
 * mobile number, a malformed reference and an application whose applicant never
 * gave a number with the same 404, byte for byte. So this page renders one
 * message for all of them, and there is no branch anywhere below that inspects
 * the error further. A more helpful screen — "that reference exists, check the
 * number" — would reintroduce through the UI exactly the distinction the API
 * spent its design refusing to make.
 *
 * The form posts. Neither value ever enters the URL, the browser history or a
 * bookmark, and nothing is written to `localStorage`: this creates no session,
 * remembers no reference, and leaves nothing behind on a shared machine.
 */

type LookupState =
  | { kind: 'initial' }
  | { kind: 'submitting' }
  | { kind: 'found'; status: PublicApplicationStatusDto }
  | { kind: 'failed'; messageKey: string }

const IDLE: LookupState = { kind: 'initial' }

export function ApplicationStatus() {
  const { t } = useTranslation()

  // A lookup form is not a landing page. There is nothing at this URL for a
  // crawler — both values are posted — but it should not be a search result
  // either, and no reference ever appears in an address to be indexed.
  useNoIndex()

  const [reference, setReference] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ reference?: string; phoneNumber?: string }>({})
  const [state, setState] = useState<LookupState>(IDLE)

  const isSubmitting = state.kind === 'submitting'

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    // Emptiness only. Anything more — a reference shape, a phone pattern —
    // would tell somebody probing this form which strings are worth sending,
    // and the server deliberately does not validate either value beyond its
    // length for the same reason.
    const errors: { reference?: string; phoneNumber?: string } = {}
    if (!reference.trim()) errors.reference = t('public.lookup.errors.referenceRequired')
    if (!phoneNumber.trim()) errors.phoneNumber = t('public.lookup.errors.phoneRequired')
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    setState({ kind: 'submitting' })
    try {
      const status = await lookupApplicationStatus({
        applicationReference: reference,
        phoneNumber,
      })
      setState({ kind: 'found', status })
    } catch (error) {
      setState({ kind: 'failed', messageKey: failureKey(error) })
    }
  }

  return (
    <div>
      <PageHeader title={t('public.lookup.title')} description={t('public.lookup.intro')} />

      {/*
        `aria-live` on a region that exists from the first render, so a screen
        reader announces the outcome when it arrives rather than announcing that
        a region appeared. `polite`: the citizen asked for this, they are not
        being interrupted.
      */}
      <div aria-live="polite" aria-atomic="false">
        {state.kind === 'failed' && (
          <div className="mb-6 max-w-2xl">
            <Alert variant="error">{t(state.messageKey)}</Alert>
          </div>
        )}

        {state.kind === 'found' && (
          <div className="mb-6 max-w-2xl">
            <ApplicationStatusPanel status={state.status} />
          </div>
        )}
      </div>

      {state.kind === 'found' ? (
        <div className="print:hidden">
          <Button
            variant="secondary"
            onClick={() => {
              // Clearing the fields as well as the result: the next person at
              // this machine should find the form as they would have found it.
              setReference('')
              setPhoneNumber('')
              setState(IDLE)
            }}
          >
            {t('public.lookup.checkAnother')}
          </Button>
        </div>
      ) : (
        <Card className="max-w-5xl mx-auto">
          <form className="flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
            <Input
              label={t('public.lookup.reference')}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              error={fieldErrors.reference}
              hint={t('public.lookup.referenceHint')}
              disabled={isSubmitting}
              autoComplete="off"
              spellCheck={false}
              className="font-mono uppercase"
            />

            <Input
              label={t('public.lookup.phoneNumber')}
              value={phoneNumber}
              onChange={(event) => setPhoneNumber(event.target.value)}
              error={fieldErrors.phoneNumber}
              hint={t('public.lookup.phoneHint')}
              disabled={isSubmitting}
              type="tel"
              inputMode="tel"
              autoComplete="off"
            />

            <div>
              <Button type="submit" disabled={isSubmitting}>
                <SearchIcon aria-hidden="true" className="size-4" />
                {isSubmitting ? t('public.lookup.submitting') : t('public.lookup.submit')}
              </Button>
            </div>

            <p className="flex items-start gap-2 text-xs text-stone-500">
              <ShieldCheckIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              {t('public.lookup.privacyNote')}
            </p>
          </form>
        </Card>
      )}
    </div>
  )
}

/**
 * One translation key per class of failure, and one key for every way the
 * lookup itself can miss.
 *
 * `notFound` and `validation` deliberately share a message. The server treats a
 * malformed reference as just another wrong one — refusing it distinctly would
 * tell a caller which shapes are worth trying — and saying "check what you
 * typed" covers both without the page having to know which happened.
 */
function failureKey(error: unknown): string {
  switch (classifyPublicError(error)) {
    case 'rateLimited':
      // Says nothing about who used the budget or whether the reference was
      // real: on a per-reference limiter, a valid and an invented reference
      // accumulate failures identically, and the message must not distinguish
      // them. It also does not invite an immediate retry.
      return 'public.lookup.errors.tooMany'
    case 'network':
      return 'public.errors.network'
    case 'server':
      return 'public.errors.server'
    default:
      return 'public.lookup.errors.notFound'
  }
}
