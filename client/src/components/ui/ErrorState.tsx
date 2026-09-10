import { AlertTriangleIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from './Button'

export interface ErrorStateProps {
  title: string
  description?: string
  retryLabel?: string
  onRetry?: () => void
  icon?: ReactNode
}

export function ErrorState({ title, description, retryLabel, onRetry, icon }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 rounded-xl border border-red-200 bg-red-50 px-6 py-12 text-center"
    >
      {icon ?? <AlertTriangleIcon aria-hidden="true" className="size-8 text-red-500" />}
      <p className="text-base font-medium text-red-800">{title}</p>
      {description && <p className="max-w-sm text-sm text-red-700">{description}</p>}
      {onRetry && retryLabel && (
        <Button variant="secondary" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  )
}
