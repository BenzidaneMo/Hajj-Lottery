import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { resolveTestDatabaseUrl } from './test-database.js'

const SCHEMA_PATH = fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))

/**
 * Brings the test database up to the committed migrations before any test
 * runs — so the suite exercises the same schema production will get, and a
 * broken migration fails the test run rather than passing silently.
 */
export default function setup(): void {
  const databaseUrl = resolveTestDatabaseUrl()

  execFileSync('npx', ['prisma', 'migrate', 'deploy', '--schema', SCHEMA_PATH], {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
}
