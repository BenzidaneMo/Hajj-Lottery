import type { SupportedLocale } from './locale.js'

/** A wilaya (province), as exposed by the geographic API — all three
 * language labels are returned together so clients pick the one matching
 * the active locale without a separate request per language. */
export interface WilayaDto {
  id: string
  code: string
  nameAr: string
  nameFr: string
  nameEn: string
}

/** A commune, always scoped to exactly one wilaya. */
export interface CommuneDto {
  id: string
  wilayaId: string
  code: string
  nameAr: string
  nameFr: string
  nameEn: string
}

/** Picks the display name matching the active locale from a wilaya/commune DTO. */
export function localizedGeoName(
  entity: { nameAr: string; nameFr: string; nameEn: string },
  locale: SupportedLocale,
): string {
  if (locale === 'ar') return entity.nameAr
  if (locale === 'fr') return entity.nameFr
  return entity.nameEn
}
