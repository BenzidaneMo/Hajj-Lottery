import { useTranslation } from 'react-i18next'

import { EmptyState, PageHeader } from '../components/ui'

export interface PlaceholderPageProps {
  titleKey: string
}

/** Temporary stand-in for pages whose business logic is not yet implemented. */
export function PlaceholderPage({ titleKey }: PlaceholderPageProps) {
  const { t } = useTranslation()

  return (
    <div>
      <PageHeader title={t(titleKey)} />
      <EmptyState title={t('common.comingSoon')} />
    </div>
  )
}
