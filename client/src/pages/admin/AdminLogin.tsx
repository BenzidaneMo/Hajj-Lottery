import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'

import { LanguageSwitcher } from '../../components/LanguageSwitcher'
import { Logo } from '../../components/Logo'
import { Alert, Button, Card, Input } from '../../components/ui'
import { useAuth } from '../../lib/auth-context'

interface LocationState {
  from?: string
}

/** Standalone shell — deliberately outside AdminLayout, and outside RequireAuth. */
export function AdminLogin() {
  const { t } = useTranslation()
  const { status, signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; password?: string }>({})
  const [failed, setFailed] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const destination = (location.state as LocationState | null)?.from ?? '/admin'

  // Someone already signed in has no business on the login page.
  if (status === 'authenticated') return <Navigate to={destination} replace />

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const errors: { username?: string; password?: string } = {}
    if (!username.trim()) errors.username = t('admin.login.usernameRequired')
    if (!password) errors.password = t('admin.login.passwordRequired')
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    setFailed(false)
    setIsSubmitting(true)
    try {
      await signIn(username, password)
      navigate(destination, { replace: true })
    } catch {
      // Every failure reads the same to the user, mirroring the API: the
      // reason is deliberately not distinguishable.
      setFailed(true)
      setPassword('')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-stone-50">
      <div className="flex items-center justify-between px-4 py-4 sm:px-6">
        <Logo to="/" />
        <LanguageSwitcher />
      </div>
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <Card className="w-full max-w-sm" title={t('admin.login.title')}>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
            {failed && <Alert variant="error">{t('admin.login.failed')}</Alert>}

            <Input
              label={t('admin.login.username')}
              name="username"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              error={fieldErrors.username}
              disabled={isSubmitting}
              required
            />
            <Input
              label={t('admin.login.password')}
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              error={fieldErrors.password}
              disabled={isSubmitting}
              required
            />

            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('admin.login.submitting') : t('admin.login.submit')}
            </Button>
          </form>
        </Card>
      </main>
    </div>
  )
}
