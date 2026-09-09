import type { PropsWithChildren } from 'react'

export type BadgeVariant = 'neutral' | 'info' | 'success' | 'warning' | 'error'

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  neutral: 'bg-stone-100 text-stone-700',
  /** The same sky as `Alert`'s info, so one state reads the same either way. */
  info: 'bg-sky-100 text-sky-800',
  success: 'bg-emerald-100 text-emerald-800',
  warning: 'bg-amber-100 text-amber-800',
  error: 'bg-red-100 text-red-800',
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
