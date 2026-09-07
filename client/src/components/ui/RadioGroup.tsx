import { useId } from 'react'

export interface RadioOption {
  value: string
  label: string
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
          return (
            <div key={option.value} className="flex items-center gap-2">
              <input
                id={optionId}
                type="radio"
                name={name}
                value={option.value}
                checked={value === option.value}
                onChange={() => onChange?.(option.value)}
                disabled={disabled}
                className="h-4 w-4 border-stone-300 text-primary-700 focus:ring-2 focus:ring-primary-600"
              />
              <label htmlFor={optionId} className="text-sm text-stone-700">
                {option.label}
              </label>
            </div>
          )
        })}
      </div>
    </fieldset>
  )
}
