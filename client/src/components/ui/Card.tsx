import type { PropsWithChildren, ReactNode } from 'react'

export interface CardProps extends PropsWithChildren {
  title?: string
  description?: string
  actions?: ReactNode
  className?: string
}

export function Card({ title, description, actions, className = '', children }: CardProps) {
  return (
    <div className={`rounded-lg border border-stone-200 bg-white p-6 shadow-sm ${className}`}>
      {(title ?? actions) && (
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            {title && <h3 className="text-base font-semibold text-stone-900">{title}</h3>}
            {description && <p className="mt-1 text-sm text-stone-500">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </div>
  )
}
