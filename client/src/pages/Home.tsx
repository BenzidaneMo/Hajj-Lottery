import { useTranslation } from 'react-i18next'

export function Home() {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold text-stone-900">{t('home.title')}</h1>
      <p className="text-stone-600">{t('home.subtitle')}</p>
    </div>
  )
}
