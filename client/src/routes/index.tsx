import { lazy } from 'react'
import { createBrowserRouter } from 'react-router-dom'

import { AppLayout } from '../components/layout/AppLayout'
import { RequireAuth } from '../components/RequireAuth'
import { About } from '../pages/About'
import { AdminLogin } from '../pages/admin/AdminLogin'
import { ApplicationStatus } from '../pages/ApplicationStatus'
import { Draw } from '../pages/Draw'
import { DrawWatch } from '../pages/DrawWatch'
import { Home } from '../pages/Home'
import { PublicResult } from '../pages/PublicResult'
import { Winners } from '../pages/Winners'

/**
 * The administrative console, loaded only when somebody opens it.
 *
 * The console is by far the larger half of this application — Radix, cmdk and
 * an icon set — and the citizen pages need none of it. `/results/...` is the
 * highest-traffic address in the system, opened by a whole commune at once on
 * the day a draw is announced, often on a phone and often on a slow
 * connection; making it download an operations console it will never render
 * would be the most expensive mistake available here.
 *
 * `AdminLayout` is lazy too, so the shell and its pages land in one chunk that
 * an operator fetches once. `AdminLogin` stays eager: it is the way in, it is
 * small, and it must render without waiting on anything.
 */
const AdminLayout = lazy(() =>
  import('../components/layout/AdminLayout').then((module) => ({ default: module.AdminLayout })),
)
const AdminAdmins = lazy(() =>
  import('../pages/admin/AdminAdmins').then((module) => ({ default: module.AdminAdmins })),
)
const AdminApplicationDetail = lazy(() =>
  import('../pages/admin/AdminApplicationDetail').then((module) => ({
    default: module.AdminApplicationDetail,
  })),
)
const AdminApplications = lazy(() =>
  import('../pages/admin/AdminApplications').then((module) => ({ default: module.AdminApplications })),
)
const AdminApprovals = lazy(() =>
  import('../pages/admin/AdminApprovals').then((module) => ({ default: module.AdminApprovals })),
)
const AdminAudit = lazy(() =>
  import('../pages/admin/AdminAudit').then((module) => ({ default: module.AdminAudit })),
)
const AdminCommuneDraw = lazy(() =>
  import('../pages/admin/AdminCommuneDraw').then((module) => ({ default: module.AdminCommuneDraw })),
)
const AdminCommunes = lazy(() =>
  import('../pages/admin/AdminCommunes').then((module) => ({ default: module.AdminCommunes })),
)
const AdminDashboard = lazy(() =>
  import('../pages/admin/AdminDashboard').then((module) => ({ default: module.AdminDashboard })),
)
const AdminDraws = lazy(() =>
  import('../pages/admin/AdminDraws').then((module) => ({ default: module.AdminDraws })),
)
const AdminHistory = lazy(() =>
  import('../pages/admin/AdminHistory').then((module) => ({ default: module.AdminHistory })),
)
const AdminImportDetail = lazy(() =>
  import('../pages/admin/AdminImportDetail').then((module) => ({ default: module.AdminImportDetail })),
)
const AdminImports = lazy(() =>
  import('../pages/admin/AdminImports').then((module) => ({ default: module.AdminImports })),
)
const AdminNotFound = lazy(() =>
  import('../pages/admin/AdminNotFound').then((module) => ({ default: module.AdminNotFound })),
)
const AdminParticipants = lazy(() =>
  import('../pages/admin/AdminParticipants').then((module) => ({ default: module.AdminParticipants })),
)
const AdminSettings = lazy(() =>
  import('../pages/admin/AdminSettings').then((module) => ({ default: module.AdminSettings })),
)
const AdminWinners = lazy(() =>
  import('../pages/admin/AdminWinners').then((module) => ({ default: module.AdminWinners })),
)

/**
 * Registration is the one citizen page built on the same Radix Select the
 * console uses for its own pickers, and it is the only public page that
 * needs it. Every other public address — most of all `/results/...` — would
 * otherwise pay to download it on every visit for a control it never
 * renders, so it is the one public route split into its own chunk.
 */
const Register = lazy(() => import('../pages/Register').then((module) => ({ default: module.Register })))

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <Home /> },
      { path: 'register', element: <Register /> },
      { path: 'application-status', element: <ApplicationStatus /> },
      { path: 'winners', element: <Winners /> },
      // Official results, addressed by draw year and official geographic codes.
      // Shareable and cacheable by design — no database id, and nothing in the
      // address identifies a person. The commune code needs its wilaya because
      // commune codes are unique only within one.
      { path: 'results/:drawYear/:wilayaCode/:communeCode', element: <PublicResult /> },
      { path: 'draw', element: <Draw /> },
      // The visualiser for one commune. Read-only: it watches public draw
      // state, and there is no request it can make that runs a draw.
      { path: 'draw/:drawYear/:wilayaCode/:communeCode', element: <DrawWatch /> },
      { path: 'about', element: <About /> },
    ],
  },
  // Outside AdminLayout: there is no sidebar/session chrome until an admin is
  // signed in, and this route must stay reachable without a session.
  { path: '/admin/login', element: <AdminLogin /> },
  {
    path: '/admin',
    // UX guard only — every admin API is protected server-side regardless.
    element: <RequireAuth />,
    children: [
      {
        element: <AdminLayout />,
        children: [
          { index: true, element: <AdminDashboard /> },
          { path: 'participants', element: <AdminParticipants /> },
          { path: 'applications', element: <AdminApplications /> },
          { path: 'applications/:id', element: <AdminApplicationDetail /> },
          { path: 'communes', element: <AdminCommunes /> },
          // One commune's whole operational workflow: pool, execution,
          // result, and the reserve lifecycle.
          { path: 'communes/:id', element: <AdminCommuneDraw /> },
          { path: 'draws', element: <AdminDraws /> },
          { path: 'winners', element: <AdminWinners /> },
          { path: 'history', element: <AdminHistory /> },
          { path: 'imports', element: <AdminImports /> },
          { path: 'imports/:id', element: <AdminImportDetail /> },
          { path: 'approvals', element: <AdminApprovals /> },
          { path: 'audit', element: <AdminAudit /> },
          { path: 'admins', element: <AdminAdmins /> },
          { path: 'settings', element: <AdminSettings /> },
          // An address that matches no admin page. Reached by typing, not by
          // a link — a hidden section's real route still renders its page and
          // reports whatever the server says.
          { path: '*', element: <AdminNotFound /> },
        ],
      },
    ],
  },
])
