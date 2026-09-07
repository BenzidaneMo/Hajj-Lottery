/**
 * Administrator bootstrap CLI.
 *
 *   npm run seed:admin    — development only, reads DEV_ADMIN_* from .env
 *   npm run admin:create  — any environment, requires ADMIN_USERNAME/ADMIN_PASSWORD
 *
 * Neither mode has a default credential: without explicit values nothing is
 * created. Nothing here logs the password.
 */
import { prisma } from '../lib/prisma.js'
import {
  createInitialAdmin,
  devAdminCredentials,
  explicitAdminCredentials,
} from '../services/admin-bootstrap.js'

const devOnly = !process.argv.includes('--explicit')

async function main(): Promise<void> {
  const credentials = devOnly ? devAdminCredentials() : explicitAdminCredentials()
  const outcome = await createInitialAdmin({ ...credentials, devOnly })

  switch (outcome.status) {
    case 'created':
      console.log(`Created SUPER_ADMIN "${outcome.username}".`)
      if (!devOnly) {
        console.log('Change this password after the first sign-in.')
      }
      break
    case 'password-updated':
      console.log(`Administrator "${outcome.username}" already existed; password reset (non-production).`)
      break
    case 'already-exists':
      console.log(`Administrator "${outcome.username}" already exists; left unchanged.`)
      break
    case 'skipped':
      console.log(`No administrator created: ${outcome.reason}`)
      break
  }
}

main()
  .catch((error) => {
    console.error('Admin bootstrap failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
