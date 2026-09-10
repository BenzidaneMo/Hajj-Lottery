import type { ReactNode } from 'react'

/**
 * The `<dt>`/`<dd>` pair every public detail panel renders a fact with.
 *
 * Pulled out of `ApplicationStatusPanel`, `ApplicationReceipt`, `PublicResult`
 * and `DrawStage`, which each defined the same two elements locally. Kept as a
 * `<dl>` term/definition pair rather than a generic row: it is what these
 * values are — a label and the fact it names — and screen readers announce the
 * relationship accordingly.
 */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm text-foreground">{children}</dd>
    </div>
  )
}

/** The larger, numeric-leaning variant used for a count or figure worth emphasising. */
export function StatTile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{children}</dd>
    </div>
  )
}
