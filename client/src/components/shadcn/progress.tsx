import * as React from 'react'
import { cn } from '@/lib/cn'
import { Progress as ProgressPrimitive } from 'radix-ui'

/**
 * shadcn's own indicator fills by translating a full-width bar left by
 * `100 - value`%. `translateX` is a physical transform — it does not mirror
 * under `dir="rtl"`, so that version fills left-to-right even in Arabic. A
 * plain `width` on a normal block box does not have that problem: block
 * layout places a narrower box at its container's *inline-start* edge, which
 * is the side `dir` already governs, so the bar grows from the right in RTL
 * and the left in LTR with no variant needed.
 */
function Progress({ className, value, ...props }: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  const filled = Math.min(100, Math.max(0, value ?? 0))

  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-primary/20', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="h-full bg-primary transition-all"
        style={{ width: `${filled}%` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
