import type { PropsWithChildren, ReactNode } from 'react'

export interface EmptyStateProps extends PropsWithChildren {
  title: string
  description?: string
  icon?: ReactNode
}

export function EmptyState({ title, description, icon, children }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-stone-300 px-6 py-12 text-center">
      {icon}
      <p className="text-base font-medium text-stone-800">{title}</p>
      {description && <p className="text-sm text-stone-500">{description}</p>}
      {children}
    </div>
  )
}
