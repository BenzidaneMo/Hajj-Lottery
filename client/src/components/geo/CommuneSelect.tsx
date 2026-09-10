import { localizedGeoName } from '@hajj-lottery/shared'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { Label } from '@/components/shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/shadcn/select'

import { useCommunesByWilaya } from '../../lib/geo'

/** See `WilayaSelect.tsx` — `''` keeps the Select controlled and its placeholder visible. */
const UNSET = ''

export interface CommuneSelectProps {
  wilayaId: string | undefined
  value: string | undefined
  onChange: (communeId: string | undefined) => void
  label?: string
  required?: boolean
  /** Restrict the list to the signed-in administrator's territory. */
  scoped?: boolean
  id?: string
}

/**
 * Reusable commune picker backed by GET /api/wilayas/:id/communes.
 * Disabled until a wilaya is selected; resets its own selection whenever the
 * wilaya changes, so callers can't end up with a stale wilaya/commune pair.
 */
export function CommuneSelect({
  wilayaId,
  value,
  onChange,
  label,
  required,
  scoped,
  id = 'commune',
}: CommuneSelectProps) {
  const { t, i18n } = useTranslation()
  const { data: communes, isLoading, error } = useCommunesByWilaya(wilayaId, { scoped })
  const locale = i18n.language as 'ar' | 'fr' | 'en'

  const previousWilayaId = useRef(wilayaId)
  useEffect(() => {
    if (previousWilayaId.current !== wilayaId) {
      previousWilayaId.current = wilayaId
      onChange(undefined)
    }
  }, [wilayaId, onChange])

  const isEmpty = wilayaId !== undefined && !isLoading && !error && (communes ?? []).length === 0
  const placeholder = !wilayaId
    ? t('geo.commune.selectWilayaFirst')
    : isLoading
      ? t('common.loading')
      : error
        ? t('geo.commune.loadError')
        : isEmpty
          ? t('geo.commune.empty')
          : t('geo.commune.placeholder')

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>
        {label ?? t('geo.commune.label')}
        {required && (
          <span aria-hidden="true" className="text-destructive">
            *
          </span>
        )}
      </Label>
      <Select
        value={value ?? UNSET}
        onValueChange={(next) => onChange(next === UNSET ? undefined : next)}
        disabled={!wilayaId || isLoading || Boolean(error) || isEmpty}
        required={required}
      >
        <SelectTrigger id={id} className="w-full" aria-invalid={Boolean(error)}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {(communes ?? []).map((commune) => (
            <SelectItem key={commune.id} value={commune.id}>
              {commune.code} — {localizedGeoName(commune, locale)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {Boolean(error) && <p className="text-xs text-destructive">{t('geo.commune.loadError')}</p>}
      {isEmpty && <p className="text-xs text-muted-foreground">{t('geo.commune.empty')}</p>}
    </div>
  )
}
