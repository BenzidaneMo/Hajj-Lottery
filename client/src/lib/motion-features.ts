import { domAnimation } from 'framer-motion'

/**
 * Loaded through a dynamic `import()` from `LazyMotion` (see `Home.tsx`), so
 * the animation engine itself lands in its own chunk instead of the one every
 * public page shares — the same reasoning `docs/public-ui.md` gives for
 * lazy-loading `/register`, applied to a library instead of a route. `m`
 * components (used in place of `motion.*`) render as plain, inert elements
 * until this resolves, then pick up the entrance/interaction animation.
 */
export default domAnimation
