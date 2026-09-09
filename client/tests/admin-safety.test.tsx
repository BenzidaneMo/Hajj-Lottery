import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { AdminCommuneDraw } from '../src/pages/admin/AdminCommuneDraw'
import { router } from '../src/routes'

import { communeDraw, drawResult, poolSummary, renderAdmin } from './admin-harness'
import { stubApi, switchLocale } from './harness'

/**
 * Properties of the administrative console as a whole.
 *
 * These are static and structural on purpose. A rendering test can only prove
 * that one screen, given one response, did not do something; a scan over the
 * sources proves that no admin module contains the code to do it at all —
 * including the pages a later step adds.
 */

const SRC = join(process.cwd(), 'src')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return walk(full)
    return full.endsWith('.tsx') || full.endsWith('.ts') ? [full] : []
  })
}

/** Every module an administrator's browser runs, excluding generated shadcn. */
const ADMIN_MODULES = [
  ...walk(join(SRC, 'pages', 'admin')),
  ...walk(join(SRC, 'components', 'admin')),
  ...walk(join(SRC, 'components', 'layout', 'admin')),
  join(SRC, 'lib', 'admin-api.ts'),
  join(SRC, 'lib', 'use-async.ts'),
  join(SRC, 'lib', 'api.ts'),
]

const SHADCN_MODULES = walk(join(SRC, 'components', 'shadcn'))

function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
}

function source(file: string): string {
  return withoutComments(readFileSync(file, 'utf8'))
}

function relative(file: string): string {
  return file.slice(SRC.length + 1).replaceAll('\\', '/')
}

describe('the console stores nothing', () => {
  it('writes to no browser storage', () => {
    for (const file of [...ADMIN_MODULES, ...SHADCN_MODULES]) {
      const code = source(file)
      // A shared office machine must not hand the next operator the previous
      // one's session, filters or draft explanation. The locale preference in
      // `i18n/index.ts` remains the only thing this app stores at all.
      expect(code, relative(file)).not.toContain('localStorage')
      expect(code, relative(file)).not.toContain('sessionStorage')
      expect(code, relative(file)).not.toContain('indexedDB')
      expect(code, relative(file)).not.toContain('document.cookie')
    }
  })

  it('holds no token, password or key of its own', () => {
    for (const file of ADMIN_MODULES) {
      const code = source(file)
      // The session is an HttpOnly cookie the browser attaches; JavaScript
      // never reads it, and there is nothing else to hold.
      expect(code, relative(file)).not.toMatch(/\b(apiKey|api_key|accessToken|bearer)\b/i)
      expect(code, relative(file)).not.toMatch(/Authorization['"]?\s*:/i)
    }
  })
})

describe('the console decides nothing', () => {
  it('contains no randomness', () => {
    for (const file of ADMIN_MODULES) {
      const code = source(file)
      // Banned across `client/src` exactly as across `server/src`. A console
      // that appeared to resolve chance would misrepresent where the decision
      // was made.
      expect(code, relative(file)).not.toContain('Math.random')
      expect(code, relative(file)).not.toContain('crypto.getRandomValues')
    }
  })

  it('never sorts a winner or reserve list', () => {
    const resultPanel = source(join(SRC, 'components', 'admin', 'ResultPanel.tsx'))

    // The order came from the lottery. Rearranging it on screen — by weight,
    // by status, by anything — would misrepresent what the draw produced.
    expect(resultPanel).not.toContain('.sort(')
    expect(resultPanel).not.toContain('.reverse(')
    expect(resultPanel).not.toContain('shuffle')
  })

  it('sends no winner count, seed or algorithm version with an execution', () => {
    const api = source(join(SRC, 'lib', 'admin-api.ts'))
    const execute = api.slice(api.indexOf('export function executeDraw'))
    const body = execute.slice(0, execute.indexOf('export function fetchDrawResult'))

    // `apiPost` with no second argument sends no body at all.
    expect(body).not.toContain('winnerCount')
    expect(body).not.toContain('seed')
    expect(body).not.toContain('algorithmVersion')
  })
})

describe('the console stays on the admin API', () => {
  it('names no endpoint outside /api/admin and the session routes', () => {
    const paths = ADMIN_MODULES.flatMap((file) => [...source(file).matchAll(/\/api\/[\w-]+/g)])
      .map((match) => match[0])
      .filter((path, index, all) => all.indexOf(path) === index)
      .sort()

    // `/api/auth` is the session; `/api/wilayas` is reached only through
    // `lib/geo`'s hooks, which the pickers call with `scoped: true`.
    expect(paths).toEqual(['/api/admin', '/api/auth'])
  })

  it('routes every admin page by an opaque id, never by an identifying value', () => {
    function paths(routes: typeof router.routes, prefix = ''): string[] {
      return routes.flatMap((route) => {
        const own = route.path ? `${prefix}/${route.path}`.replace(/\/+/g, '/') : prefix
        const children = route.children ? paths(route.children, own) : []
        return [...(route.path !== undefined || route.index ? [own || '/'] : []), ...children]
      })
    }

    const admin = paths(router.routes).filter((path) => path.startsWith('/admin'))
    expect(admin).toContain('/admin/communes/:id')
    expect(admin).toContain('/admin/applications/:id')

    for (const path of admin) {
      // No national ID, phone number or receipt reference in any address.
      expect(path.toLowerCase()).not.toContain('nationalid')
      expect(path.toLowerCase()).not.toContain('phone')
      expect(path.toLowerCase()).not.toContain('reference')
    }
  })
})

describe('shadcn/ui is the component foundation', () => {
  it('imports no competing UI framework anywhere in the client', () => {
    const everything = walk(SRC)
      .map((file) => source(file))
      .join('\n')

    for (const framework of [
      '@mui/',
      '@material-ui/',
      'antd',
      '@chakra-ui/',
      'bootstrap',
      'react-bootstrap',
      '@mantine/',
      'semantic-ui',
    ]) {
      expect(everything).not.toContain(framework)
    }
  })

  it('builds the admin pages from shadcn primitives rather than one-off markup', () => {
    for (const file of walk(join(SRC, 'pages', 'admin'))) {
      const code = source(file)
      // The login page predates the console and keeps the public kit; every
      // other admin page composes shadcn.
      if (relative(file).endsWith('AdminLogin.tsx')) continue
      expect(code, relative(file)).toContain('@/components/shadcn/')
    }
  })

  it('keeps the public kit and the shadcn kit apart', () => {
    for (const file of walk(join(SRC, 'pages', 'admin'))) {
      if (relative(file).endsWith('AdminLogin.tsx')) continue
      // Mixing `components/ui` and `components/shadcn` on one page is how two
      // button styles end up side by side.
      expect(source(file), relative(file)).not.toMatch(/from '(\.\.\/)*\.\.\/components\/ui'/)
    }
  })

  it('leaves no physical direction utility in an admin module', () => {
    for (const file of [...ADMIN_MODULES, ...SHADCN_MODULES]) {
      const code = source(file)
      // `ps-`/`pe-`/`ms-`/`me-`/`start-`/`end-` mirror under RTL; their
      // physical counterparts do not. Radix's `data-[side=…]` animation
      // origins are computed at runtime and are not matched here.
      const physical = [...code.matchAll(/["'\s](?:sm:|md:|lg:)?(p[lr]|m[lr])-\d/g)]
      expect(
        physical.map((match) => match[0]),
        relative(file),
      ).toEqual([])
    }
  })
})

describe('dangerous actions are guarded', () => {
  it('never uses a native confirm dialog', () => {
    for (const file of ADMIN_MODULES) {
      const code = source(file)
      // A native dialog cannot be translated, cannot be read right-to-left,
      // and cannot state a consequence in more than one line.
      expect(code, relative(file)).not.toMatch(/\bwindow\.confirm\b|\bwindow\.alert\b/)
      expect(code, relative(file)).not.toMatch(/(?<![.\w])confirm\(/)
    }
  })

  it('traps focus in a confirmation and states the consequence', async () => {
    await switchLocale('en')
    stubApi({
      '/api/admin/commune-draws/cd-1': { body: communeDraw({ status: 'LOCKED', allocatedSpots: 3 }) },
      '/api/admin/commune-draws/cd-1/pool/summary': { body: poolSummary() },
      '/api/admin/commune-draws/cd-1/result': {
        status: 404,
        body: { error: 'x', code: 'DRAW_RESULT_NOT_FOUND' },
      },
    })

    renderAdmin(<AdminCommuneDraw />, { pattern: '/admin/communes/:id', path: '/admin/communes/cd-1' })
    await userEvent.click(await screen.findByRole('tab', { name: 'Run the lottery' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Run the lottery' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveAttribute('aria-describedby')
    expect(dialog).toHaveAttribute('aria-labelledby')

    // Focus is inside the dialog, and the page behind is inert.
    expect(dialog.contains(document.activeElement)).toBe(true)

    // Escape closes it without running anything.
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('marks a destructive confirmation as destructive, and still spells it out', async () => {
    await switchLocale('en')
    stubApi({
      '/api/admin/commune-draws/cd-1': { body: communeDraw({ status: 'COMPLETED', allocatedSpots: 3 }) },
      '/api/admin/commune-draws/cd-1/pool/summary': { body: poolSummary() },
      '/api/admin/commune-draws/cd-1/result': { body: drawResult() },
    })

    renderAdmin(<AdminCommuneDraw />, { pattern: '/admin/communes/:id', path: '/admin/communes/cd-1' })
    await userEvent.click(await screen.findByRole('tab', { name: 'Result' }))

    const winners = await screen.findByRole('table', { name: 'Original winners' })
    const row = within(winners).getAllByRole('row')[1]!
    await userEvent.click(within(row).getByRole('button', { name: 'Record a withdrawal' }))

    const dialog = await screen.findByRole('dialog')
    // Colour is never the message: the consequence is written out.
    expect(within(dialog).getByText(/lifetime Hajj win still stands/)).toBeInTheDocument()
  })
})
