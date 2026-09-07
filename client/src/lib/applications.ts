import type {
  ApplicationReceiptDto,
  CreateApplicationRequest,
  RegistrationWindowDto,
} from '@hajj-lottery/shared'
import { useEffect, useState } from 'react'

import { apiGet, apiPost } from './api'

export function submitApplication(request: CreateApplicationRequest): Promise<ApplicationReceiptDto> {
  return apiPost<ApplicationReceiptDto>('/api/applications', request)
}

interface WindowState {
  loaded: boolean
  data: RegistrationWindowDto | undefined
  error: unknown
}

/**
 * The draw year the form is applying for, and whether intake is open.
 *
 * Purely for display: the server decides both again on submission, so a stale
 * or tampered value here cannot place an application in the wrong year.
 */
export function useRegistrationWindow(): {
  data: RegistrationWindowDto | undefined
  isLoading: boolean
  error: unknown
} {
  const [state, setState] = useState<WindowState>({
    loaded: false,
    data: undefined,
    error: undefined,
  })

  useEffect(() => {
    let cancelled = false

    apiGet<RegistrationWindowDto>('/api/applications/registration-window')
      .then((data) => {
        if (!cancelled) setState({ loaded: true, data, error: undefined })
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ loaded: true, data: undefined, error })
      })

    return () => {
      cancelled = true
    }
  }, [])

  return { data: state.data, isLoading: !state.loaded, error: state.error }
}
