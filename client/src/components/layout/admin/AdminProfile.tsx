import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { UserIcon } from '../../icons'

/** Placeholder profile area only — no authentication/session state yet. */
export function AdminProfile() {
  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-3 border-s border-stone-200 ps-4">
      <span
        aria-hidden="true"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-stone-100 text-stone-500"
      >
        <UserIcon className="h-5 w-5" />
      </span>
      <div className="hidden text-start sm:block">
        <p className="text-sm font-medium text-stone-900">{t('admin.profile.role')}</p>
        <Link
          to="/admin/login"
          className="text-xs text-stone-500 hover:text-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-700"
        >
          {t('admin.profile.signOut')}
        </Link>
      </div>
    </div>
  )
}
