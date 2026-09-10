import { useId } from 'react'

export interface RadioOption {
  value: string
  label: string
  description?: string
}

export interface RadioGroupProps {
  name: string
  label?: string
  options: RadioOption[]
  value?: string
  onChange?: (value: string) => void
  disabled?: boolean
}

export function RadioGroup({ name, label, options, value, onChange, disabled }: RadioGroupProps) {
  const groupId = useId()

  return (
    <fieldset className="flex flex-col gap-2">
      {label && <legend className="text-sm font-medium text-stone-700">{label}</legend>}
      <div className="flex flex-col gap-2">
        {options.map((option) => {
          const optionId = `${groupId}-${option.value}`
          const isSelected = value === option.value
          return (
            <label
              key={option.value}
              htmlFor={optionId}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                isSelected ? 'border-primary-600 bg-primary-50/60' : 'border-stone-200 hover:bg-stone-50'
              } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
            >
              <input
                id={optionId}
                type="radio"
                name={name}
                value={option.value}
                checked={isSelected}
                onChange={() => onChange?.(option.value)}
                disabled={disabled}
                className="mt-0.5 h-4 w-4 shrink-0 border-stone-300 text-primary-700 focus:ring-2 focus:ring-primary-600/40"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-stone-800">{option.label}</span>
                {option.description && <span className="text-xs text-stone-500">{option.description}</span>}
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
