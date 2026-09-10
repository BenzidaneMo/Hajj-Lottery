import { m, useReducedMotion, type Variants } from 'framer-motion'
import type { PropsWithChildren } from 'react'

export interface RevealProps extends PropsWithChildren {
  className?: string
  /** Staggers entrance among siblings, in seconds — e.g. `index * 0.1` in a `.map()`. */
  delay?: number
}

/**
 * Fades and lifts its children into place the first time they enter the
 * viewport, once (`whileInView` + `viewport={{ once: true }}`). Used
 * sparingly — the landing hero and its "how it works" cards — not on every
 * card everywhere; see `docs/public-ui.md` for why.
 *
 * `m`, not `motion`: this must render inside `Home.tsx`'s `<LazyMotion>`,
 * which is what keeps the animation engine out of the bundle every other
 * public page shares — see `lib/motion-features.ts`.
 *
 * Framer Motion's own `useReducedMotion` decides the variant: a visitor who
 * prefers reduced motion still fades in (so content isn't simply missing) but
 * never travels vertically, the same restrained substitution the spec for
 * this step describes rather than skipping the entrance outright.
 */
export function Reveal({ children, className = '', delay = 0 }: RevealProps) {
  const shouldReduceMotion = useReducedMotion()

  const variants: Variants = {
    hidden: { opacity: 0, y: shouldReduceMotion ? 0 : 24 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: 'easeOut', delay } },
  }

  return (
    <m.div
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.2 }}
      variants={variants}
    >
      {children}
    </m.div>
  )
}
