import type { CommuneDto, WilayaDto } from '@hajj-lottery/shared'

export function toWilayaDto(wilaya: {
  id: string
  code: string
  nameAr: string
  nameFr: string
  nameEn: string
}): WilayaDto {
  const { id, code, nameAr, nameFr, nameEn } = wilaya
  return { id, code, nameAr, nameFr, nameEn }
}

export function toCommuneDto(commune: {
  id: string
  wilayaId: string
  code: string
  nameAr: string
  nameFr: string
  nameEn: string
}): CommuneDto {
  const { id, wilayaId, code, nameAr, nameFr, nameEn } = commune
  return { id, wilayaId, code, nameAr, nameFr, nameEn }
}
