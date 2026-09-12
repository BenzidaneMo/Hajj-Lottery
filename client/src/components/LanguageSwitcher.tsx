import { SUPPORTED_LOCALES, type SupportedLocale } from '@hajj-lottery/shared'
import { GlobeIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { setLocale } from '../i18n'
import { Button } from './shadcn/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from './shadcn/dropdown-menu'

const LOCALE_LABELS: Record<SupportedLocale, string> = {
  ar: 'العربية',
  fr: 'Français',
  en: 'English',
}

export interface LanguageSwitcherProps {
  /** The footer's dark band needs light text, same reasoning as `Logo`/`SocialLinks`. */
  variant?: 'light' | 'dark'
}

export function LanguageSwitcher({ variant = 'light' }: LanguageSwitcherProps) {
  const { t, i18n } = useTranslation()
  const current = i18n.language as SupportedLocale

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t('language.label')}
          className={
            variant === 'dark'
              ? 'gap-1.5 text-primary-100 hover:bg-primary-900/60 hover:text-white focus-visible:ring-primary-100/50'
              : 'gap-1.5'
          }
        >
          <GlobeIcon aria-hidden="true" className="size-4" />
          {LOCALE_LABELS[current]}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={current} onValueChange={(next) => setLocale(next as SupportedLocale)}>
          {SUPPORTED_LOCALES.map((locale) => (
            <DropdownMenuRadioItem key={locale} value={locale}>
              {LOCALE_LABELS[locale]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
