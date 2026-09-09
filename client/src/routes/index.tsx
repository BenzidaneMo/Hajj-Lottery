import { createBrowserRouter } from 'react-router-dom'

import { AdminLayout } from '../components/layout/AdminLayout'
import { AppLayout } from '../components/layout/AppLayout'
import { RequireAuth } from '../components/RequireAuth'
import { About } from '../pages/About'
import { AdminAdmins } from '../pages/admin/AdminAdmins'
import { AdminApplications } from '../pages/admin/AdminApplications'
import { AdminApprovals } from '../pages/admin/AdminApprovals'
import { AdminAudit } from '../pages/admin/AdminAudit'
import { AdminCommunes } from '../pages/admin/AdminCommunes'
import { AdminDashboard } from '../pages/admin/AdminDashboard'
import { AdminDraws } from '../pages/admin/AdminDraws'
import { AdminHistory } from '../pages/admin/AdminHistory'
import { AdminImports } from '../pages/admin/AdminImports'
import { AdminLogin } from '../pages/admin/AdminLogin'
import { AdminParticipants } from '../pages/admin/AdminParticipants'
import { AdminSettings } from '../pages/admin/AdminSettings'
import { AdminWinners } from '../pages/admin/AdminWinners'
import { ApplicationStatus } from '../pages/ApplicationStatus'
import { Draw } from '../pages/Draw'
import { DrawWatch } from '../pages/DrawWatch'
import { Home } from '../pages/Home'
import { PublicResult } from '../pages/PublicResult'
import { Register } from '../pages/Register'
import { Winners } from '../pages/Winners'

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
          { path: 'communes', element: <AdminCommunes /> },
          { path: 'draws', element: <AdminDraws /> },
          { path: 'winners', element: <AdminWinners /> },
          { path: 'history', element: <AdminHistory /> },
          { path: 'imports', element: <AdminImports /> },
          { path: 'approvals', element: <AdminApprovals /> },
          { path: 'audit', element: <AdminAudit /> },
          { path: 'admins', element: <AdminAdmins /> },
          { path: 'settings', element: <AdminSettings /> },
        ],
      },
    ],
  },
])
