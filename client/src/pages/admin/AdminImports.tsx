import {
  IMPORT_BATCH_STATUSES,
  MAX_IMPORT_FILE_BYTES,
  type ImportBatchDto,
  type ImportBatchStatus,
  type SupportedLocale,
} from '@hajj-lottery/shared'
import { UploadIcon } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { AdminPage } from '@/components/admin/AdminPage'
import { DataTable, type Column } from '@/components/admin/DataTable'
import { ErrorNotice } from '@/components/admin/ErrorNotice'
import { StatusBadge } from '@/components/admin/StatusBadge'
import { Alert, AlertDescription, AlertTitle } from '@/components/shadcn/alert'
import { Button } from '@/components/shadcn/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/shadcn/card'
import { Input } from '@/components/shadcn/input'
import { Label } from '@/components/shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/shadcn/select'
import { fetchImports, uploadImport } from '@/lib/admin-api'
import { formatDateTime, formatNumber } from '@/lib/format'
import { mapAsync, useAction, useAsync } from '@/lib/use-async'

/**
 * The legacy register import, from upload to completion.
 *
 * Staging is the whole design, and this screen reflects it: an upload writes
 * nothing authoritative. It parses a file into rows to be reviewed, and only a
 * national administrator who did not upload it can approve one, and only then
 * does anything reach the participation ledger.
 */
export function AdminImports() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale
  const [status, setStatus] = useState<ImportBatchStatus | undefined>(undefined)

  const load = useCallback(() => fetchImports(status), [status])
  const { state, reload } = useAsync(load)

  const columns: Column<ImportBatchDto>[] = [
    {
      key: 'filename',
      header: t('admin.imports.filename'),
      render: (row) => (
        <Link
          to={`/admin/imports/${row.id}`}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {row.sourceFilename}
        </Link>
      ),
    },
    { key: 'format', header: t('admin.imports.format'), render: (row) => row.sourceFormat },
    {
      key: 'rows',
      header: t('admin.imports.rows'),
      numeric: true,
      render: (row) => formatNumber(row.rowCount, locale),
    },
    {
      key: 'status',
      header: t('admin.imports.status'),
      render: (row) => <StatusBadge kind="importBatch" status={row.status} />,
    },
    {
      key: 'uploadedBy',
      header: t('admin.imports.uploadedBy'),
      render: (row) => row.uploadedBy.username,
    },
    {
      key: 'createdAt',
      header: t('admin.imports.uploadedAt'),
      render: (row) => formatDateTime(row.createdAt, locale),
    },
  ]

  return (
    <AdminPage title={t('admin.pages.imports.title')} description={t('admin.imports.description')}>
      <UploadCard onUploaded={reload} />

      <div className="grid gap-4 sm:max-w-sm">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="import-status">{t('admin.imports.status')}</Label>
          <Select
            value={status ?? '__any__'}
            onValueChange={(value) =>
              setStatus(value === '__any__' ? undefined : (value as ImportBatchStatus))
            }
          >
            <SelectTrigger id="import-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__any__">{t('admin.filters.anyStatus')}</SelectItem>
              {IMPORT_BATCH_STATUSES.map((option) => (
                <SelectItem key={option} value={option}>
                  {t(`admin.status.importBatch.${option}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <DataTable
        state={mapAsync(state, (result) => result.items)}
        columns={columns}
        getRowKey={(row) => row.id}
        label={t('admin.imports.tableLabel')}
        emptyMessage={t('admin.imports.empty')}
        onRetry={reload}
        rowActions={(row) => (
          <Button asChild variant="outline" size="sm">
            <Link to={`/admin/imports/${row.id}`}>{t('admin.imports.review')}</Link>
          </Button>
        )}
      />
    </AdminPage>
  )
}

/**
 * Staging a register file.
 *
 * The file never touches disk on the server and is decided by its magic bytes
 * rather than its name, so the accepted extensions here are a hint to the file
 * picker and nothing more — a renamed file is refused by the parser, not by
 * this attribute.
 */
function UploadCard({ onUploaded }: { onUploaded: () => void }) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | undefined>(undefined)
  const action = useAction(uploadImport)

  const tooLarge = file !== undefined && file.size > MAX_IMPORT_FILE_BYTES

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t('admin.imports.uploadTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Alert>
          <AlertTitle>{t('admin.imports.stagingTitle')}</AlertTitle>
          <AlertDescription>{t('admin.imports.stagingBody')}</AlertDescription>
        </Alert>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="import-file">{t('admin.imports.file')}</Label>
          <Input
            id="import-file"
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx"
            aria-describedby="import-file-hint"
            onChange={(event) => setFile(event.target.files?.[0])}
          />
          <p id="import-file-hint" className="text-xs text-muted-foreground">
            {t('admin.imports.fileHint', { megabytes: Math.round(MAX_IMPORT_FILE_BYTES / 1024 / 1024) })}
          </p>
        </div>

        {tooLarge && (
          <p role="alert" className="text-sm text-destructive">
            {t('admin.imports.tooLarge')}
          </p>
        )}

        {action.error !== undefined && <ErrorNotice error={action.error} />}

        <div>
          <Button
            type="button"
            disabled={!file || tooLarge || action.pending}
            onClick={async () => {
              if (!file) return
              if (await action.run(file)) {
                toast.success(t('admin.imports.uploaded'))
                setFile(undefined)
                if (inputRef.current) inputRef.current.value = ''
                onUploaded()
              }
            }}
          >
            <UploadIcon aria-hidden="true" />
            {action.pending ? t('admin.actions.working') : t('admin.imports.upload')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
