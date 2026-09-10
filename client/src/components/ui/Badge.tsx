import type { PropsWithChildren } from 'react'

export type BadgeVariant = 'neutral' | 'info' | 'success' | 'warning' | 'error'

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  neutral: 'bg-stone-100 text-stone-700 ring-1 ring-inset ring-stone-200',
  /** The same sky as `Alert`'s info, so one state reads the same either way. */
  info: 'bg-sky-100 text-sky-800 ring-1 ring-inset ring-sky-200',
  success: 'bg-emerald-100 text-emerald-800 ring-1 ring-inset ring-emerald-200',
  warning: 'bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-200',
  error: 'bg-red-100 text-red-800 ring-1 ring-inset ring-red-200',
}

export interface BadgeProps extends PropsWithChildren {
  variant?: BadgeVariant
}

export function Badge({ variant = 'neutral', children }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${VARIANT_CLASSES[variant]}`}
    >
      {children}
    </span>
  )
}
