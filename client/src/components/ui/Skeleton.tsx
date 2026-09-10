export interface SkeletonProps {
  className?: string
}

/** A single loading placeholder block. Compose multiple for skeleton layouts. */
export function Skeleton({ className = 'h-4 w-full' }: SkeletonProps) {
  return <div aria-hidden="true" className={`animate-pulse rounded-md bg-stone-200/80 ${className}`} />
}
