import type { CommuneDto, WilayaDto } from '@hajj-lottery/shared'
import { useEffect, useState } from 'react'

import { apiGet } from './api'

interface WilayasResult {
  loaded: boolean
  data: WilayaDto[] | undefined
  error: unknown
}

export interface GeoSourceOptions {
  /**
   * Use the administrator's scoped view (/api/admin/...) instead of the
   * public list. Admin screens pass this so an administrator only sees the
   * territory they govern; the public registration form must not, since a
   * citizen may pick any commune.
   */
  scoped?: boolean
}

export function useWilayas(options: GeoSourceOptions = {}): {
  data: WilayaDto[] | undefined
  isLoading: boolean
  error: unknown
} {
  const scoped = options.scoped ?? false
  const [result, setResult] = useState<WilayasResult>({ loaded: false, data: undefined, error: undefined })

  useEffect(() => {
    let cancelled = false

    apiGet<WilayaDto[]>(scoped ? '/api/admin/wilayas' : '/api/wilayas')
      .then((data) => {
        if (!cancelled) setResult({ loaded: true, data, error: undefined })
      })
      .catch((error: unknown) => {
        if (!cancelled) setResult({ loaded: true, data: undefined, error })
      })

    return () => {
      cancelled = true
    }
  }, [scoped])

  return { data: result.data, isLoading: !result.loaded, error: result.error }
}

interface CommunesResult {
  /** The wilayaId this result belongs to, so a stale result never lingers under a new wilaya. */
  wilayaId: string | undefined
  data: CommuneDto[] | undefined
  error: unknown
}

/** Communes for a wilaya. Pass `undefined` when no wilaya is selected yet. */
export function useCommunesByWilaya(
  wilayaId: string | undefined,
  options: GeoSourceOptions = {},
): {
  data: CommuneDto[] | undefined
  isLoading: boolean
  error: unknown
} {
  const scoped = options.scoped ?? false
  const [result, setResult] = useState<CommunesResult>({
    wilayaId: undefined,
    data: undefined,
    error: undefined,
  })

  useEffect(() => {
    if (!wilayaId) return

    let cancelled = false

    const path = scoped
      ? `/api/admin/communes?wilayaId=${encodeURIComponent(wilayaId)}`
      : `/api/wilayas/${wilayaId}/communes`

    apiGet<CommuneDto[]>(path)
      .then((data) => {
        if (!cancelled) setResult({ wilayaId, data, error: undefined })
      })
      .catch((error: unknown) => {
        if (!cancelled) setResult({ wilayaId, data: undefined, error })
      })

    return () => {
      cancelled = true
    }
  }, [wilayaId, scoped])

  const isCurrent = result.wilayaId === wilayaId
  return {
    data: isCurrent ? result.data : undefined,
    isLoading: wilayaId !== undefined && !isCurrent,
    error: isCurrent ? result.error : undefined,
  }
}
