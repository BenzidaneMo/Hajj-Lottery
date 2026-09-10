import type { ButtonHTMLAttributes } from 'react'
import { Slot } from 'radix-ui'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  /**
   * Renders the child element instead of a `<button>`, with these classes and
   * handlers merged onto it. For a link styled as a button — `<Button asChild>
   * <Link to="...">`. Without it, a `<button>` nested inside the `<a>` a
   * `Link` renders is invalid HTML: a button has no business inside another
   * interactive element, and this is how shadcn's own Button avoids the same
   * problem.
   */
  asChild?: boolean
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90 focus-visible:outline-primary',
  secondary:
    'border border-border bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/70 focus-visible:outline-stone-400',
  ghost: 'bg-transparent text-primary hover:bg-accent focus-visible:outline-primary',
  danger:
    'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90 focus-visible:outline-destructive',
}

export function Button({
  variant = 'primary',
  className = '',
  type = 'button',
  asChild = false,
  ...props
}: ButtonProps) {
  const classes = `inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 active:scale-[0.98] ${VARIANT_CLASSES[variant]} ${className}`

  if (asChild) {
    return <Slot.Root className={classes} {...props} />
  }

  return <button type={type} className={classes} {...props} />
}
