import { localizedGeoName } from '@hajj-lottery/shared'
import { useTranslation } from 'react-i18next'

import { useWilayas } from '../../lib/geo'
import { Select, type SelectOption } from '../ui'

export interface WilayaSelectProps {
  value: string | undefined
  onChange: (wilayaId: string | undefined) => void
  label?: string
  required?: boolean
}

/** Reusable wilaya picker backed by GET /api/wilayas. No hardcoded data. */
export function WilayaSelect({ value, onChange, label, required }: WilayaSelectProps) {
  const { t, i18n } = useTranslation()
  const { data: wilayas, isLoading, error } = useWilayas()
  const locale = i18n.language as 'ar' | 'fr' | 'en'

  const options: SelectOption[] = [
    { value: '', label: t('geo.wilaya.placeholder') },
    ...(wilayas ?? []).map((wilaya) => ({
      value: wilaya.id,
      label: localizedGeoName(wilaya, locale),
    })),
  ]

  return (
    <Select
      label={label ?? t('geo.wilaya.label')}
      options={options}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value || undefined)}
      disabled={isLoading}
      required={required}
      error={error ? t('geo.wilaya.loadError') : undefined}
    />
  )
}
