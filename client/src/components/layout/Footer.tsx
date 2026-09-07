import { useTranslation } from 'react-i18next'

import { Container } from './Container'

export function Footer() {
  const { t } = useTranslation()
  const year = new Date().getFullYear()

  return (
    <footer className="border-t border-stone-200 bg-white">
      <Container>
        <p className="py-6 text-center text-sm text-stone-500">
          {t('app.name')} — © {year} {t('footer.rights')}
        </p>
      </Container>
    </footer>
  )
}
