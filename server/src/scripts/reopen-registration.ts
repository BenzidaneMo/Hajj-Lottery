/**
 * Reopens a draw year for registration, undoing `REGISTRATION_CLOSED` for
 * further manual testing.
 *
 *   npm run reopen-registration --workspace server
 *   npm run reopen-registration --workspace server -- --year=2026
 *
 * `--year` is only needed when more than one year is currently
 * REGISTRATION_CLOSED; with none given, the sole closed year is used.
 *
 * `DrawConfigurationService.updateDrawYearStatus` refuses this on purpose --
 * `DRAW_YEAR_TRANSITIONS.REGISTRATION_CLOSED` is `['ARCHIVED']` only, because
 * reopening intake after telling everyone the year is settled is a policy
 * decision nobody has made (see shared/src/draw-configuration.ts). This
 * script writes the column directly, bypassing that rule, which is exactly
 * why it belongs here and not behind any admin route: it exists so a tester
 * can get back to REGISTRATION_OPEN without a database client, not so an
 * administrator ever could. There is no trigger to fight (unlike the draw
 * tables) -- only the partial unique index allowing at most one
 * REGISTRATION_OPEN year at a time, which this script still respects by
 * refusing outright if some other year already holds it.
 */
import { prisma } from '../lib/prisma.js'

function arg(name: string): string | undefined {
  const flag = `--${name}=`
  const found = process.argv.find((value) => value.startsWith(flag))
  return found ? found.slice(flag.length) : undefined
}

function assertNotProduction(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('reopen-registration refuses to run with NODE_ENV=production')
  }
}

async function main() {
  assertNotProduction()

  const yearArg = arg('year')

  const alreadyOpen = await prisma.drawYear.findFirst({ where: { status: 'REGISTRATION_OPEN' } })
  if (alreadyOpen) {
    console.log(`Nothing to do: ${alreadyOpen.year} is already REGISTRATION_OPEN.`)
    return
  }

  const drawYear = yearArg
    ? await prisma.drawYear.findUnique({ where: { year: Number(yearArg) } })
    : await singleClosedYear()

  if (!drawYear) {
    throw new Error(
      yearArg ? `No draw year "${yearArg}" found.` : 'No REGISTRATION_CLOSED year found -- pass --year.',
    )
  }
  if (drawYear.status !== 'REGISTRATION_CLOSED') {
    throw new Error(`Draw year ${drawYear.year} is ${drawYear.status}, not REGISTRATION_CLOSED.`)
  }

  await prisma.drawYear.update({ where: { id: drawYear.id }, data: { status: 'REGISTRATION_OPEN' } })
  console.log(`Reopened ${drawYear.year} for registration.`)
}

async function singleClosedYear() {
  const closed = await prisma.drawYear.findMany({ where: { status: 'REGISTRATION_CLOSED' } })
  if (closed.length > 1) {
    const years = closed.map((y) => y.year).join(', ')
    throw new Error(`Multiple years are REGISTRATION_CLOSED (${years}) -- pass --year to pick one.`)
  }
  return closed[0] ?? null
}

main()
  .catch((error) => {
    console.error('Reopen failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
