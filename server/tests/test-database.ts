import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'

/**
 * Resolves the database the test suite is allowed to touch.
 *
 * The suite truncates tables, so it must never point at the development or
 * production database. `resolveTestDatabaseUrl` refuses any URL whose
 * database name does not identify itself as a test database.
 */
export function resolveTestDatabaseUrl(): string {
  dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) })

  const url = process.env.TEST_DATABASE_URL
  if (!url) {
    throw new Error('TEST_DATABASE_URL is not set. Point it at a dedicated test database (see .env.example).')
  }

  const databaseName = new URL(url).pathname.replace(/^\//, '')
  if (!/test/i.test(databaseName)) {
    throw new Error(
      `Refusing to run tests against database "${databaseName}": its name must contain "test", ` +
        'because the suite truncates tables between tests.',
    )
  }

  return url
}
