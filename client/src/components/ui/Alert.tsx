import type { PropsWithChildren } from 'react'

export type AlertVariant = 'info' | 'success' | 'warning' | 'error'

const VARIANT_CLASSES: Record<AlertVariant, string> = {
  info: 'bg-sky-50 text-sky-800 border-sky-200',
  success: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  warning: 'bg-amber-50 text-amber-800 border-amber-200',
  error: 'bg-red-50 text-red-800 border-red-200',
}

export interface AlertProps extends PropsWithChildren {
  variant?: AlertVariant
  title?: string
}

export function Alert({ variant = 'info', title, children }: AlertProps) {
  return (
    <div role="alert" className={`rounded-md border px-4 py-3 text-sm ${VARIANT_CLASSES[variant]}`}>
      {title && <p className="font-medium">{title}</p>}
      <div>{children}</div>
    </div>
  )
}
