import { useTranslation } from 'react-i18next'

/** Visually hidden until focused; lets keyboard users jump past repeated navigation. */
export function SkipLink() {
  const { t } = useTranslation()

  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary-700 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
    >
      {t('common.skipToContent')}
    </a>
  )
}
