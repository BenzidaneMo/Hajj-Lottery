import { Link } from 'react-router-dom'

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/shadcn/breadcrumb'

export interface BreadcrumbStep {
  label: string
  /** Omitted on the final, current step — it renders as plain text instead of a link. */
  to?: string
}

/** The trail above a detail page's heading: Home, a listing, the one page open. */
export function PublicBreadcrumb({ steps }: { steps: BreadcrumbStep[] }) {
  return (
    <Breadcrumb className="mb-4 print:hidden">
      <BreadcrumbList>
        {steps.map((step, index) => (
          <span key={`${step.label}-${index}`} className="flex items-center gap-1.5 sm:gap-2.5">
            <BreadcrumbItem>
              {step.to ? (
                <BreadcrumbLink asChild>
                  <Link to={step.to}>{step.label}</Link>
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage>{step.label}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
            {index < steps.length - 1 && <BreadcrumbSeparator />}
          </span>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
