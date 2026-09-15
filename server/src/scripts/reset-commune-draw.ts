/**
 * Undoes one commune's pool freeze and/or draw execution, so a tester can
 * walk validate -> freeze -> execute through the admin UI again from a clean
 * READY state, without hand-editing the database.
 *
 *   npm run reset-commune-draw --workspace server -- --wilaya=27 --commune=2701
 *   npm run reset-commune-draw --workspace server -- --wilaya=27 --commune=2701 --year=2026
 *
 * `--year` is only needed when the commune has draws configured for more
 * than one year and more than one of them has a pool or a result -- normally
 * there is at most one to find.
 *
 * draw_pools / draw_pool_entries / draw_results / draw_winners /
 * draw_selection_events / winner_archive / audit_logs are immutable by
 * trigger, by design: nobody, this script included, may UPDATE or DELETE
 * them under the normal rules -- the audit trail especially is meant to
 * outlive everything it describes. `SET LOCAL session_replication_role =
 * replica` disables every trigger (including FK enforcement) for the
 * lifetime of one transaction only -- the standard Postgres escape hatch for
 * exactly this kind of deliberate, one-off, development-database correction.
 * It reverts automatically when the transaction ends, whether committed or
 * rolled back. Only the two audit rows this exact freeze/execute pair wrote
 * are removed (matched by the pool's and result's own ids) -- an unrelated
 * event such as closing registration for the year is never touched, because
 * that change is not being undone.
 *
 * This is a development tool, not an administrative feature: production has
 * no route that does this, on purpose -- a real draw has no unlock, for
 * anyone. Refuses to run at all against a database that does not look like a
 * test/dev one (see `assertNotProduction` below), mirroring the same guard
 * `prisma/seed.ts`'s dev-only steps use.
 */
import { prisma } from '../lib/prisma.js'

function arg(name: string): string | undefined {
  const flag = `--${name}=`
  const found = process.argv.find((value) => value.startsWith(flag))
  return found ? found.slice(flag.length) : undefined
}

function assertNotProduction(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('reset-commune-draw refuses to run with NODE_ENV=production')
  }
}

async function main() {
  assertNotProduction()

  const wilayaCode = arg('wilaya')
  const communeCode = arg('commune')
  const year = arg('year')
  if (!wilayaCode || !communeCode) {
    throw new Error('Usage: reset-commune-draw --wilaya=<code> --commune=<code> [--year=<year>]')
  }

  const wilaya = await prisma.wilaya.findUnique({ where: { code: wilayaCode } })
  if (!wilaya) throw new Error(`No wilaya with code "${wilayaCode}"`)

  const commune = await prisma.commune.findFirst({ where: { wilayaId: wilaya.id, code: communeCode } })
  if (!commune) throw new Error(`No commune with code "${communeCode}" in wilaya "${wilayaCode}"`)

  const communeDraws = await prisma.communeDraw.findMany({
    where: { communeId: commune.id, ...(year ? { drawYear: { year: Number(year) } } : {}) },
    include: { drawYear: true, pool: true, result: true },
  })

  const candidates = communeDraws.filter((draw) => draw.pool || draw.result)
  if (candidates.length === 0) {
    console.log(`Nothing to reset: ${communeCode} in wilaya ${wilayaCode} has no pool or result.`)
    return
  }
  if (candidates.length > 1) {
    const years = candidates.map((c) => c.drawYear.year).join(', ')
    throw new Error(`Multiple years have a pool or result (${years}) -- pass --year to pick one.`)
  }

  const communeDraw = candidates[0]!
  console.log(
    `Resetting ${commune.nameFr} (${communeCode}), draw year ${communeDraw.drawYear.year}, ` +
      `current status ${communeDraw.status}...`,
  )

  const pool = communeDraw.pool
    ? await prisma.drawPool.findUnique({
        where: { id: communeDraw.pool.id },
        include: { entries: true },
      })
    : null
  const result = communeDraw.result

  const applicationIds = pool?.entries.map((e) => e.applicationId) ?? []
  const participantIds = new Set<string>()
  for (const entry of pool?.entries ?? []) {
    participantIds.add(entry.primaryParticipantId)
    if (entry.secondaryParticipantId) participantIds.add(entry.secondaryParticipantId)
  }

  console.log(
    `  pool entries: ${applicationIds.length}, participants touched: ${participantIds.size}, ` +
      `has result: ${!!result}`,
  )

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')

    if (result) {
      await tx.winnerAbandonment.deleteMany({ where: { drawWinner: { drawResultId: result.id } } })
      await tx.drawReserve.deleteMany({ where: { drawResultId: result.id } })
      await tx.drawSelectionEvent.deleteMany({ where: { drawResultId: result.id } })
      await tx.winnerArchive.deleteMany({ where: { drawResultId: result.id } })
      await tx.drawWinner.deleteMany({ where: { drawResultId: result.id } })
      await tx.resultPublication.deleteMany({ where: { drawResultId: result.id } })
      await tx.drawResult.delete({ where: { id: result.id } })
    }

    if (pool) {
      await tx.drawPoolEntry.deleteMany({ where: { drawPoolId: pool.id } })
      await tx.drawPool.delete({ where: { id: pool.id } })
    }

    // The audit trail is append-only for everyone, including this script,
    // under the normal rules -- these two rows exist only because of the
    // freeze/execute this reset is undoing, so they go too, scoped precisely
    // to the pool's and result's own ids. Nothing else in the trail is
    // touched: an unrelated event (closing registration, an administrator
    // being created) is not part of what this reset is meant to undo.
    const targetIds = [pool?.id, result?.id].filter((id): id is string => !!id)
    if (targetIds.length > 0) {
      await tx.auditLog.deleteMany({ where: { targetId: { in: targetIds } } })
    }

    if (participantIds.size > 0) {
      await tx.participant.updateMany({
        where: { id: { in: [...participantIds] } },
        data: { hasWonHajj: false },
      })
    }

    if (applicationIds.length > 0) {
      await tx.application.updateMany({
        where: { id: { in: applicationIds } },
        data: { status: 'ELIGIBLE', calculatedWeight: null },
      })

      // Execution writes exactly one APPLICATION-sourced history row per
      // pooled application, for the commune draw's own year -- exactly the
      // rows this undoes, and nothing pre-existing (a legacy import or an
      // earlier year is never touched).
      await tx.participationHistory.deleteMany({
        where: {
          participantId: { in: [...participantIds] },
          drawYear: communeDraw.drawYear.year,
          source: 'APPLICATION',
        },
      })
    }

    await tx.communeDraw.update({ where: { id: communeDraw.id }, data: { status: 'READY' } })
  })

  console.log('Done: commune draw is back to READY, with no pool and no result.')
}

main()
  .catch((error) => {
    console.error('Reset failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
