import { localizedGeoName, type SupportedLocale } from '@hajj-lottery/shared'
import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/shadcn/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/shadcn/command'
import { Label } from '@/components/shadcn/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/shadcn/popover'
import { cn } from '@/lib/cn'
import { useCommunesByWilaya, useWilayas } from '@/lib/geo'

/**
 * Choosing a wilaya, and then a commune inside it.
 *
 * A searchable list rather than a `<select>`, because there are 1541 communes:
 * a native dropdown of that length is a scroll, not a choice. The commune list
 * is fetched per wilaya rather than all at once, so nothing loads 1541 rows to
 * let somebody pick one.
 *
 * Both lists come from the *scoped* geography endpoints, so a WILAYA_ADMIN is
 * offered their own wilaya and a COMMUNE_ADMIN their own commune. That is a
 * convenience, not a control: the server applies the same ceiling to whatever
 * is eventually submitted, so a hand-typed id from another territory is
 * refused there.
 */

export interface PlaceOption {
  id: string
  code: string
  nameAr: string
  nameFr: string
  nameEn: string
}

interface ComboboxProps {
  id: string
  label: string
  placeholder: string
  searchPlaceholder: string
  emptyMessage: string
  options: PlaceOption[]
  value: string | undefined
  disabled?: boolean
  onChange: (value: string | undefined) => void
  /** Label for the entry that clears the choice. */
  anyLabel: string
}

function PlaceCombobox({
  id,
  label,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  options,
  value,
  disabled,
  onChange,
  anyLabel,
}: ComboboxProps) {
  const { i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale
  const [open, setOpen] = useState(false)

  const selected = options.find((option) => option.id === value)

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Popover modal={false} open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="w-full justify-between font-normal"
          >
            <span className="truncate">
              {selected ? `${selected.code} — ${localizedGeoName(selected, locale)}` : placeholder}
            </span>
            <ChevronsUpDownIcon className="ms-2 size-4 shrink-0 opacity-50" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(24rem,90vw)] p-0" align="start">
          <Command>
            <CommandInput placeholder={searchPlaceholder} />
            <CommandList>
              <CommandEmpty>{emptyMessage}</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value={anyLabel}
                  onSelect={() => {
                    onChange(undefined)
                    setOpen(false)
                  }}
                >
                  <CheckIcon
                    className={cn('me-2 size-4', value === undefined ? 'opacity-100' : 'opacity-0')}
                    aria-hidden="true"
                  />
                  {anyLabel}
                </CommandItem>
                {options.map((option) => (
                  <CommandItem
                    key={option.id}
                    // cmdk filters on this string, so it must contain
                    // everything somebody might type: the code and the name in
                    // the language they are reading.
                    value={`${option.code} ${localizedGeoName(option, locale)}`}
                    onSelect={() => {
                      onChange(option.id)
                      setOpen(false)
                    }}
                  >
                    <CheckIcon
                      className={cn('me-2 size-4', value === option.id ? 'opacity-100' : 'opacity-0')}
                      aria-hidden="true"
                    />
                    {option.code} — {localizedGeoName(option, locale)}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}

export interface PlacePickerProps {
  wilayaId: string | undefined
  communeId: string | undefined
  onChange: (next: { wilayaId: string | undefined; communeId: string | undefined }) => void
  /** Hides the commune box where only a wilaya is meaningful. */
  communeDisabled?: boolean
}

export function PlacePicker({ wilayaId, communeId, onChange, communeDisabled }: PlacePickerProps) {
  const { t } = useTranslation()
  const wilayas = useWilayas({ scoped: true })
  const communes = useCommunesByWilaya(wilayaId, { scoped: true })

  return (
    <>
      <PlaceCombobox
        id="filter-wilaya"
        label={t('geo.wilaya.label')}
        placeholder={t('admin.filters.anyWilaya')}
        anyLabel={t('admin.filters.anyWilaya')}
        searchPlaceholder={t('admin.filters.searchWilaya')}
        emptyMessage={t('common.noResults')}
        options={wilayas.data ?? []}
        value={wilayaId}
        disabled={wilayas.isLoading}
        // Changing the wilaya clears the commune: a commune from the previous
        // one would be a filter for a place that is no longer selected.
        onChange={(next) => onChange({ wilayaId: next, communeId: undefined })}
      />
      {!communeDisabled && (
        <PlaceCombobox
          id="filter-commune"
          label={t('geo.commune.label')}
          placeholder={t('admin.filters.anyCommune')}
          anyLabel={t('admin.filters.anyCommune')}
          searchPlaceholder={t('admin.filters.searchCommune')}
          emptyMessage={wilayaId ? t('common.noResults') : t('admin.filters.selectWilayaFirst')}
          options={communes.data ?? []}
          value={communeId}
          disabled={!wilayaId || communes.isLoading}
          onChange={(next) => onChange({ wilayaId, communeId: next })}
        />
      )}
    </>
  )
}
