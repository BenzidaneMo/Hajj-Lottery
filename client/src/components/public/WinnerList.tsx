import type { PublicWinnerDto, SupportedLocale } from '@hajj-lottery/shared'
import { useTranslation } from 'react-i18next'

import { formatNumber } from '../../lib/format'
import { Table } from '../ui'

/**
 * The winning applications, in the order the draw selected them.
 *
 * Four columns, and they are the entire published record of a winner: the
 * position they were drawn at, the reference printed on their own receipt,
 * whether the application covers one pilgrim or two, and that count. Somebody
 * can find themselves in this list; nobody can find anybody else.
 *
 * **Names are absent on purpose.** Publishing them is a decision for the
 * governing authority to take explicitly — it is not something to arrive at
 * because a column happened to be available. The API does not send them and
 * this table has no column for them.
 *
 * So are weights. A weight is one household's accumulated priority, which is to
 * say how many years they have been waiting, and publishing it beside a
 * reference would publish that.
 *
 * The order is the server's. Nothing here sorts, re-ranks or re-derives it: it
 * is `selection_order` as the draw wrote it inside the execution transaction,
 * and it is not a ranking — the first entry drawn did not win by more.
 */
export interface WinnerListProps {
  winners: PublicWinnerDto[]
  /** Reveals only the first n rows. Used by the draw page's paced reveal. */
  visibleCount?: number
}

export function WinnerList({ winners, visibleCount }: WinnerListProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale

  const rows = visibleCount === undefined ? winners : winners.slice(0, Math.max(0, visibleCount))

  return (
    <div className="flex flex-col gap-3">
      <Table
        columns={[
          {
            key: 'selectionOrder',
            header: t('public.results.selectionOrder'),
            render: (winner: PublicWinnerDto) => formatNumber(winner.selectionOrder, locale),
          },
          {
            key: 'reference',
            header: t('public.results.reference'),
            render: (winner: PublicWinnerDto) => (
              <span className="font-mono tracking-wider">{winner.applicationReference}</span>
            ),
          },
          {
            key: 'entryType',
            header: t('public.results.entryType'),
            render: (winner: PublicWinnerDto) => t(`public.entryType.${winner.entryType}`),
          },
          {
            key: 'participantCount',
            header: t('public.results.participantCount'),
            render: (winner: PublicWinnerDto) => formatNumber(winner.participantCount, locale),
          },
        ]}
        rows={rows}
        getRowKey={(winner) => String(winner.selectionOrder)}
        emptyMessage={t('public.results.noWinnersYet')}
      />
      <p className="text-xs text-stone-500">{t('public.results.pairNote')}</p>
    </div>
  )
}
