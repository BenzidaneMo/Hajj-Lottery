import { forwardRef, useId, type InputHTMLAttributes } from 'react'

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, id, className = '', ...props },
  ref,
) {
  const generatedId = useId()
  const checkboxId = id ?? generatedId

  return (
    <div className="flex items-center gap-2">
      <input
        ref={ref}
        id={checkboxId}
        type="checkbox"
        className={`h-4 w-4 rounded border-stone-300 text-primary-700 focus:ring-2 focus:ring-primary-600 ${className}`}
        {...props}
      />
      <label htmlFor={checkboxId} className="text-sm text-stone-700">
        {label}
      </label>
    </div>
  )
})
