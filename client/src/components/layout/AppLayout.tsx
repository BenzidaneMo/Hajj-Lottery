import { Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet } from 'react-router-dom'

import { Loading } from '../ui'
import { Container } from './Container'
import { Footer } from './Footer'
import { Header } from './Header'
import { SkipLink } from './SkipLink'

export function AppLayout() {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-screen flex-col bg-stone-50">
      <SkipLink />
      <Header />
      <main id="main-content" className="flex-1 py-10">
        <Container>
          {/* Only `/register` is behind a lazy import today (see routes/index.tsx) — the
              other public pages resolve on the same tick, so this fallback exists for the
              one page that needs it rather than adding a visible flash to every navigation. */}
          <Suspense fallback={<Loading label={t('common.loading')} />}>
            <Outlet />
          </Suspense>
        </Container>
      </main>
      <Footer />
    </div>
  )
}
