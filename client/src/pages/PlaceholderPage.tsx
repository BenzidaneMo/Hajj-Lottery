import { useTranslation } from 'react-i18next'

import { EmptyState } from '../components/ui'

export interface PlaceholderPageProps {
  titleKey: string
}

/** Temporary stand-in for pages whose business logic is not yet implemented. */
export function PlaceholderPage({ titleKey }: PlaceholderPageProps) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-stone-900">{t(titleKey)}</h1>
      <EmptyState title={t('common.comingSoon')} />
    </div>
  )
}
