import { forwardRef, useId, type TextareaHTMLAttributes } from 'react'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, error, id, className = '', rows = 4, ...props },
  ref,
) {
  const generatedId = useId()
  const textareaId = id ?? generatedId

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={textareaId} className="text-sm font-medium text-stone-700">
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={textareaId}
        rows={rows}
        aria-invalid={Boolean(error)}
        className={`rounded-md border px-3 py-2 text-sm text-stone-900 outline-none focus:ring-2 focus:ring-primary-600 ${
          error ? 'border-red-500' : 'border-stone-300'
        } ${className}`}
        {...props}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
})
