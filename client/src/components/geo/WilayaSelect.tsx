import { localizedGeoName } from '@hajj-lottery/shared'
import { useTranslation } from 'react-i18next'

import { Label } from '@/components/shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/shadcn/select'

import { useWilayas } from '../../lib/geo'

/**
 * Radix Select is controlled the instant `value` is anything but `undefined`,
 * so passing `undefined` for "nothing chosen yet" and a real id afterwards
 * would flip the component from uncontrolled to controlled mid-life. `''` is
 * the one value that keeps it controlled *and* keeps the placeholder showing
 * — Radix's own `Select.Value` renders its placeholder for `''` or
 * `undefined` and nothing else, so a made-up sentinel like `'none'` would
 * leave the trigger blank instead. No wilaya or commune ever has an empty
 * id, so this can never collide with a real choice.
 */
const UNSET = ''

export interface WilayaSelectProps {
  value: string | undefined
  onChange: (wilayaId: string | undefined) => void
  label?: string
  required?: boolean
  /** Restrict the list to the signed-in administrator's territory. */
  scoped?: boolean
  id?: string
}

/** Reusable wilaya picker backed by GET /api/wilayas. No hardcoded data. */
export function WilayaSelect({ value, onChange, label, required, scoped, id = 'wilaya' }: WilayaSelectProps) {
  const { t, i18n } = useTranslation()
  const { data: wilayas, isLoading, error } = useWilayas({ scoped })
  const locale = i18n.language as 'ar' | 'fr' | 'en'

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>
        {label ?? t('geo.wilaya.label')}
        {required && (
          <span aria-hidden="true" className="text-destructive">
            *
          </span>
        )}
      </Label>
      <Select
        value={value ?? UNSET}
        onValueChange={(next) => onChange(next === UNSET ? undefined : next)}
        disabled={isLoading || Boolean(error)}
        required={required}
      >
        <SelectTrigger id={id} className="w-full" aria-invalid={Boolean(error)}>
          <SelectValue
            placeholder={
              isLoading
                ? t('common.loading')
                : error
                  ? t('geo.wilaya.loadError')
                  : t('geo.wilaya.placeholder')
            }
          />
        </SelectTrigger>
        <SelectContent>
          {(wilayas ?? []).map((wilaya) => (
            <SelectItem key={wilaya.id} value={wilaya.id}>
              {wilaya.code} — {localizedGeoName(wilaya, locale)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {Boolean(error) && <p className="text-xs text-destructive">{t('geo.wilaya.loadError')}</p>}
    </div>
  )
}
