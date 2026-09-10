import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Static properties of the About page, Footer and social-link infrastructure —
 * the same style of check as `public-safety.test.tsx` and
 * `register-safety.test.tsx`, over the modules STEP 23 added.
 */

const clientSrc = join(process.cwd(), 'src')

const MODULES = [
  'pages/About.tsx',
  'components/layout/Footer.tsx',
  'components/SocialLinks.tsx',
  'config/site.ts',
  'config/nav.ts',
]

function source(file: string): string {
  return readFileSync(join(clientSrc, file), 'utf8')
}

function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
}

describe('the About page and footer stay static and admin-free', () => {
  it('writes nothing to browser storage', () => {
    for (const file of MODULES) {
      const code = withoutComments(source(file))
      expect(code, file).not.toContain('localStorage')
      expect(code, file).not.toContain('sessionStorage')
      expect(code, file).not.toContain('indexedDB')
      expect(code, file).not.toContain('document.cookie')
    }
  })

  it('names no admin route or admin API endpoint', () => {
    for (const file of MODULES) {
      const code = withoutComments(source(file))
      expect(code, file).not.toContain('/api/admin')
      expect(code, file).not.toContain("'/admin")
      expect(code, file).not.toContain('"/admin')
    }
  })

  it('every social link opens in a new tab without leaking a same-origin opener or referrer', () => {
    const code = withoutComments(source('components/SocialLinks.tsx'))
    expect(code).toContain('target="_blank"')
    expect(code).toContain('noopener')
    expect(code).toContain('noreferrer')
  })
})
