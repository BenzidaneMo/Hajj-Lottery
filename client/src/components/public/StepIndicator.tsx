import { CheckIcon } from 'lucide-react'

import { Progress } from '@/components/shadcn/progress'

export interface Step {
  label: string
}

export interface StepIndicatorProps {
  steps: Step[]
  /** 1-based — the step currently shown. */
  current: number
}

/**
 * Where a citizen is in a multi-part form, and nothing more.
 *
 * Purely presentational: it renders whichever step number the page tells it
 * to and has no state, no validation and no opinion about whether a step may
 * be entered. The wizard around it is the same one-shot `POST /api/applications`
 * as before — this only draws the picture of the five sections travelling
 * toward it.
 */
export function StepIndicator({ steps, current }: StepIndicatorProps) {
  const percent = steps.length > 1 ? ((current - 1) / (steps.length - 1)) * 100 : 100

  return (
    <div className="flex flex-col gap-3">
      <ol className="hidden items-start justify-between gap-2 sm:flex">
        {steps.map((step, index) => {
          const number = index + 1
          const state = number < current ? 'done' : number === current ? 'current' : 'upcoming'
          return (
            <li key={step.label} className="flex flex-1 flex-col items-center gap-1.5 text-center">
              <span
                aria-hidden="true"
                className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  state === 'done'
                    ? 'bg-primary text-primary-foreground'
                    : state === 'current'
                      ? 'border-2 border-primary text-primary'
                      : 'border border-stone-300 text-stone-400'
                }`}
              >
                {state === 'done' ? <CheckIcon className="size-3.5" /> : number}
              </span>
              <span
                className={`text-xs font-medium ${state === 'upcoming' ? 'text-stone-400' : 'text-stone-700'}`}
              >
                {step.label}
              </span>
            </li>
          )
        })}
      </ol>

      <div className="flex items-center gap-3 sm:hidden">
        <span className="shrink-0 text-xs font-semibold text-primary">
          {current}/{steps.length}
        </span>
        <span className="truncate text-xs font-medium text-stone-700">{steps[current - 1]?.label}</span>
      </div>

      <Progress
        value={percent}
        aria-label={steps[current - 1]?.label}
        aria-valuetext={`${current}/${steps.length}`}
      />
    </div>
  )
}
