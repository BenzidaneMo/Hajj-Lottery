import type { PropsWithChildren, ReactNode } from 'react'

export interface PageSectionProps extends PropsWithChildren {
  id?: string
  eyebrow?: string
  title?: string
  description?: string
  actions?: ReactNode
  className?: string
}

/**
 * A titled block of content, spaced consistently.
 *
 * The landing page and the result/draw pages each grouped a heading, a hint
 * paragraph and a body under slightly different ad-hoc markup; this is the one
 * version, used everywhere a page needs a labelled section rather than a
 * `Card` (which implies a bordered surface — a section is just rhythm).
 */
export function PageSection({
  id,
  eyebrow,
  title,
  description,
  actions,
  className = '',
  children,
}: PageSectionProps) {
  const headingId = title && id ? `${id}-heading` : undefined

  return (
    <section id={id} aria-labelledby={headingId} className={`flex flex-col gap-4 ${className}`}>
      {(title ?? actions) && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            {eyebrow && (
              <p className="mb-1 text-xs font-semibold tracking-wide text-primary uppercase">{eyebrow}</p>
            )}
            {title && (
              <h2 id={headingId} className="text-xl font-semibold tracking-tight text-foreground">
                {title}
              </h2>
            )}
            {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}
