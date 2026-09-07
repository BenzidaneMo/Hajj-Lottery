import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

export type IconButtonVariant = 'primary' | 'secondary' | 'ghost'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode
  /** Accessible name — icon-only buttons have no visible text. */
  label: string
  variant?: IconButtonVariant
}

const VARIANT_CLASSES: Record<IconButtonVariant, string> = {
  primary: 'bg-primary-700 text-white hover:bg-primary-800 focus-visible:outline-primary-700',
  secondary: 'bg-stone-100 text-stone-700 hover:bg-stone-200 focus-visible:outline-stone-400',
  ghost: 'bg-transparent text-stone-600 hover:bg-stone-100 focus-visible:outline-stone-400',
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant = 'ghost', className = '', type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    >
      {icon}
    </button>
  )
})
