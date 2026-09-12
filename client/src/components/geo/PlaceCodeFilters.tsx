import { localizedGeoName, type SupportedLocale } from '@hajj-lottery/shared'
import { useTranslation } from 'react-i18next'

import { Label } from '../shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../shadcn/select'
import { useCommunesByWilaya, useWilayas } from '../../lib/geo'

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

/**
 * Radix forbids an empty-string `SelectItem` value (it's reserved to mean
 * "nothing chosen"), but "all wilayas"/"all communes" here is a real,
 * selectable choice, not an unset state — so it needs its own sentinel,
 * translated back to `undefined` at the boundary.
 */
const ALL_WILAYAS = '__all_wilayas__'
const ALL_COMMUNES = '__all_communes__'

export function PlaceCodeFilters({ value, onChange, disabled }: PlaceCodeFiltersProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale

  const { data: wilayas, isLoading: wilayasLoading, error: wilayasError } = useWilayas()

  // The commune endpoint is addressed by id, so the selected code is resolved
  // against the wilaya list already in hand. One request, not two: the list is
  // needed for the wilaya picker regardless.
  const wilaya = wilayas?.find((candidate) => candidate.code === value.wilayaCode)
  const { data: communes, isLoading: communesLoading, error: communesError } = useCommunesByWilaya(wilaya?.id)

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="place-filter-wilaya">{t('geo.wilaya.label')}</Label>
        <Select
          value={value.wilayaCode ?? ALL_WILAYAS}
          disabled={disabled || wilayasLoading}
          // Changing wilaya clears the commune in the same update rather than in
          // an effect afterwards, so no render ever holds a commune code from one
          // wilaya beside another wilaya's code — which would silently filter to
          // nothing and look like "no results here".
          onValueChange={(next) =>
            onChange({ wilayaCode: next === ALL_WILAYAS ? undefined : next, communeCode: undefined })
          }
        >
          <SelectTrigger
            id="place-filter-wilaya"
            // Matches the neighbouring `Input` (draw year) box exactly — see
            // the same comment in `ApplicantFields`.
            className="w-full data-[size=default]:h-auto"
            aria-invalid={Boolean(wilayasError)}
          >
            <SelectValue
              placeholder={wilayasLoading ? t('common.loading') : t('public.filters.allWilayas')}
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_WILAYAS}>{t('public.filters.allWilayas')}</SelectItem>
            {(wilayas ?? []).map((entry) => (
              <SelectItem key={entry.code} value={entry.code}>
                {localizedGeoName(entry, locale)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {Boolean(wilayasError) && <p className="text-xs text-destructive">{t('geo.wilaya.loadError')}</p>}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="place-filter-commune">{t('geo.commune.label')}</Label>
        <Select
          value={value.communeCode ?? ALL_COMMUNES}
          disabled={disabled || !value.wilayaCode || communesLoading}
          onValueChange={(next) =>
            onChange({ wilayaCode: value.wilayaCode, communeCode: next === ALL_COMMUNES ? undefined : next })
          }
        >
          <SelectTrigger
            id="place-filter-commune"
            className="w-full data-[size=default]:h-auto"
            aria-invalid={Boolean(communesError)}
          >
            <SelectValue
              placeholder={
                communesLoading
                  ? t('common.loading')
                  : value.wilayaCode
                    ? t('public.filters.allCommunes')
                    : t('geo.commune.selectWilayaFirst')
              }
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_COMMUNES}>
              {value.wilayaCode ? t('public.filters.allCommunes') : t('geo.commune.selectWilayaFirst')}
            </SelectItem>
            {(communes ?? []).map((entry) => (
              <SelectItem key={entry.code} value={entry.code}>
                {localizedGeoName(entry, locale)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {Boolean(communesError) && <p className="text-xs text-destructive">{t('geo.commune.loadError')}</p>}
      </div>
    </>
  )
}
