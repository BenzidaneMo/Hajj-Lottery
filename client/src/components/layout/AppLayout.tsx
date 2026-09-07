import { Outlet } from 'react-router-dom'

import { Container } from './Container'
import { Footer } from './Footer'
import { Header } from './Header'

export function AppLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-stone-50">
      <Header />
      <main className="flex-1 py-10">
        <Container>
          <Outlet />
        </Container>
      </main>
      <Footer />
    </div>
  )
}
