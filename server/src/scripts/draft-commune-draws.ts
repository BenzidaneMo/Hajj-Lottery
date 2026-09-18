/**
 * Moves every READY commune draw back to DRAFT, for local testing -- the exact
 * inverse of ready-commune-draws.ts, and needed for the same reason in reverse.
 *
 *   npm run draft-commune-draws --workspace server
 *   npm run draft-commune-draws --workspace server -- --year=2027
 *
 * After reset-commune-draw.ts or reset-participants.ts has undone a draw, the
 * commune draws it touched are left READY (that is deliberate -- a commune left
 * LOCKED with no pool is the broken state those scripts exist to avoid). But a
 * tester who wants to walk the whole workflow again from the beginning --
 * allocation, settle, freeze, execute -- needs them back at DRAFT, and clicking
 * "Draft" on each commune in turn is the same chore ready-commune-draws.ts
 * exists to skip.
 *
 * `--year` narrows to one draw year; with none given, every READY commune draw
 * in every year is moved. READY -> DRAFT carries no database trigger -- unlike
 * LOCKED/COMPLETED, nothing enforces it below the application layer (see
 * shared/src/draw-configuration.ts and CLAUDE.md's "Draw configuration"
 * section) -- so this is a plain column write, not the
 * `session_replication_role` escape hatch reset-commune-draw.ts needs for the
 * immutable pool/result tables.
 *
 * It only ever touches READY rows. DRAFT is already there; LOCKED, COMPLETED
 * and CANCELLED are left exactly as they are, and deliberately so: LOCKED means
 * a frozen pool exists, and quietly returning such a draw to DRAFT would
 * produce a draw whose configuration is editable while its input is immutable --
 * precisely the disagreement freezing exists to prevent. Undoing a freeze is
 * reset-commune-draw.ts's job, and it is a different, far more invasive
 * operation.
 *
 * Nothing about this is a feature. READY -> DRAFT is a legal administrative
 * transition the console already offers per commune (and a scoped
 * WILAYA_ADMIN/COMMUNE_ADMIN may make it for their own), because unsettling
 * your own commune's allocation carries none of the conflict-of-interest an
 * allocation edit does. What does not exist, and should not, is a "Draft All"
 * button: settling a commune is meant to be a deliberate, per-commune decision.
 * This script exists only to skip that click during local testing.
 */
import { prisma } from '../lib/prisma.js'

function arg(name: string): string | undefined {
  const flag = `--${name}=`
  const found = process.argv.find((value) => value.startsWith(flag))
  return found ? found.slice(flag.length) : undefined
}

function assertNotProduction(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('draft-commune-draws refuses to run with NODE_ENV=production')
  }
}

async function main() {
  assertNotProduction()

  const yearArg = arg('year')
  const where = {
    status: 'READY' as const,
    ...(yearArg ? { drawYear: { year: Number(yearArg) } } : {}),
  }

  const candidates = await prisma.communeDraw.findMany({
    where,
    include: { commune: true, drawYear: true },
  })

  if (candidates.length === 0) {
    console.log(
      yearArg
        ? `Nothing to do: no READY commune draw in ${yearArg}.`
        : 'Nothing to do: no READY commune draw anywhere.',
    )
    return
  }

  const { count } = await prisma.communeDraw.updateMany({ where, data: { status: 'DRAFT' } })

  console.log(`Returned ${count} commune draw(s) to DRAFT${yearArg ? ` for ${yearArg}` : ''}:`)
  for (const draw of candidates) {
    console.log(`  ${draw.commune.nameFr} (${draw.commune.code}), year ${draw.drawYear.year}`)
  }
}

main()
  .catch((error) => {
    console.error('Returning commune draws to draft failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
