import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet, useLocation } from 'react-router-dom'

import { Sheet, SheetContent, SheetTitle } from '@/components/shadcn/sheet'
import { Toaster } from '@/components/shadcn/sonner'

import { AdminSidebar } from './admin/AdminSidebar'
import { AdminTopbar } from './admin/AdminTopbar'
import { SkipLink } from './SkipLink'

/**
 * The administrative shell.
 *
 * On a desktop the rail is always present; below `md` it becomes a Sheet,
 * which brings focus trapping, Escape-to-close and an accessible title with
 * it — the hand-rolled overlay this replaced had to implement each of those
 * separately, and only had the first two.
 *
 * The Sheet is anchored to the inline start, so it slides from the left in
 * French and English and from the right in Arabic without a second variant.
 */
export function AdminLayout() {
  const { t } = useTranslation()
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const location = useLocation()
  const [lastPathname, setLastPathname] = useState(location.pathname)

  // Close the mobile sheet on navigation. Adjusted during render (React's
  // documented pattern for resetting state on prop change) rather than in an
  // effect, to avoid an extra render pass.
  if (location.pathname !== lastPathname) {
    setLastPathname(location.pathname)
    setIsSidebarOpen(false)
  }

  return (
    <div className="flex min-h-screen bg-muted/40">
      <SkipLink />

      <div className="hidden border-e border-border md:block">
        <AdminSidebar />
      </div>

      <Sheet open={isSidebarOpen} onOpenChange={setIsSidebarOpen}>
        <SheetContent side="start" className="w-72 p-0">
          <SheetTitle className="sr-only">{t('admin.nav.ariaLabel')}</SheetTitle>
          <AdminSidebar onNavigate={() => setIsSidebarOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <AdminTopbar onOpenSidebar={() => setIsSidebarOpen(true)} />
        <main id="main-content" className="min-w-0 flex-1 px-4 py-8 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>

      <Toaster position="top-center" />
    </div>
  )
}
