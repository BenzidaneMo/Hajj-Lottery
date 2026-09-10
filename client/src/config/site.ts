import { GlobeIcon } from 'lucide-react'
import type { ComponentType } from 'react'

import { FacebookGlyph, GitHubGlyph, LinkedInGlyph, XGlyph } from '../components/icons/brands'

/**
 * Static identity facts that both the About page and the Footer need — kept
 * here once so neither carries its own copy. Only non-language-dependent
 * values live here (a URL, an icon, a phone number); every piece of visible
 * wording — including an institution's name, which does have a per-language
 * form — stays in the i18n locale files, per project convention.
 */

export const DEVELOPER = {
  name: 'Mohamed Benzidane',
  handle: 'BenzidaneMo',
} as const

export interface SocialLink {
  id: 'github' | 'linkedin' | 'x' | 'facebook' | 'portfolio'
  href: string
  /**
   * `ComponentType<{ className?: string }>` rather than the hand-drawn set's
   * own `BrandIconProps` so a plain lucide icon (portfolio is a generic globe
   * glyph, not a trademarked platform mark) can sit in the same array as the
   * hand-drawn brand glyphs below without a wrapper.
   */
  Icon: ComponentType<{ className?: string }>
}

/**
 * Instagram previously appeared here with only a generic, unclaimed profile
 * URL — not the developer's own account — so it does not appear at all: a
 * link is either real or it is not shown.
 */
export const SOCIAL_LINKS: readonly SocialLink[] = [
  { id: 'github', href: 'https://github.com/BenzidaneMo', Icon: GitHubGlyph },
  { id: 'linkedin', href: 'https://www.linkedin.com/in/mohamed-benzidane-42b958210', Icon: LinkedInGlyph },
  { id: 'x', href: 'https://x.com/Miracleinvoker_', Icon: XGlyph },
  { id: 'facebook', href: 'https://www.facebook.com/paragonS0', Icon: FacebookGlyph },
  { id: 'portfolio', href: 'https://portfolio-mohamed-benzidane.netlify.app', Icon: GlobeIcon },
]

/**
 * How to reach the project directly, shown in the footer's contact column —
 * distinct from `SOCIAL_LINKS`' developer profiles above. The phone number is
 * kept in both a display form (as given) and a `tel:` form (digits only,
 * `+` kept) since a `tel:` href cannot contain spaces.
 */
export const CONTACT = {
  email: 'hamidouaze@gmail.com',
  phoneDisplay: '+213 663 60 52 90',
  phoneHref: 'tel:+213663605290',
} as const

export interface OfficialLink {
  id: 'interior' | 'religiousAffairs' | 'digitalServices'
  href: string
}

/**
 * Real Algerian government sites relevant to this platform's domain —
 * offered as a courtesy for a citizen already here, not as a claim that this
 * project is affiliated with, endorsed by or operated by any of them. The
 * footer's heading and labels make that distinction in wording, not just by
 * omission.
 */
export const OFFICIAL_LINKS: readonly OfficialLink[] = [
  { id: 'interior', href: 'https://www.interieur.gov.dz' },
  { id: 'religiousAffairs', href: 'https://marw.gov.dz/' },
  { id: 'digitalServices', href: 'https://dzds.dz/' },
]
