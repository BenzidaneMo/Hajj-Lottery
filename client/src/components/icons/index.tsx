import type { SVGProps } from 'react'

/**
 * Small hand-drawn icon set for functional UI controls only (menu toggles,
 * dismiss buttons, profile placeholder). Deliberately not used as decoration
 * or per-sidebar-item icons — see STEP 02 design priorities (restrained
 * visual hierarchy, avoid over-design).
 */
export type IconProps = SVGProps<SVGSVGElement>

function BaseIcon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  )
}

export function MenuIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
    </BaseIcon>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </BaseIcon>
  )
}

export function UserIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M12 12a4 4 0 100-8 4 4 0 000 8z" />
      <path d="M4.5 20.25a7.5 7.5 0 0115 0" />
    </BaseIcon>
  )
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M6 9l6 6 6-6" />
    </BaseIcon>
  )
}
