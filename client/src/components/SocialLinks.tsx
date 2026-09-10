import { useTranslation } from 'react-i18next'

import { SOCIAL_LINKS } from '../config/site'

export type SocialLinksVariant = 'circle' | 'inline' | 'dark'

export interface SocialLinksProps {
  variant?: SocialLinksVariant
  className?: string
}

const VARIANT_LINK_CLASSES: Record<SocialLinksVariant, string> = {
  circle:
    'flex size-9 items-center justify-center rounded-full bg-stone-100 text-stone-600 transition-colors hover:bg-primary-100 hover:text-primary-800',
  inline: 'text-stone-500 transition-colors hover:text-primary-800',
  /** For the footer's dark-green band — `circle`'s stone tones read as a muddy smudge there. */
  dark: 'flex size-9 items-center justify-center rounded-full bg-white/10 text-primary-50 transition-colors hover:bg-white/20 hover:text-white',
}

/**
 * The developer's public profiles, rendered from `config/site.ts` — the one
 * place their URLs live, so About and Footer can never disagree about one.
 *
 * Each link opens in a new tab (`target="_blank"`) with `rel="noopener
 * noreferrer"`, since a same-origin `opener` reference or a leaked `Referer`
 * to an external site is worth closing off even for a plain profile link.
 */
export function SocialLinks({ variant = 'circle', className = '' }: SocialLinksProps) {
  const { t } = useTranslation()

  return (
    <ul className={`flex items-center gap-2 ${className}`}>
      {SOCIAL_LINKS.map(({ id, href, Icon }) => (
        <li key={id}>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t(`social.${id}`)}
            title={t(`social.${id}`)}
            className={`inline-flex focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-700 ${VARIANT_LINK_CLASSES[variant]}`}
          >
            <Icon aria-hidden="true" className="size-4" />
          </a>
        </li>
      ))}
    </ul>
  )
}
