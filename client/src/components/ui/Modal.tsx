import { useEffect, type PropsWithChildren } from 'react'
import { useTranslation } from 'react-i18next'

import { CloseIcon } from '../icons'
import { IconButton } from './IconButton'

export interface ModalProps extends PropsWithChildren {
  isOpen: boolean
  onClose: () => void
  title?: string
}

export function Modal({ isOpen, onClose, title, children }: ModalProps) {
  const { t } = useTranslation()

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'modal-title' : undefined}
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          {title && (
            <h2 id="modal-title" className="text-lg font-semibold text-stone-900">
              {title}
            </h2>
          )}
          <IconButton
            icon={<CloseIcon className="h-5 w-5" />}
            label={t('common.close')}
            variant="ghost"
            onClick={onClose}
          />
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  )
}
