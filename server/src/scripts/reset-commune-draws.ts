/**
 * Undoes every commune's pool freeze and/or draw execution at once, so a
 * tester can walk validate -> freeze -> execute through the admin UI again
 * from a clean READY state nationwide, without resetting one commune at a
 * time through reset-commune-draw.ts.
 *
 *   npm run reset-commune-draws --workspace server           # dry run, resets nothing
 *   npm run reset-commune-draws --workspace server -- --yes  # actually resets
 *   npm run reset-commune-draws --workspace server -- --year=2027 --yes
 *
 * `--year` narrows to one draw year; with none given, every commune draw
 * anywhere that has a pool or a result is reset. Same escape hatch as
 * reset-commune-draw.ts: draw_pools / draw_pool_entries / draw_results /
 * draw_winners / draw_selection_events / winner_archive / audit_logs are
 * immutable by trigger, by design, so `SET LOCAL session_replication_role =
 * replica` disables every trigger (including FK enforcement) for the
 * lifetime of one transaction only, reverting automatically at commit or
 * rollback. Only the audit rows this exact set of freezes/executions wrote
 * are removed (matched by each pool's and result's own id) -- an unrelated
 * event such as closing registration for the year is never touched.
 *
 * A participant has at most one APPLICATION-sourced participation-history
 * row per draw year, by the same "one application per person per draw year"
 * invariant registration itself enforces -- so grouping the history deletion
 * by year (rather than by the specific commune draw touched) is unambiguous
 * even when several commune draws across different communes, or different
 * years, are reset in the same run.
 *
 * This is a development tool, not an administrative feature: production has
 * no route that does this, on purpose -- a real draw has no unlock, for
 * anyone. Refuses to run at all against a database that does not look like a
 * test/dev one (see `assertNotProduction` below), mirroring the same guard
 * prisma/seed.ts's dev-only steps use.
 */
import { prisma } from '../lib/prisma.js'

function arg(name: string): string | undefined {
  const flag = `--${name}=`
  const found = process.argv.find((value) => value.startsWith(flag))
  return found ? found.slice(flag.length) : undefined
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

/**
 * Postgres rejects a prepared statement with too many bind variables
 * (observed limit ~32767) well before it would run out of anything else.
 * `participantIds`/`applicationIds` scale with the number of pool entries
 * across every commune being reset — unlike `poolIds`/`resultIds`, which are
 * bounded by the commune count (at most 1541) and never need this — so a
 * nationwide reset can comfortably exceed that limit in one `IN (...)`.
 */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

const MAX_BIND_VARIABLES = 10_000

function assertNotProduction(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('reset-commune-draws refuses to run with NODE_ENV=production')
  }
}

async function main(): Promise<void> {
  assertNotProduction()

  const yearArg = arg('year')
  const confirmed = hasFlag('yes')

  const communeDraws = await prisma.communeDraw.findMany({
    where: {
      OR: [{ pool: { isNot: null } }, { result: { isNot: null } }],
      ...(yearArg ? { drawYear: { year: Number(yearArg) } } : {}),
    },
    include: {
      commune: true,
      drawYear: true,
      pool: { include: { entries: true } },
      result: true,
    },
  })

  if (communeDraws.length === 0) {
    console.log(
      yearArg
        ? `Nothing to reset: no commune draw in ${yearArg} has a pool or a result.`
        : 'Nothing to reset: no commune draw anywhere has a pool or a result.',
    )
    return
  }

  console.log(`${communeDraws.length} commune draw(s) to reset${yearArg ? ` for ${yearArg}` : ''}:`)
  for (const draw of communeDraws) {
    console.log(
      `  ${draw.commune.nameFr} (${draw.commune.code}), year ${draw.drawYear.year}, ` +
        `status ${draw.status}, pool: ${!!draw.pool}, result: ${!!draw.result}`,
    )
  }

  if (!confirmed) {
    console.log('\nDry run only -- nothing was reset. Pass --yes to actually reset these.')
    return
  }

  const poolIds = communeDraws.filter((d) => d.pool).map((d) => d.pool!.id)
  const resultIds = communeDraws.filter((d) => d.result).map((d) => d.result!.id)

  const applicationIds: string[] = []
  const participantIds = new Set<string>()
  const participantIdsByYear = new Map<number, Set<string>>()

  for (const draw of communeDraws) {
    if (!draw.pool) continue
    const yearParticipants = participantIdsByYear.get(draw.drawYear.year) ?? new Set<string>()
    for (const entry of draw.pool.entries) {
      applicationIds.push(entry.applicationId)
      participantIds.add(entry.primaryParticipantId)
      yearParticipants.add(entry.primaryParticipantId)
      if (entry.secondaryParticipantId) {
        participantIds.add(entry.secondaryParticipantId)
        yearParticipants.add(entry.secondaryParticipantId)
      }
    }
    participantIdsByYear.set(draw.drawYear.year, yearParticipants)
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')

    if (resultIds.length > 0) {
      await tx.winnerAbandonment.deleteMany({ where: { drawWinner: { drawResultId: { in: resultIds } } } })
      await tx.drawReserve.deleteMany({ where: { drawResultId: { in: resultIds } } })
      await tx.drawSelectionEvent.deleteMany({ where: { drawResultId: { in: resultIds } } })
      await tx.winnerArchive.deleteMany({ where: { drawResultId: { in: resultIds } } })
      await tx.drawWinner.deleteMany({ where: { drawResultId: { in: resultIds } } })
      await tx.resultPublication.deleteMany({ where: { drawResultId: { in: resultIds } } })
      await tx.drawResult.deleteMany({ where: { id: { in: resultIds } } })
    }

    if (poolIds.length > 0) {
      await tx.drawPoolEntry.deleteMany({ where: { drawPoolId: { in: poolIds } } })
      await tx.drawPool.deleteMany({ where: { id: { in: poolIds } } })
    }

    const targetIds = [...poolIds, ...resultIds]
    if (targetIds.length > 0) {
      await tx.auditLog.deleteMany({ where: { targetId: { in: targetIds } } })
    }

    for (const ids of chunk([...participantIds], MAX_BIND_VARIABLES)) {
      await tx.participant.updateMany({
        where: { id: { in: ids } },
        data: { hasWonHajj: false },
      })
    }

    for (const ids of chunk(applicationIds, MAX_BIND_VARIABLES)) {
      await tx.application.updateMany({
        where: { id: { in: ids } },
        data: { status: 'ELIGIBLE', calculatedWeight: null },
      })
    }

    for (const [year, ids] of participantIdsByYear) {
      for (const idsChunk of chunk([...ids], MAX_BIND_VARIABLES)) {
        await tx.participationHistory.deleteMany({
          where: { participantId: { in: idsChunk }, drawYear: year, source: 'APPLICATION' },
        })
      }
    }

    await tx.communeDraw.updateMany({
      where: { id: { in: communeDraws.map((d) => d.id) } },
      data: { status: 'READY' },
    })
  })

  console.log(`Done: ${communeDraws.length} commune draw(s) are back to READY, with no pool and no result.`)
}

main()
  .catch((error) => {
    console.error('Reset failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
