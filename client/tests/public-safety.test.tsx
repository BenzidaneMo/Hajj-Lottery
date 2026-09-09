import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { router } from '../src/routes'

/**
 * Properties of the public surface as a whole, rather than of any one page.
 *
 * These are static and structural on purpose. A rendering test can only prove
 * that a particular page, given a particular response, did not do something; a
 * scan over the sources proves that no public page contains the code to do it
 * at all, including the pages a future step adds.
 */

const clientSrc = join(process.cwd(), 'src')

/** Every module a citizen's browser runs on a public route. */
const PUBLIC_MODULES = [
  'pages/ApplicationStatus.tsx',
  'pages/Winners.tsx',
  'pages/PublicResult.tsx',
  'pages/Draw.tsx',
  'pages/DrawWatch.tsx',
  'components/public/ApplicationStatusPanel.tsx',
  'components/public/DrawStage.tsx',
  'components/public/PublicFilterBar.tsx',
  'components/public/filters.ts',
  'components/public/PublicStatusBadge.tsx',
  'components/public/WinnerList.tsx',
  'components/public/ReserveList.tsx',
  'components/public/publicError.ts',
  'components/geo/PlaceCodeFilters.tsx',
  'lib/public.ts',
  'lib/draw-watch.ts',
]

function source(file: string): string {
  return readFileSync(join(clientSrc, file), 'utf8')
}

function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
}

describe('the public pages stay on the public API', () => {
  it('names no admin, participant or application endpoint', () => {
    for (const file of PUBLIC_MODULES) {
      const code = withoutComments(source(file))
      expect(code, file).not.toContain('/api/admin')
      expect(code, file).not.toContain('/api/participants')
      expect(code, file).not.toContain('/api/applications')
      expect(code, file).not.toContain('/api/auth')
    }
  })

  it('names no endpoint of its own outside /api/public', () => {
    // Geography is reached through `lib/geo`'s hooks, which are shared with the
    // admin screens and take a `scoped` flag; the public filters never pass it,
    // so they read `/api/wilayas` — deliberately public, since the registration
    // form needs every commune. Every path written *in* a public module is
    // otherwise a public one.
    const paths = PUBLIC_MODULES.flatMap((file) => [
      ...withoutComments(source(file)).matchAll(/\/api\/[\w-]+/g),
    ])
      .map((match) => match[0])
      .filter((path, index, all) => all.indexOf(path) === index)

    expect(paths).toEqual(['/api/public'])
    expect(withoutComments(source('components/geo/PlaceCodeFilters.tsx'))).not.toContain('scoped')
  })

  it('writes nothing to browser storage', () => {
    for (const file of PUBLIC_MODULES) {
      const code = withoutComments(source(file))
      // No citizen session, no remembered reference, no cached outcome. A
      // shared machine must not hand the next person somebody's result, and
      // the locale preference in `i18n/index.ts` is the only thing this app
      // stores at all.
      expect(code, file).not.toContain('localStorage')
      expect(code, file).not.toContain('sessionStorage')
      expect(code, file).not.toContain('indexedDB')
      expect(code, file).not.toContain('document.cookie')
    }
  })

  it('sends the status lookup as a POST and nothing else as one', () => {
    const api = withoutComments(source('lib/public.ts'))

    // One POST in the whole public client, and it is the lookup — whose two
    // values must not reach a URL, an access log or a shared cache key.
    expect(api.match(/apiPost/g) ?? []).toHaveLength(2)
    expect(api).toContain("apiPost<PublicApplicationStatusDto>('/api/public/application-status'")
  })
})

describe('public routing', () => {
  function paths(routes: typeof router.routes, prefix = ''): string[] {
    return routes.flatMap((route) => {
      const own = route.path ? `${prefix}/${route.path}`.replace(/\/+/g, '/') : prefix
      const children = route.children ? paths(route.children, own) : []
      return [...(route.path !== undefined || route.index ? [own || '/'] : []), ...children]
    })
  }

  const all = paths(router.routes)

  it('keeps every route the earlier steps established', () => {
    for (const path of [
      '/',
      '/register',
      '/application-status',
      '/winners',
      '/draw',
      '/about',
      '/admin/login',
    ]) {
      expect(all).toContain(path)
    }
  })

  it('adds the result and draw detail routes, addressed by code', () => {
    expect(all).toContain('/results/:drawYear/:wilayaCode/:communeCode')
    expect(all).toContain('/draw/:drawYear/:wilayaCode/:communeCode')

    // No public route takes an internal id, and none takes an application
    // reference: a reference in a canonical URL would be a shareable link to
    // one person's verification value.
    for (const path of all.filter((entry) => !entry.startsWith('/admin'))) {
      expect(path).not.toMatch(/:.*[Ii]d\b/)
      expect(path.toLowerCase()).not.toContain('reference')
    }
  })
})
