import {
  ADMIN_ROLES,
  localizedGeoName,
  type AdminRole,
  type AdminUserDto,
  type SupportedLocale,
} from '@hajj-lottery/shared'
import { PlusIcon } from 'lucide-react'
import { useCallback, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { AdminPage } from '@/components/admin/AdminPage'
import { DataTable, type Column } from '@/components/admin/DataTable'
import { ReasonDialog } from '@/components/admin/dialogs'
import { ErrorNotice } from '@/components/admin/ErrorNotice'
import { PlacePicker } from '@/components/admin/PlacePicker'
import { Alert, AlertDescription, AlertTitle } from '@/components/shadcn/alert'
import { Badge } from '@/components/shadcn/badge'
import { Button } from '@/components/shadcn/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/shadcn/dialog'
import { Input } from '@/components/shadcn/input'
import { Label } from '@/components/shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/shadcn/select'
import { changeAdminScope, createAdminAccount, deactivateAdminAccount, fetchAdmins } from '@/lib/admin-api'
import { useAuth } from '@/lib/auth-context'
import { formatDateTime } from '@/lib/format'
import { mapAsync, useAction, useAsync } from '@/lib/use-async'

/** The shortest password the server will accept. Mirrored, never decided here. */
const MIN_PASSWORD_LENGTH = 12

/**
 * Administrator accounts.
 *
 * Four rules hold, and all four are enforced in `AdminAccountService` rather
 * than by this screen: nobody edits their own role or scope, nobody grants
 * reach they do not hold themselves, a COMMUNE_ADMIN's commune must be inside
 * their wilaya, and the last active SUPER_ADMIN cannot be removed. What this
 * page does is make those refusals visible before somebody runs into them —
 * the account that cannot be disabled says so, and the form that would make an
 * illegal assignment does not offer it.
 *
 * There is no password reset and no deletion. Resetting somebody else's
 * credential is a different operation with safeguards that do not exist yet,
 * and an account is the actor on audit records that must outlive it —
 * deactivating revokes the sessions and leaves the trail intact.
 */
export function AdminAdmins() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale
  const { user } = useAuth()

  const load = useCallback(() => fetchAdmins(), [])
  const { state, reload } = useAsync(load)

  const [creating, setCreating] = useState(false)
  const [changing, setChanging] = useState<AdminUserDto | undefined>(undefined)
  const [deactivating, setDeactivating] = useState<AdminUserDto | undefined>(undefined)

  const admins = state.status === 'ready' ? state.data.items : []
  // Mirrors the service's own count so the reason a button is missing can be
  // stated. The service checks again, inside the operation.
  const activeSuperAdmins = admins.filter((admin) => admin.role === 'SUPER_ADMIN' && admin.isActive).length

  const columns: Column<AdminUserDto>[] = [
    {
      key: 'username',
      header: t('admin.admins.username'),
      render: (row) => <span className="font-medium">{row.username}</span>,
    },
    {
      key: 'role',
      header: t('admin.admins.role'),
      render: (row) => <Badge variant="outline">{t(`admin.roles.${row.role}`)}</Badge>,
    },
    {
      key: 'scope',
      header: t('admin.admins.scope'),
      render: (row) => {
        const place = row.commune ?? row.wilaya
        return place ? localizedGeoName(place, locale) : t('admin.profile.scope.national')
      },
    },
    {
      key: 'active',
      header: t('admin.admins.active'),
      render: (row) =>
        row.isActive ? (
          <Badge variant="success">{t('admin.admins.isActive')}</Badge>
        ) : (
          <Badge variant="secondary">{t('admin.admins.isInactive')}</Badge>
        ),
    },
    {
      key: 'lastLogin',
      header: t('admin.admins.lastLogin'),
      render: (row) => (row.lastLoginAt ? formatDateTime(row.lastLoginAt, locale) : '—'),
    },
    {
      key: 'createdAt',
      header: t('admin.admins.createdAt'),
      render: (row) => formatDateTime(row.createdAt, locale),
    },
  ]

  return (
    <AdminPage
      title={t('admin.pages.admins.title')}
      description={t('admin.admins.description')}
      action={
        <Button type="button" onClick={() => setCreating(true)}>
          <PlusIcon aria-hidden="true" />
          {t('admin.admins.create')}
        </Button>
      }
    >
      <Alert>
        <AlertTitle>{t('admin.admins.rulesTitle')}</AlertTitle>
        <AlertDescription>
          <ul className="list-disc space-y-1 ps-5">
            <li>{t('admin.admins.ruleSelf')}</li>
            <li>{t('admin.admins.ruleEscalation')}</li>
            <li>{t('admin.admins.ruleLastSuperAdmin')}</li>
            <li>{t('admin.admins.ruleNoReset')}</li>
          </ul>
        </AlertDescription>
      </Alert>

      <DataTable
        state={mapAsync(state, (result) => result.items)}
        columns={columns}
        getRowKey={(row) => row.id}
        label={t('admin.admins.tableLabel')}
        onRetry={reload}
        rowActions={(row) => {
          const isSelf = row.id === user?.id
          const isLastSuperAdmin = row.role === 'SUPER_ADMIN' && row.isActive && activeSuperAdmins <= 1

          if (isSelf) {
            return <span className="text-xs text-muted-foreground">{t('admin.admins.thisIsYou')}</span>
          }

          return (
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setChanging(row)}>
                {t('admin.admins.changeScope')}
              </Button>
              {row.isActive &&
                (isLastSuperAdmin ? (
                  <span className="text-xs text-muted-foreground">{t('admin.admins.lastSuperAdmin')}</span>
                ) : (
                  <Button type="button" variant="destructive" size="sm" onClick={() => setDeactivating(row)}>
                    {t('admin.admins.deactivate')}
                  </Button>
                ))}
            </div>
          )
        }}
      />

      <CreateAdminDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={() => {
          setCreating(false)
          reload()
        }}
      />

      {changing && (
        <ChangeScopeDialog
          admin={changing}
          onClose={() => setChanging(undefined)}
          onDone={() => {
            setChanging(undefined)
            reload()
          }}
        />
      )}

      {deactivating && (
        <DeactivateDialog
          admin={deactivating}
          onClose={() => setDeactivating(undefined)}
          onDone={() => {
            setDeactivating(undefined)
            reload()
          }}
        />
      )}
    </AdminPage>
  )
}

/**
 * The role and geography half of an account form.
 *
 * The controls follow the role rather than validating after the fact: a
 * SUPER_ADMIN is offered no place at all, a WILAYA_ADMIN a wilaya only, and a
 * COMMUNE_ADMIN a commune inside the wilaya they picked. The composite foreign
 * key in the database rejects a commune from a different wilaya outright, so
 * this arrangement is about not offering the mistake rather than catching it.
 */
function AssignmentFields({
  role,
  onRoleChange,
  place,
  onPlaceChange,
  idPrefix,
}: {
  role: AdminRole
  onRoleChange: (role: AdminRole) => void
  place: { wilayaId?: string; communeId?: string }
  onPlaceChange: (place: { wilayaId?: string; communeId?: string }) => void
  idPrefix: string
}) {
  const { t } = useTranslation()

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-role`}>{t('admin.admins.role')}</Label>
        <Select
          value={role}
          onValueChange={(value) => {
            // A place that the new role may not hold is dropped rather than
            // sent and refused.
            onRoleChange(value as AdminRole)
            onPlaceChange({})
          }}
        >
          <SelectTrigger id={`${idPrefix}-role`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ADMIN_ROLES.map((option) => (
              <SelectItem key={option} value={option}>
                {t(`admin.roles.${option}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {role === 'SUPER_ADMIN' ? (
        <p className="text-sm text-muted-foreground">{t('admin.admins.nationalHint')}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <PlacePicker
            wilayaId={place.wilayaId}
            communeId={place.communeId}
            communeDisabled={role === 'WILAYA_ADMIN'}
            onChange={onPlaceChange}
          />
        </div>
      )}
    </>
  )
}

function CreateAdminDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const { t } = useTranslation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<AdminRole>('COMMUNE_ADMIN')
  const [place, setPlace] = useState<{ wilayaId?: string; communeId?: string }>({})
  const action = useAction(createAdminAccount)

  const placeComplete =
    role === 'SUPER_ADMIN'
      ? true
      : role === 'WILAYA_ADMIN'
        ? place.wilayaId !== undefined
        : place.wilayaId !== undefined && place.communeId !== undefined

  const ready = username.trim().length >= 3 && password.length >= MIN_PASSWORD_LENGTH && placeComplete

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!ready) return
    const created = await action.run({
      username: username.trim(),
      password,
      role,
      wilayaId: role === 'SUPER_ADMIN' ? null : (place.wilayaId ?? null),
      communeId: role === 'COMMUNE_ADMIN' ? (place.communeId ?? null) : null,
    })
    if (created) {
      toast.success(t('admin.admins.created'))
      setUsername('')
      setPassword('')
      setPlace({})
      onCreated()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('admin.admins.create')}</DialogTitle>
            <DialogDescription>{t('admin.admins.createBody')}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-admin-username">{t('admin.admins.username')}</Label>
            <Input
              id="new-admin-username"
              value={username}
              required
              minLength={3}
              autoComplete="off"
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-admin-password">{t('admin.admins.password')}</Label>
            {/* `new-password` so a browser does not offer the operator's own
                credentials for somebody else's account. */}
            <Input
              id="new-admin-password"
              type="password"
              value={password}
              required
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
              aria-describedby="new-admin-password-hint"
              onChange={(event) => setPassword(event.target.value)}
            />
            <p id="new-admin-password-hint" className="text-xs text-muted-foreground">
              {t('admin.admins.passwordHint', { length: MIN_PASSWORD_LENGTH })}
            </p>
          </div>

          <AssignmentFields
            idPrefix="new-admin"
            role={role}
            onRoleChange={setRole}
            place={place}
            onPlaceChange={setPlace}
          />

          {action.error !== undefined && <ErrorNotice error={action.error} />}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('admin.actions.cancel')}
            </Button>
            <Button type="submit" disabled={action.pending || !ready}>
              {action.pending ? t('admin.actions.working') : t('admin.admins.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ChangeScopeDialog({
  admin,
  onClose,
  onDone,
}: {
  admin: AdminUserDto
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useTranslation()
  const [role, setRole] = useState<AdminRole>(admin.role)
  const [place, setPlace] = useState<{ wilayaId?: string; communeId?: string }>({
    wilayaId: admin.wilaya?.id,
    communeId: admin.commune?.id,
  })
  const action = useAction(changeAdminScope)

  const placeComplete =
    role === 'SUPER_ADMIN'
      ? true
      : role === 'WILAYA_ADMIN'
        ? place.wilayaId !== undefined
        : place.wilayaId !== undefined && place.communeId !== undefined

  return (
    <ReasonDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('admin.admins.changeScopeTitle')}
      description={t('admin.admins.changeScopeBody')}
      facts={[
        { label: t('admin.admins.username'), value: admin.username },
        { label: t('admin.admins.currentRole'), value: t(`admin.roles.${admin.role}`) },
      ]}
      reasonLabel={t('admin.admins.reason')}
      submitLabel={t('admin.admins.changeScope')}
      pending={action.pending}
      error={action.error}
      disabled={!placeComplete}
      onSubmit={async (reason) => {
        const done = await action.run(admin.id, {
          role,
          wilayaId: role === 'SUPER_ADMIN' ? null : (place.wilayaId ?? null),
          communeId: role === 'COMMUNE_ADMIN' ? (place.communeId ?? null) : null,
          reason,
        })
        if (done) {
          toast.success(t('admin.admins.scopeChanged'))
          onDone()
        }
      }}
    >
      <AssignmentFields
        idPrefix="change-scope"
        role={role}
        onRoleChange={setRole}
        place={place}
        onPlaceChange={setPlace}
      />
    </ReasonDialog>
  )
}

function DeactivateDialog({
  admin,
  onClose,
  onDone,
}: {
  admin: AdminUserDto
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useTranslation()
  const action = useAction(deactivateAdminAccount)

  return (
    <ReasonDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('admin.admins.deactivateTitle')}
      description={t('admin.admins.deactivateBody')}
      facts={[
        { label: t('admin.admins.username'), value: admin.username },
        { label: t('admin.admins.role'), value: t(`admin.roles.${admin.role}`) },
      ]}
      reasonLabel={t('admin.admins.reason')}
      submitLabel={t('admin.admins.deactivate')}
      destructive
      pending={action.pending}
      error={action.error}
      onSubmit={async (reason) => {
        if (await action.run(admin.id, reason)) {
          toast.success(t('admin.admins.deactivated'))
          onDone()
        }
      }}
    >
      <Alert variant="destructive">
        <AlertTitle>{t('admin.admins.deactivateWarningTitle')}</AlertTitle>
        {/* Their sessions go too — an account disabled only for future
            sign-ins is not disabled. */}
        <AlertDescription>{t('admin.admins.deactivateWarningBody')}</AlertDescription>
      </Alert>
    </ReasonDialog>
  )
}
