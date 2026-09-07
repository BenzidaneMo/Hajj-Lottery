import { createBrowserRouter } from 'react-router-dom'

import { AppLayout } from '../components/layout/AppLayout'
import { About } from '../pages/About'
import { AdminDashboard } from '../pages/admin/AdminDashboard'
import { AdminLogin } from '../pages/admin/AdminLogin'
import { ApplicationStatus } from '../pages/ApplicationStatus'
import { Draw } from '../pages/Draw'
import { Home } from '../pages/Home'
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
      { path: 'draw', element: <Draw /> },
      { path: 'about', element: <About /> },
      { path: 'admin/login', element: <AdminLogin /> },
      { path: 'admin', element: <AdminDashboard /> },
    ],
  },
])
