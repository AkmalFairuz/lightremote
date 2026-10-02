import { useT } from '../i18n/useT'
import { type TranslationKey } from '../i18n'
import { useState } from 'react'
import { InputAdornment as MuiInputAdornment, TextField as MuiTextField } from '@mui/material'
import type { InputAdornmentProps, TextFieldProps } from '@mui/material'

/** Uses native input constraints and Material UI error feedback in compact fields. */
export function TextField({
  className = '',
  size = 'small',
  fullWidth = true,
  error,
  helperText,
  onInput,
  onInvalid,
  ...props
}: TextFieldProps) {
  const t = useT()

  const [validationMessage, setValidationMessage] = useState<{
    key: TranslationKey
    values?: Record<string, unknown>
  } | null>(null)

  return (
    <MuiTextField
      className={`ui-field ${className}`}
      size={size}
      fullWidth={fullWidth}
      variant="outlined"
      error={Boolean(error || validationMessage)}
      helperText={
        validationMessage ? t(validationMessage.key, validationMessage.values) : helperText
      }
      onInvalid={(event) => {
        event.preventDefault()
        const input = event.target as HTMLInputElement | HTMLTextAreaElement
        setValidationMessage(validationError(input))
        onInvalid?.(event)
      }}
      onInput={(event) => {
        if (validationMessage !== null) {
          const input = event.target as HTMLInputElement | HTMLTextAreaElement
          setValidationMessage(input.validity.valid ? null : validationError(input))
        }
        onInput?.(event)
      }}
      {...props}
    />
  )
}

/** Places an icon or other content inside a Material UI input. */
export function InputAdornment(props: InputAdornmentProps) {
  return <MuiInputAdornment {...props} />
}

function validationError(input: HTMLInputElement | HTMLTextAreaElement): {
  key: TranslationKey
  values?: Record<string, unknown>
} {
  const { validity } = input
  if (validity.valueMissing) return { key: 'validation.required' }
  if (validity.typeMismatch && input instanceof HTMLInputElement && input.type === 'email')
    return { key: 'validation.email' }
  if (validity.tooShort) return { key: 'validation.tooShort', values: { count: input.minLength } }
  if ((validity.rangeUnderflow || validity.rangeOverflow) && input instanceof HTMLInputElement)
    return { key: 'validation.range', values: { min: input.min, max: input.max } }
  return { key: 'common.enterAValidValue' }
}
