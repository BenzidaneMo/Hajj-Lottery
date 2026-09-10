import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Properties of the registration surface as a whole.
 *
 * `public-safety.test.tsx` scans the pages under `/api/public` — this covers
 * the registration flow, which is deliberately not in that list because it
 * legitimately calls `/api/applications`, an endpoint the public scan treats
 * as forbidden for every other page. Static and structural for the same
 * reason as that file: a rendering test can only show one page, given one
 * response, did not do something; a source scan shows the code to do it does
 * not exist at all.
 */

const clientSrc = join(process.cwd(), 'src')

const REGISTRATION_MODULES = [
  'pages/Register.tsx',
  'pages/Home.tsx',
  'components/registration/ApplicantFields.tsx',
  'components/registration/ApplicationReceipt.tsx',
  'components/registration/applicant.ts',
  'components/geo/WilayaSelect.tsx',
  'components/geo/CommuneSelect.tsx',
  'components/public/StepIndicator.tsx',
  'components/public/PageSection.tsx',
  'components/public/DescriptionField.tsx',
]

function source(file: string): string {
  return readFileSync(join(clientSrc, file), 'utf8')
}

function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
}

describe('the registration wizard stores nothing and stays off the admin API', () => {
  it('writes nothing to browser storage', () => {
    for (const file of REGISTRATION_MODULES) {
      const code = withoutComments(source(file))
      expect(code, file).not.toContain('localStorage')
      expect(code, file).not.toContain('sessionStorage')
      expect(code, file).not.toContain('indexedDB')
      expect(code, file).not.toContain('document.cookie')
    }
  })

  it('names no admin or participant endpoint', () => {
    for (const file of REGISTRATION_MODULES) {
      const code = withoutComments(source(file))
      expect(code, file).not.toContain('/api/admin')
      expect(code, file).not.toContain('/api/participants')
      expect(code, file).not.toContain('/api/auth')
    }
  })

  it('never builds a URL, a query string or a route param from an applicant field', () => {
    // The wizard keeps a national ID and a phone number in component state,
    // never in `useParams`, `useSearchParams`, a template literal handed to
    // `Link`/`navigate`, or a `URLSearchParams` — all of which would risk one
    // reaching the address bar, browser history or an access log.
    for (const file of ['pages/Register.tsx', 'components/registration/ApplicantFields.tsx']) {
      const code = withoutComments(source(file))
      expect(code, file).not.toContain('useSearchParams')
      expect(code, file).not.toContain('URLSearchParams')
      expect(code, file).not.toMatch(/navigate\(/)
    }
  })
})
