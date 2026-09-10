import {
  FacebookGlyph,
  GitHubGlyph,
  InstagramGlyph,
  LinkedInGlyph,
  XGlyph,
  type BrandIconProps,
} from '../components/icons/brands'

/**
 * Static identity facts that both the About page and the Footer need — kept
 * here once so neither carries its own copy. Only non-language-dependent
 * values live here (a URL, an icon); every piece of visible wording stays in
 * the i18n locale files, per project convention.
 */

export const DEVELOPER = {
  name: 'Mohamed Benzidane',
  handle: 'BenzidaneMo',
} as const

export interface SocialLink {
  id: 'github' | 'linkedin' | 'x' | 'instagram' | 'facebook'
  href: string
  Icon: (props: BrandIconProps) => React.JSX.Element
}

export const SOCIAL_LINKS: readonly SocialLink[] = [
  { id: 'github', href: 'https://github.com/BenzidaneMo', Icon: GitHubGlyph },
  { id: 'linkedin', href: 'https://www.linkedin.com/in/mohamed-benzidane-42b958210', Icon: LinkedInGlyph },
  { id: 'x', href: 'https://x.com/Miracleinvoker_', Icon: XGlyph },
  { id: 'instagram', href: 'https://www.instagram.com/', Icon: InstagramGlyph },
  { id: 'facebook', href: 'https://www.facebook.com/paragonS0', Icon: FacebookGlyph },
]
