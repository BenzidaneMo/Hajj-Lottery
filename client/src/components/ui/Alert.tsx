import { AlertCircleIcon, AlertTriangleIcon, CheckCircle2Icon, InfoIcon } from 'lucide-react'
import type { PropsWithChildren } from 'react'

export type AlertVariant = 'info' | 'success' | 'warning' | 'error'

const VARIANT_CLASSES: Record<AlertVariant, string> = {
  info: 'bg-sky-50 text-sky-800 border-sky-200',
  success: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  warning: 'bg-amber-50 text-amber-800 border-amber-200',
  error: 'bg-red-50 text-red-800 border-red-200',
}

const VARIANT_ICONS: Record<AlertVariant, typeof InfoIcon> = {
  info: InfoIcon,
  success: CheckCircle2Icon,
  warning: AlertTriangleIcon,
  error: AlertCircleIcon,
}

export interface AlertProps extends PropsWithChildren {
  variant?: AlertVariant
  title?: string
}

export function Alert({ variant = 'info', title, children }: AlertProps) {
  const Icon = VARIANT_ICONS[variant]

  return (
    <div role="alert" className={`rounded-lg border px-4 py-3 text-sm ${VARIANT_CLASSES[variant]}`}>
      <div className="flex gap-3">
        <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          {title && <p className="font-medium">{title}</p>}
          <div className={title ? 'mt-1' : ''}>{children}</div>
        </div>
      </div>
    </div>
  )
}
