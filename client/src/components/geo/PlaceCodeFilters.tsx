import { localizedGeoName, type SupportedLocale } from '@hajj-lottery/shared'
import { useTranslation } from 'react-i18next'

import { useCommunesByWilaya, useWilayas } from '../../lib/geo'
import { Select, type SelectOption } from '../ui'

/**
 * Wilaya and commune pickers that speak in official codes.
 *
 * The admin pickers next door select by database id, which is what the admin
 * API takes. Every public endpoint takes a *code* — a public URL and a public
 * payload name a place the way a citizen does, and no internal id appears in
 * either. So the public filters are a separate pair rather than a flag on the
 * existing ones: the value they hand back is the value that goes into the query
 * string and, on the results pages, into the address bar.
 *
 * They still read the same `/api/wilayas` reference data as everything else.
 * There is no commune list in this bundle and there must not be one — 1541
 * communes in three languages is not something to ship twice and let drift.
 */

/** Codes are unique only within a wilaya, so a commune is only ever half an address. */
export interface PlaceCodes {
  wilayaCode: string | undefined
  communeCode: string | undefined
}

export interface PlaceCodeFiltersProps {
  value: PlaceCodes
  onChange: (value: PlaceCodes) => void
  disabled?: boolean
}

export function PlaceCodeFilters({ value, onChange, disabled }: PlaceCodeFiltersProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale

  const { data: wilayas, isLoading: wilayasLoading, error: wilayasError } = useWilayas()

  // The commune endpoint is addressed by id, so the selected code is resolved
  // against the wilaya list already in hand. One request, not two: the list is
  // needed for the wilaya picker regardless.
  const wilaya = wilayas?.find((candidate) => candidate.code === value.wilayaCode)
  const { data: communes, isLoading: communesLoading, error: communesError } = useCommunesByWilaya(wilaya?.id)

  const wilayaOptions: SelectOption[] = [
    { value: '', label: t('public.filters.allWilayas') },
    ...(wilayas ?? []).map((entry) => ({ value: entry.code, label: localizedGeoName(entry, locale) })),
  ]

  const communeOptions: SelectOption[] = [
    {
      value: '',
      label: value.wilayaCode ? t('public.filters.allCommunes') : t('geo.commune.selectWilayaFirst'),
    },
    ...(communes ?? []).map((entry) => ({ value: entry.code, label: localizedGeoName(entry, locale) })),
  ]

  return (
    <>
      <Select
        label={t('geo.wilaya.label')}
        options={wilayaOptions}
        value={value.wilayaCode ?? ''}
        disabled={disabled || wilayasLoading}
        error={wilayasError ? t('geo.wilaya.loadError') : undefined}
        // Changing wilaya clears the commune in the same update rather than in
        // an effect afterwards, so no render ever holds a commune code from one
        // wilaya beside another wilaya's code — which would silently filter to
        // nothing and look like "no results here".
        onChange={(event) =>
          onChange({ wilayaCode: event.target.value || undefined, communeCode: undefined })
        }
      />
      <Select
        label={t('geo.commune.label')}
        options={communeOptions}
        value={value.communeCode ?? ''}
        disabled={disabled || !value.wilayaCode || communesLoading}
        error={communesError ? t('geo.commune.loadError') : undefined}
        onChange={(event) =>
          onChange({ wilayaCode: value.wilayaCode, communeCode: event.target.value || undefined })
        }
      />
    </>
  )
}
