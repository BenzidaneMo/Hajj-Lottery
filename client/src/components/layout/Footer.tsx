import { MailIcon, MapPinIcon, PhoneIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../shadcn/dialog'
import { PUBLIC_NAV_ITEMS } from '../../config/nav'
import { CONTACT, OFFICIAL_LINKS } from '../../config/site'
import { LanguageSwitcher } from '../LanguageSwitcher'
import { Logo } from '../Logo'
import { SocialLinks } from '../SocialLinks'
import { Container } from './Container'

const footerLinkClassName =
  'text-sm text-primary-100/80 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white'

/**
 * Four columns on a wide screen, stacked on a narrow one: what this is, where
 * to go on this site, useful external government resources, and how to reach
 * the project directly — plus a sub-footer with copyright and two legal
 * placeholders. The site-navigation column only rejoins from `md` up; below
 * that, `MobileNavSheet` already covers it. Entirely separate from the
 * administrative console — nothing here links to `/admin` or `/admin/login`,
 * and `PUBLIC_NAV_ITEMS` is the same list `Header` renders, so the two can
 * never drift apart.
 *
 * The official-links column names real Algerian government sites as a
 * courtesy to a citizen already here, not as a claim of affiliation —
 * `footer.officialLinksHint` says so explicitly, since the platform makes no
 * such claim anywhere else either.
 */
export function Footer() {
  const { t } = useTranslation()
  const year = new Date().getFullYear()

  return (
    <footer className="border-t border-primary-900/60 bg-primary-800 text-primary-100">
      <Container>
        <div className="grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-3">
            <Logo variant="dark" />
            <p className="max-w-xs text-sm text-primary-100/80">{t('footer.description')}</p>
            <SocialLinks variant="dark" className="mt-1" />
          </div>

          {/*
            Hidden below `md`, the same breakpoint where Header swaps its own
            desktop nav for MobileNavSheet — a citizen on a small screen
            already has this exact route list one tap away, behind the
            hamburger the sticky header keeps in reach while scrolling.
            Repeating it here would just be a second, redundant way to
            reach the same six links.
          */}
          <nav aria-label={t('footer.navHeading')} className="hidden flex-col gap-3 md:flex">
            <h2 className="text-sm font-semibold text-white">{t('footer.navHeading')}</h2>
            <ul className="flex flex-col gap-2">
              {PUBLIC_NAV_ITEMS.map((item) => (
                <li key={item.to}>
                  <Link to={item.to} className={footerLinkClassName}>
                    {t(item.key)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label={t('footer.officialLinksHeading')} className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-white">{t('footer.officialLinksHeading')}</h2>
            <ul className="flex flex-col gap-2">
              {OFFICIAL_LINKS.map((link) => (
                <li key={link.id}>
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={footerLinkClassName}
                  >
                    {t(`footer.officialLinks.${link.id}`)}
                  </a>
                </li>
              ))}
            </ul>
            <p className="max-w-xs text-xs text-primary-100/60">{t('footer.officialLinksHint')}</p>
          </nav>

          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-white">{t('footer.contactHeading')}</h2>
            <ul className="flex flex-col gap-2">
              <li className="flex items-center gap-2">
                <MailIcon aria-hidden="true" className="size-4 shrink-0 text-primary-100/70" />
                <a
                  href={`mailto:${CONTACT.email}`}
                  aria-label={t('social.email')}
                  className={footerLinkClassName}
                >
                  {CONTACT.email}
                </a>
              </li>
              <li className="flex items-center gap-2">
                <PhoneIcon aria-hidden="true" className="size-4 shrink-0 text-primary-100/70" />
                <a
                  href={CONTACT.phoneHref}
                  aria-label={t('social.phone')}
                  className={footerLinkClassName}
                  dir="ltr"
                >
                  {CONTACT.phoneDisplay}
                </a>
              </li>
              <li className="flex items-center gap-2">
                <MapPinIcon aria-hidden="true" className="size-4 shrink-0 text-primary-100/70" />
                <span className="text-sm text-primary-100/80">{t('footer.location')}</span>
              </li>
            </ul>
            <div className="mt-1">
              <LanguageSwitcher variant="dark" />
            </div>
          </div>
        </div>

        <div className="flex flex-col items-center gap-3 border-t border-primary-900/60 py-6 text-sm text-primary-100/70 sm:flex-row sm:justify-between">
          <p>
            {t('app.name')} — © {year} {t('footer.rights')}
          </p>
          <div className="flex items-center gap-4">
            <LegalPlaceholder label={t('footer.privacyPolicy')} />
            <LegalPlaceholder label={t('footer.termsOfService')} />
          </div>
        </div>
      </Container>
    </footer>
  )
}

/**
 * Neither policy exists yet — each opens the same placeholder dialog rather
 * than a link to nowhere or a fabricated page of legal text.
 */
function LegalPlaceholder({ label }: { label: string }) {
  const { t } = useTranslation()

  return (
    <Dialog>
      <DialogTrigger
        type="button"
        className="text-sm text-primary-100/70 underline-offset-2 transition-colors hover:text-white hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        {label}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>{t('footer.placeholderNotice')}</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  )
}
