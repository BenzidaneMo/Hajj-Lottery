import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'

import { AdminSidebar } from './admin/AdminSidebar'
import { AdminTopbar } from './admin/AdminTopbar'
import { SkipLink } from './SkipLink'

export function AdminLayout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const location = useLocation()
  const [lastPathname, setLastPathname] = useState(location.pathname)

  // Close the mobile overlay on navigation. Adjusted during render (React's
  // documented pattern for resetting state on prop change) rather than in an
  // effect, to avoid an extra render pass.
  if (location.pathname !== lastPathname) {
    setLastPathname(location.pathname)
    setIsSidebarOpen(false)
  }

  useEffect(() => {
    if (!isSidebarOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsSidebarOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isSidebarOpen])

  return (
    <div className="flex min-h-screen bg-stone-50">
      <SkipLink />

      <div className="hidden md:block">
        <AdminSidebar />
      </div>

      {isSidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-black/40"
            onClick={() => setIsSidebarOpen(false)}
          />
          <div className="relative h-full">
            <AdminSidebar onNavigate={() => setIsSidebarOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <AdminTopbar onOpenSidebar={() => setIsSidebarOpen(true)} />
        <main id="main-content" className="flex-1 px-4 py-8 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
