import type { PublicReserveDto, SupportedLocale } from '@hajj-lottery/shared'
import { useTranslation } from 'react-i18next'

import { formatNumber } from '../../lib/format'
import { Table } from '../ui'
import { ReserveOutcomeBadge } from './PublicStatusBadge'

/**
 * The reserve list, in the order the same draw produced it.
 *
 * A commune with N places drew 2N entries in one continuous sample: the first N
 * are the winners, and these are the rest. They are shown as a separate list
 * from the winners, under their own heading, because they are a separate thing —
 * **a reserve is not a winner.** They hold an ordered contingency position and
 * are called, in turn, only if an original winner gives up a place. Presenting
 * them as extra winners, or appending them to the winner table, would say
 * something about their standing that is not true.
 *
 * **The order is the server's, and nothing here touches it.** No sort by weight,
 * by status, by reference or by anything else; no client-side derivation of a
 * position; no filtering. `reservePosition` is the number the lottery gave them
 * and the number an official reads out when calling, and the rows are rendered
 * in the order the API sent them. A page that re-ordered this list would be
 * showing a different lottery than the one that ran.
 *
 * **A promoted reserve keeps its reserve number.** `PROMOTED` says they became a
 * winner; it does not renumber them into the winner list, and this component has
 * no path that could move a row from one table to the other. The original draw
 * said "reserve #1" and still says it; what changed afterwards is recorded
 * beside it rather than instead of it.
 *
 * The columns match the winner list's — position, reference, type, pilgrims,
 * status — for the same reasons and with the same omissions. No name, no weight,
 * no internal id, and nothing at all about *why* a place became available: the
 * abandonment's reason, its explanation and the administrator who recorded it
 * are not in the public DTO, so there is nothing here to leak.
 */
export interface ReserveListProps {
  reserves: PublicReserveDto[]
  /** The heading that names this table, where the page has more than one. */
  labelledBy?: string
}

export function ReserveList({ reserves, labelledBy }: ReserveListProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale

  return (
    <div className="flex flex-col gap-3">
      <Table
        columns={[
          {
            key: 'reservePosition',
            header: t('public.results.reservePosition'),
            render: (reserve: PublicReserveDto) => formatNumber(reserve.reservePosition, locale),
          },
          {
            key: 'reference',
            header: t('public.results.reference'),
            render: (reserve: PublicReserveDto) => (
              <span className="font-mono tracking-wider">{reserve.applicationReference}</span>
            ),
          },
          {
            key: 'entryType',
            header: t('public.results.entryType'),
            render: (reserve: PublicReserveDto) => t(`public.entryType.${reserve.entryType}`),
          },
          {
            key: 'participantCount',
            header: t('public.results.participantCount'),
            render: (reserve: PublicReserveDto) => formatNumber(reserve.participantCount, locale),
          },
          {
            key: 'outcome',
            header: t('public.results.reserveStatus'),
            render: (reserve: PublicReserveDto) => <ReserveOutcomeBadge outcome={reserve.outcome} />,
          },
        ]}
        // Exactly as received. Not a copy that has been sorted, not a copy at
        // all — the array the server sent, in its order.
        rows={reserves}
        getRowKey={(reserve) => String(reserve.reservePosition)}
        emptyMessage={t('public.results.noReserves')}
        labelledBy={labelledBy}
      />
      <p className="text-xs text-stone-500">{t('public.results.reserveNote')}</p>
    </div>
  )
}
