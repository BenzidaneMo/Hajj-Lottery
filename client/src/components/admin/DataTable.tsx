import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/shadcn/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/shadcn/table'
import type { AsyncState } from '@/lib/use-async'

import { ErrorNotice } from './ErrorNotice'

export interface Column<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
  /** Right-aligned in LTR, left in RTL. For counts, never for identifiers. */
  numeric?: boolean
}

export interface DataTableProps<T> {
  state: AsyncState<T[]>
  columns: Column<T>[]
  getRowKey: (row: T) => string
  /** Names the table for assistive technology; required, since pages have several. */
  label: string
  emptyMessage?: string
  onRetry?: () => void
  /** Rendered after the last cell of each row — row actions, usually. */
  rowActions?: (row: T) => ReactNode
}

/**
 * One table, with the four states every list on this console can be in.
 *
 * Loading is a skeleton with the real headings already in place, so the layout
 * does not jump and an operator can read what is coming. Empty says so in
 * words rather than showing an empty frame. An error offers a retry rather
 * than a blank screen.
 *
 * The horizontal scroll lives on the wrapper, never on the page: a wide table
 * scrolls inside its own box, which is what stops a single long reference from
 * making the whole console slide sideways.
 */
export function DataTable<T>({
  state,
  columns,
  getRowKey,
  label,
  emptyMessage,
  onRetry,
  rowActions,
}: DataTableProps<T>) {
  const { t } = useTranslation()

  if (state.status === 'error') return <ErrorNotice error={state.error} onRetry={onRetry} />

  const rows = state.status === 'ready' ? state.data : []

  return (
    <div className="w-full overflow-x-auto rounded-lg border border-border">
      <Table aria-label={label}>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column.key} className={column.numeric ? 'text-end' : undefined}>
                {column.header}
              </TableHead>
            ))}
            {rowActions && (
              <TableHead className="text-end">
                <span className="sr-only">{t('admin.table.actions')}</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {state.status === 'loading' &&
            [0, 1, 2, 3, 4].map((index) => (
              <TableRow key={index}>
                {columns.map((column) => (
                  <TableCell key={column.key}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                ))}
                {rowActions && (
                  <TableCell>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                )}
              </TableRow>
            ))}

          {state.status === 'ready' && rows.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={columns.length + (rowActions ? 1 : 0)}
                className="py-10 text-center text-muted-foreground"
              >
                {emptyMessage ?? t('common.noResults')}
              </TableCell>
            </TableRow>
          )}

          {state.status === 'ready' &&
            rows.map((row) => (
              <TableRow key={getRowKey(row)}>
                {columns.map((column) => (
                  <TableCell key={column.key} className={column.numeric ? 'text-end' : undefined}>
                    {column.render(row)}
                  </TableCell>
                ))}
                {rowActions && <TableCell className="text-end">{rowActions(row)}</TableCell>}
              </TableRow>
            ))}
        </TableBody>
      </Table>
      {state.status === 'loading' && <span className="sr-only">{t('common.loading')}</span>}
    </div>
  )
}
