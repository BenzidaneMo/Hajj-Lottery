import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { UserIcon } from '../../icons'
import { useAuth } from '../../../lib/auth-context'

export function AdminProfile() {
  const { t } = useTranslation()
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [isSigningOut, setIsSigningOut] = useState(false)

  const handleSignOut = async () => {
    setIsSigningOut(true)
    try {
      await signOut()
      navigate('/admin/login', { replace: true })
    } finally {
      setIsSigningOut(false)
    }
  }

  return (
    <div className="flex items-center gap-3 border-s border-stone-200 ps-4">
      <span
        aria-hidden="true"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-stone-100 text-stone-500"
      >
        <UserIcon className="h-5 w-5" />
      </span>
      <div className="hidden text-start sm:block">
        <p className="text-sm font-medium text-stone-900">{user?.username ?? t('admin.profile.role')}</p>
        <button
          type="button"
          onClick={handleSignOut}
          disabled={isSigningOut}
          className="text-xs text-stone-500 hover:text-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-700 disabled:opacity-50"
        >
          {isSigningOut ? t('admin.profile.signingOut') : t('admin.profile.signOut')}
        </button>
      </div>
    </div>
  )
}
