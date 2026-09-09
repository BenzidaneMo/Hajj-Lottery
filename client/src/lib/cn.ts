import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Joins class names, letting a later Tailwind utility win over an earlier one
 * in the same group.
 *
 * Every shadcn/ui component takes a `className` and merges it with its own
 * defaults through this. Plain concatenation would leave both `px-4` and
 * `px-2` in the list and let source order in the stylesheet decide, which is
 * how a component ends up ignoring the padding a caller asked for.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
