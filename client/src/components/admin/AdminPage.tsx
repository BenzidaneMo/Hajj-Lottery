import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/shadcn/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/shadcn/card'
import { Pagination, PaginationContent, PaginationItem } from '@/components/shadcn/pagination'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/shadcn/select'
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
  /**
   * All three together add a page-size selector and a "Showing X–Y of Z"
   * summary. Omitted, this renders exactly as it always has (a single admin
   * screen — the audit log — still calls it that way).
   */
  pageSize?: number
  onPageSizeChange?: (pageSize: number) => void
  total?: number
  pageSizeOptions?: readonly number[]
}

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50] as const

/**
 * Previous/next paging over a bounded server page, with an optional page-size
 * selector and result-count summary.
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
 *
 * The size selector and summary render even when everything fits on one page
 * — an operator switching to a larger page size needs the control to still be
 * there, and "Showing 1–5 of 5" is still a real, useful sentence. Only the
 * Previous/Next control itself hides when there is nothing to page through.
 */
export function TablePager({
  page,
  totalPages,
  onPageChange,
  pageSize,
  onPageSizeChange,
  total,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
}: TablePagerProps) {
  const { t } = useTranslation()
  const showSizeControls = pageSize !== undefined && onPageSizeChange !== undefined && total !== undefined

  if (totalPages <= 1 && !showSizeControls) return null

  const from = showSizeControls && total > 0 ? (page - 1) * pageSize + 1 : 0
  const to = showSizeControls ? Math.min(page * pageSize, total) : 0

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {showSizeControls && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span aria-live="polite">{t('common.showingRange', { from, to, total })}</span>
          <div className="flex items-center gap-2">
            <span>{t('common.pageSize')}</span>
            <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))}>
              <SelectTrigger aria-label={t('common.pageSize')} className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {totalPages > 1 && (
        <Pagination className="mx-0 w-auto">
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
      )}
    </div>
  )
}
