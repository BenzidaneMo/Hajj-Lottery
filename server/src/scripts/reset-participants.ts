/**
 * Wipes every citizen-facing record in the database: participants,
 * applications, participation history, draw pools/results/winners/reserves,
 * and legacy import batches -- a clean slate for re-seeding mock data.
 *
 *   npm run reset-participants --workspace server           # dry run, deletes nothing
 *   npm run reset-participants --workspace server -- --yes   # actually deletes
 *
 * Left alone on purpose: wilayas/communes, draw years and commune-draw
 * configuration (allocated spots), and administrator accounts. Any commune
 * draw currently LOCKED or COMPLETED is put back to READY, since its pool
 * and result are gone -- a LOCKED or COMPLETED commune draw with no pool
 * behind it is exactly the broken state `isAdministrativelySettable` exists
 * to prevent elsewhere, and this script must not recreate it at scale.
 *
 * Audit log rows are deliberately not touched: `target_id` is not a foreign
 * key precisely so a record outlives what it describes (see
 * docs/audit-and-governance.md), and this is a bulk data reset, not an undo
 * of one specific action the way reset-commune-draw.ts is.
 *
 * draw_pools / draw_pool_entries / draw_results / draw_winners /
 * draw_selection_events / winner_archive are immutable by trigger, by
 * design. `SET LOCAL session_replication_role = replica` disables every
 * trigger (including FK enforcement) for the lifetime of one transaction
 * only, reverting automatically at commit or rollback -- the same escape
 * hatch reset-commune-draw.ts uses, here applied to the whole table instead
 * of one commune's rows.
 *
 * This is a development tool, not a feature: production has no route that
 * does any of this. Refuses to run with NODE_ENV=production.
 */
import { prisma } from '../lib/prisma.js'

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

function assertNotProduction(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('reset-participants refuses to run with NODE_ENV=production')
  }
}

async function main(): Promise<void> {
  assertNotProduction()

  const confirmed = hasFlag('yes')

  const counts = {
    participants: await prisma.participant.count(),
    applications: await prisma.application.count(),
    participationHistory: await prisma.participationHistory.count(),
    drawPools: await prisma.drawPool.count(),
    drawResults: await prisma.drawResult.count(),
    importBatches: await prisma.importBatch.count(),
  }

  console.log('Current counts:', counts)

  if (!confirmed) {
    console.log('\nDry run only -- nothing was deleted. Pass --yes to actually wipe this data.')
    return
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')

    await tx.winnerAbandonment.deleteMany({})
    await tx.drawReserve.deleteMany({})
    await tx.drawSelectionEvent.deleteMany({})
    await tx.winnerArchive.deleteMany({})
    await tx.drawWinner.deleteMany({})
    await tx.resultPublication.deleteMany({})
    await tx.drawResult.deleteMany({})
    await tx.drawPoolEntry.deleteMany({})
    await tx.drawPool.deleteMany({})

    await tx.legacyWinner.deleteMany({})
    await tx.importRow.deleteMany({})
    await tx.importBatch.deleteMany({})

    await tx.participationHistory.deleteMany({})
    await tx.applicationParticipant.deleteMany({})
    await tx.application.deleteMany({})
    await tx.participant.deleteMany({})

    // Every pool/result these referenced is gone -- a commune draw left
    // LOCKED or COMPLETED now would be indistinguishable from the bug
    // isAdministrativelySettable exists to prevent.
    await tx.communeDraw.updateMany({
      where: { status: { in: ['LOCKED', 'COMPLETED'] } },
      data: { status: 'READY' },
    })
  })

  console.log('Done: all participants and their dependent records were removed.')
}

main()
  .catch((error) => {
    console.error('Reset failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
