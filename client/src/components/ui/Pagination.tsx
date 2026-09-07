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
        {t('common.previous')}
      </Button>
      <span className="text-sm text-stone-600">
        {t('common.pageOf', { current: page, total: totalPages })}
      </span>
      <Button variant="secondary" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
        {t('common.next')}
      </Button>
    </nav>
  )
}
