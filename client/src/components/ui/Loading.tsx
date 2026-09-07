export interface LoadingProps {
  label?: string
}

export function Loading({ label }: LoadingProps) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 py-8 text-stone-500">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-stone-300 border-t-emerald-700" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  )
}
