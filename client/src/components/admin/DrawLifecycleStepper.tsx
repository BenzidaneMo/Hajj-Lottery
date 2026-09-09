import type { CommuneDrawStatus } from '@hajj-lottery/shared'
import { CheckIcon, CircleDotIcon, CircleIcon, XIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription, AlertTitle } from '@/components/shadcn/alert'
import { cn } from '@/lib/cn'

/**
 * Where one commune's draw has got to.
 *
 * Every step is a state the server actually holds, in the order the lifecycle
 * moves through them. There is no "validating" or "in progress" step: pool
 * validation writes nothing and leaves the draw exactly where it was, and
 * execution is a single transaction with no observable middle — inventing a
 * step for either would show an operator a position the system cannot be in.
 *
 * A step is marked complete only from what the server reported. `PUBLISHED` is
 * the existence of a publication record, not a guess from the draw being
 * finished; a result can sit concluded and unannounced for as long as the
 * decision takes.
 */

const ORDER: readonly CommuneDrawStatus[] = ['DRAFT', 'READY', 'LOCKED', 'COMPLETED']

export interface DrawLifecycleStepperProps {
  status: CommuneDrawStatus
  /** True only when the server has reported a publication for this result. */
  published: boolean
}

type StepState = 'done' | 'current' | 'upcoming'

export function DrawLifecycleStepper({ status, published }: DrawLifecycleStepperProps) {
  const { t } = useTranslation()

  if (status === 'CANCELLED') {
    return (
      <Alert variant="destructive">
        <XIcon aria-hidden="true" />
        <AlertTitle>{t('admin.lifecycle.cancelledTitle')}</AlertTitle>
        <AlertDescription>{t('admin.lifecycle.cancelledBody')}</AlertDescription>
      </Alert>
    )
  }

  const reached = ORDER.indexOf(status)

  const steps: { key: string; state: StepState }[] = ORDER.map((step, index) => ({
    key: step,
    state: index < reached ? 'done' : index === reached ? 'current' : 'upcoming',
  }))

  steps.push({
    key: 'PUBLISHED',
    state: published ? 'done' : status === 'COMPLETED' ? 'current' : 'upcoming',
  })

  // A concluded draw is complete, not merely "current", once it is published.
  if (published) {
    const completed = steps.find((step) => step.key === 'COMPLETED')
    if (completed) completed.state = 'done'
  }

  return (
    <ol
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-start sm:gap-0"
      aria-label={t('admin.lifecycle.label')}
    >
      {steps.map((step, index) => (
        <li key={step.key} className="flex flex-1 items-start gap-3 sm:flex-col sm:gap-2">
          <div className="flex items-center gap-2 sm:w-full">
            <span
              aria-hidden="true"
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full border',
                step.state === 'done' && 'border-primary bg-primary text-primary-foreground',
                step.state === 'current' && 'border-primary text-primary',
                step.state === 'upcoming' && 'border-border text-muted-foreground',
              )}
            >
              {step.state === 'done' ? (
                <CheckIcon className="size-4" />
              ) : step.state === 'current' ? (
                <CircleDotIcon className="size-4" />
              ) : (
                <CircleIcon className="size-3" />
              )}
            </span>
            {index < steps.length - 1 && (
              <span
                aria-hidden="true"
                className={cn(
                  'hidden h-px flex-1 sm:block',
                  step.state === 'done' ? 'bg-primary' : 'bg-border',
                )}
              />
            )}
          </div>
          <div className="min-w-0">
            <p
              className={cn(
                'text-sm font-medium',
                step.state === 'upcoming' ? 'text-muted-foreground' : 'text-foreground',
              )}
            >
              {t(`admin.lifecycle.steps.${step.key}`)}
            </p>
            {/* The state is a word, not only a ring colour. */}
            <p className="text-xs text-muted-foreground">{t(`admin.lifecycle.state.${step.state}`)}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}
