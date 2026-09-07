import { Outlet } from 'react-router-dom'

import { Container } from './Container'
import { Footer } from './Footer'
import { Header } from './Header'
import { SkipLink } from './SkipLink'

export function AppLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-stone-50">
      <SkipLink />
      <Header />
      <main id="main-content" className="flex-1 py-10">
        <Container>
          <Outlet />
        </Container>
      </main>
      <Footer />
    </div>
  )
}
