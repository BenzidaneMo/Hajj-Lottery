/**
 * Moves every DRAFT commune draw straight to READY, for local testing --
 * so a tester can drive "Freeze All Ready Pools" or "Execute All Validated
 * Draws" without opening each commune's own page and clicking "Ready" one at
 * a time first.
 *
 *   npm run ready-commune-draws --workspace server
 *   npm run ready-commune-draws --workspace server -- --year=2027
 *
 * `--year` narrows to one draw year; with none given, every DRAFT commune
 * draw in every year is moved. DRAFT -> READY carries no database trigger --
 * unlike LOCKED/COMPLETED, nothing enforces it below the application layer
 * (see shared/src/draw-configuration.ts and CLAUDE.md's "Draw configuration"
 * section) -- so this is a plain column write, not the
 * `session_replication_role` escape hatch reset-commune-draw.ts needs for the
 * immutable pool/result tables. It only ever touches DRAFT rows: READY,
 * LOCKED, COMPLETED and CANCELLED are left exactly as they are.
 *
 * This is a development tool, not an administrative feature -- there is no
 * "Ready All" button and no batch route for this in the console. Settling a
 * commune's allocation is meant to be a deliberate, per-commune decision (an
 * administrator does it individually, or -- since the scoped DRAFT<->READY
 * change -- a WILAYA_ADMIN/COMMUNE_ADMIN does it for their own commune); this
 * script exists only to skip that click during local testing.
 */
import { prisma } from '../lib/prisma.js'

function arg(name: string): string | undefined {
  const flag = `--${name}=`
  const found = process.argv.find((value) => value.startsWith(flag))
  return found ? found.slice(flag.length) : undefined
}

function assertNotProduction(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('ready-commune-draws refuses to run with NODE_ENV=production')
  }
}

async function main() {
  assertNotProduction()

  const yearArg = arg('year')
  const where = {
    status: 'DRAFT' as const,
    ...(yearArg ? { drawYear: { year: Number(yearArg) } } : {}),
  }

  const candidates = await prisma.communeDraw.findMany({
    where,
    include: { commune: true, drawYear: true },
  })

  if (candidates.length === 0) {
    console.log(
      yearArg
        ? `Nothing to do: no DRAFT commune draw in ${yearArg}.`
        : 'Nothing to do: no DRAFT commune draw anywhere.',
    )
    return
  }

  const { count } = await prisma.communeDraw.updateMany({ where, data: { status: 'READY' } })

  console.log(`Readied ${count} commune draw(s)${yearArg ? ` for ${yearArg}` : ''}:`)
  for (const draw of candidates) {
    console.log(`  ${draw.commune.nameFr} (${draw.commune.code}), year ${draw.drawYear.year}`)
  }
}

main()
  .catch((error) => {
    console.error('Readying commune draws failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
