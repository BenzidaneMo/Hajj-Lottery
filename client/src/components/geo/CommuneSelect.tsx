import { localizedGeoName } from '@hajj-lottery/shared'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { useCommunesByWilaya } from '../../lib/geo'
import { Select, type SelectOption } from '../ui'

export interface CommuneSelectProps {
  wilayaId: string | undefined
  value: string | undefined
  onChange: (communeId: string | undefined) => void
  label?: string
  required?: boolean
}

/**
 * Reusable commune picker backed by GET /api/wilayas/:id/communes.
 * Disabled until a wilaya is selected; resets its own selection whenever the
 * wilaya changes, so callers can't end up with a stale wilaya/commune pair.
 */
export function CommuneSelect({ wilayaId, value, onChange, label, required }: CommuneSelectProps) {
  const { t, i18n } = useTranslation()
  const { data: communes, isLoading, error } = useCommunesByWilaya(wilayaId)
  const locale = i18n.language as 'ar' | 'fr' | 'en'

  const previousWilayaId = useRef(wilayaId)
  useEffect(() => {
    if (previousWilayaId.current !== wilayaId) {
      previousWilayaId.current = wilayaId
      onChange(undefined)
    }
  }, [wilayaId, onChange])

  const placeholder = wilayaId ? t('geo.commune.placeholder') : t('geo.commune.selectWilayaFirst')
  const options: SelectOption[] = [
    { value: '', label: placeholder },
    ...(communes ?? []).map((commune) => ({
      value: commune.id,
      label: localizedGeoName(commune, locale),
    })),
  ]

  return (
    <Select
      label={label ?? t('geo.commune.label')}
      options={options}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value || undefined)}
      disabled={!wilayaId || isLoading}
      required={required}
      error={error ? t('geo.commune.loadError') : undefined}
    />
  )
}
