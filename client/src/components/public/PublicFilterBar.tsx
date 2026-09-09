import { useTranslation } from 'react-i18next'

import { PlaceCodeFilters } from '../geo'
import { Button, Input } from '../ui'
import { DRAW_YEAR_MAX, DRAW_YEAR_MIN, EMPTY_FILTERS, type PublicFilterValues } from './filters'

/**
 * Year, wilaya and commune, for both public listings.
 *
 * Geography comes from the shared reference API in official codes — see
 * `PlaceCodeFilters`. The year is a bounded number field rather than a picker
 * because there is no public endpoint saying which draw years exist, and a
 * select built from whatever happened to be on the current page would quietly
 * present an incomplete list as a complete one.
 */
export interface PublicFilterBarProps {
  value: PublicFilterValues
  onChange: (value: PublicFilterValues) => void
  disabled?: boolean
}

export function PublicFilterBar({ value, onChange, disabled }: PublicFilterBarProps) {
  const { t } = useTranslation()
  const hasFilters = Boolean(value.drawYear || value.wilayaCode || value.communeCode)

  return (
    <section aria-labelledby="public-filters-heading" className="mb-6">
      <h2 id="public-filters-heading" className="sr-only">
        {t('public.filters.heading')}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          label={t('public.results.drawYear')}
          type="number"
          inputMode="numeric"
          min={DRAW_YEAR_MIN}
          max={DRAW_YEAR_MAX}
          value={value.drawYear}
          disabled={disabled}
          placeholder={t('public.filters.allYears')}
          onChange={(event) => onChange({ ...value, drawYear: event.target.value })}
        />
        <PlaceCodeFilters
          value={value}
          disabled={disabled}
          onChange={(codes) => onChange({ ...value, ...codes })}
        />
        <div className="flex items-end">
          <Button
            variant="secondary"
            disabled={disabled || !hasFilters}
            onClick={() => onChange(EMPTY_FILTERS)}
          >
            {t('public.filters.clear')}
          </Button>
        </div>
      </div>
    </section>
  )
}
