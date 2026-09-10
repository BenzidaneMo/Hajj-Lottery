import type { PropsWithChildren, ReactNode } from 'react'

export interface CardProps extends PropsWithChildren {
  title?: string
  description?: string
  actions?: ReactNode
  className?: string
}

export function Card({ title, description, actions, className = '', children }: CardProps) {
  return (
    <div
      className={`rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm ${className}`}
    >
      {(title ?? actions) && (
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            {title && <h3 className="text-base font-semibold tracking-tight text-foreground">{title}</h3>}
            {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </div>
  )
}
