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
  const [validationMessage, setValidationMessage] = useState<string | null>(null)

  return (
    <MuiTextField
      className={`ui-field ${className}`}
      size={size}
      fullWidth={fullWidth}
      variant="outlined"
      error={Boolean(error || validationMessage)}
      helperText={validationMessage ?? helperText}
      onInvalid={(event) => {
        event.preventDefault()
        const input = event.target as HTMLInputElement | HTMLTextAreaElement
        setValidationMessage(input.validationMessage || 'Enter a valid value.')
        onInvalid?.(event)
      }}
      onInput={(event) => {
        if (validationMessage !== null) {
          const input = event.target as HTMLInputElement | HTMLTextAreaElement
          setValidationMessage(input.validity.valid ? null : input.validationMessage)
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
