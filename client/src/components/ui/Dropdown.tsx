import { useEffect, useRef, useState, type ReactNode } from 'react'

export interface DropdownItem {
  key: string
  label: string
  onSelect: () => void
  disabled?: boolean
}

export interface DropdownProps {
  trigger: ReactNode
  items: DropdownItem[]
  align?: 'start' | 'end'
}

export function Dropdown({ trigger, items, align = 'start' }: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        {trigger}
      </button>
      {isOpen && (
        <div
          role="menu"
          className={`absolute z-20 mt-2 min-w-40 rounded-md border border-stone-200 bg-white py-1 shadow-lg ${
            align === 'end' ? 'end-0' : 'start-0'
          }`}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                item.onSelect()
                setIsOpen(false)
              }}
              className="block w-full px-4 py-2 text-start text-sm text-stone-700 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
