import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/shadcn/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/shadcn/card'
import { Pagination, PaginationContent, PaginationItem } from '@/components/shadcn/pagination'
import { Skeleton } from '@/components/shadcn/skeleton'

export interface AdminPageProps {
  title: string
  description?: string
  /** Primary action for the page — a create button, usually. */
  action?: ReactNode
  children: ReactNode
}

/** The heading block every administrative screen opens with. */
export function AdminPage({ title, description, action, children }: AdminPageProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          {description && <p className="mt-1 max-w-prose text-sm text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

export interface MetricProps {
  label: string
  value: ReactNode
  /** One line saying what the number is for. Never decoration. */
  hint?: string
  loading?: boolean
}

/** A single operational number. */
export function Metric({ label, value, hint, loading }: MetricProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <p className="text-3xl font-semibold tabular-nums text-foreground">{value}</p>
        )}
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  )
}

export interface TablePagerProps {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
}

/**
 * Previous/next paging over a bounded server page.
 *
 * shadcn's `Pagination` supplies the landmark and list structure; the controls
 * inside it are buttons rather than its `PaginationLink` anchors, because these
 * pages are held in component state and there is no address to link to. An
 * `<a href="#">` that runs a callback announces itself as a link, moves focus
 * to the top of the document if the handler ever fails, and offers a
 * meaningless target to "open in new tab".
 *
 * No numbered list of every page: `totalPages` can be large, and rendering all
 * of them would be a wide strip nobody uses. The position is stated in words
 * instead, in a live region, so a screen reader hears the page change.
 */
export function TablePager({ page, totalPages, onPageChange }: TablePagerProps) {
  const { t } = useTranslation()
  if (totalPages <= 1) return null

  return (
    <Pagination>
      <PaginationContent>
        <PaginationItem>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeftIcon className="size-4 rtl:rotate-180" aria-hidden="true" />
            {t('common.previous')}
          </Button>
        </PaginationItem>
        <PaginationItem>
          <span aria-live="polite" className="px-3 text-sm text-muted-foreground">
            {t('common.pageOf', { current: page, total: totalPages })}
          </span>
        </PaginationItem>
        <PaginationItem>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            {t('common.next')}
            <ChevronRightIcon className="size-4 rtl:rotate-180" aria-hidden="true" />
          </Button>
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  )
}
