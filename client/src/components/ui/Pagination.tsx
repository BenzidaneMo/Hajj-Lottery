import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from './Button'

export interface PaginationProps {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
}

export function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  const { t } = useTranslation()

  return (
    <nav aria-label={t('common.pagination')} className="flex items-center justify-between gap-4">
      <Button variant="secondary" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        <ChevronLeftIcon aria-hidden="true" className="size-4 rtl:rotate-180" />
        {t('common.previous')}
      </Button>
      <span className="text-sm text-stone-600" aria-live="polite">
        {t('common.pageOf', { current: page, total: totalPages })}
      </span>
      <Button variant="secondary" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
        {t('common.next')}
        <ChevronRightIcon aria-hidden="true" className="size-4 rtl:rotate-180" />
      </Button>
    </nav>
  )
}
