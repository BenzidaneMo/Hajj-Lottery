import { InboxIcon } from 'lucide-react'
import type { PropsWithChildren, ReactNode } from 'react'

export interface EmptyStateProps extends PropsWithChildren {
  title: string
  description?: string
  icon?: ReactNode
}

export function EmptyState({ title, description, icon, children }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-stone-300 bg-stone-50/50 px-6 py-12 text-center">
      {icon ?? <InboxIcon aria-hidden="true" className="size-8 text-stone-400" />}
      <p className="mt-1 text-base font-medium text-stone-800">{title}</p>
      {description && <p className="max-w-sm text-sm text-stone-500">{description}</p>}
      {children}
    </div>
  )
}
