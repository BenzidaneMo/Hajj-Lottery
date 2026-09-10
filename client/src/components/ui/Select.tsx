import { forwardRef, useId, type SelectHTMLAttributes } from 'react'

export interface SelectOption {
  value: string
  label: string
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  options: SelectOption[]
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, options, id, className = '', required, ...props },
  ref,
) {
  const generatedId = useId()
  const selectId = id ?? generatedId

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={selectId} className="text-sm font-medium text-stone-700">
          {label}
          {required && (
            <span aria-hidden="true" className="ms-0.5 text-red-600">
              *
            </span>
          )}
        </label>
      )}
      <select
        ref={ref}
        id={selectId}
        aria-invalid={Boolean(error)}
        required={required}
        className={`rounded-md border bg-white px-3 py-2 text-sm text-stone-900 shadow-xs outline-none transition-colors focus:border-primary-600 focus:ring-2 focus:ring-primary-600/30 disabled:cursor-not-allowed disabled:bg-stone-50 disabled:text-stone-400 ${
          error ? 'border-red-500' : 'border-stone-300'
        } ${className}`}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
})
