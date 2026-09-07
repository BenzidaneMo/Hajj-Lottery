import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CommuneSelect, WilayaSelect } from '../../components/geo'
import { Card, EmptyState, PageHeader } from '../../components/ui'
import { useCommunesByWilaya } from '../../lib/geo'

/** Read-only browser over the seeded geographic reference data. */
export function AdminCommunes() {
  const { t } = useTranslation()
  const [wilayaId, setWilayaId] = useState<string | undefined>(undefined)
  const [communeId, setCommuneId] = useState<string | undefined>(undefined)

  const { data: communes } = useCommunesByWilaya(wilayaId)
  const selectedCommune = communes?.find((commune) => commune.id === communeId)

  return (
    <div>
      <PageHeader
        title={t('admin.pages.communes.title')}
        description={t('admin.pages.communes.description')}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <WilayaSelect value={wilayaId} onChange={setWilayaId} />
        <CommuneSelect wilayaId={wilayaId} value={communeId} onChange={setCommuneId} />
      </div>

      <div className="mt-6">
        {selectedCommune ? (
          <Card title={selectedCommune.nameFr}>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium text-stone-500">{t('admin.pages.communes.code')}</dt>
                <dd className="text-sm text-stone-900">{selectedCommune.code}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-stone-500">{t('admin.pages.communes.nameAr')}</dt>
                <dd className="text-sm text-stone-900" dir="rtl">
                  {selectedCommune.nameAr}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-stone-500">{t('admin.pages.communes.nameFr')}</dt>
                <dd className="text-sm text-stone-900">{selectedCommune.nameFr}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-stone-500">{t('admin.pages.communes.nameEn')}</dt>
                <dd className="text-sm text-stone-900">{selectedCommune.nameEn}</dd>
              </div>
            </dl>
          </Card>
        ) : (
          <EmptyState title={t('admin.pages.communes.selectPrompt')} />
        )}
      </div>
    </div>
  )
}
