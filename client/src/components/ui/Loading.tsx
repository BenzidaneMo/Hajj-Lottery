import { Loader2Icon } from 'lucide-react'

export interface LoadingProps {
  label?: string
}

export function Loading({ label }: LoadingProps) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 py-8 text-stone-500">
      <Loader2Icon aria-hidden="true" className="size-5 animate-spin text-primary" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  )
}
